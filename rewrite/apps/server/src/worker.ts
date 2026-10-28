import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { Hono, type Context } from 'hono';
import { migrateOrgSchemaSync, schema, serverChangeTriggers, serverSyncDdl, type Poke, type Role, type Tx } from '@gp/core';
import { outputRoutes, syncRoutes, watchLocked, type Org } from './app.ts';
import { authenticate, authRoutes, isApiPath, WS_PROTOCOL } from './auth.ts';
import { GoogleOidc, TEST_ISSUER_BUILD } from './google.ts';
import { Accounts, migrateGlobal, type GlobalSql, type Row } from './global.ts';
import { LiveHub, type LiveSocket } from './live-hub.ts';
import { r2Storage, type R2Like } from './media.ts';
import { Passkeys } from './webauthn.ts';
import { lookupThrottled, WatchRegistry } from './watch.ts';
import { screenPairRoutes, screenStartRoutes } from './screen-routes.ts';
import { ScreenRegistry } from './screens.ts';
import { isAppPage, staticHeaders } from './static.ts';
import { PokeCoalescer, SerialQueue, type OrgStore } from '@gp/sync/server';

interface Env {
  DB: D1Database;
  /** Where picture blobs are kept (D31). Without the binding the media endpoints answer 503. */
  MEDIA?: R2Bucket;
  ORG: DurableObjectNamespace<OrgDurableObject>;
  SPIKE_DEBUG?: string;
  POKE_WINDOW_MS?: string;
  /** What first-run setup must be given (D19). Unset: setup stays closed. A secret, so never in wrangler.toml. */
  SETUP_TOKEN?: string;
  SESSION_IDLE_MS?: string;
  /** Tests only: how long a picture blob nothing names is kept. */
  MEDIA_GRACE_MS?: string;
  /** Sign-in with Google. Without both, nobody can sign in or set up. The secret is a secret: never in wrangler.toml. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** The public origin, e.g. https://app.example.org: the redirect URI is `{it}/api/auth/google/callback`. */
  GOOGLE_REDIRECT_BASE_URL?: string;
  /** Test builds only (GP_TEST_ISSUER): a fake issuer instead of Google. A deploy build refuses to start with it set. */
  GOOGLE_TEST_ISSUER?: string;
  /** Passkeys: the RP ID (the domain, e.g. app.example.org) and the allowed origins, comma-separated. Both, or passkeys are off. */
  PASSKEY_RP_ID?: string;
  PASSKEY_ORIGINS?: string;
  /** Tests only: how young a session must be to add a login. */
  FRESH_SIGN_IN_MS?: string;
  /** The built web app (Workers static assets, wrangler.toml's [assets]). Without it, only the API answers. */
  ASSETS?: Fetcher;
}

function passkeysOf(env: Env): Passkeys | null {
  if (!env.PASSKEY_RP_ID || !env.PASSKEY_ORIGINS) return null;
  return new Passkeys({ rpId: env.PASSKEY_RP_ID, origins: env.PASSKEY_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) });
}

function googleOf(env: Env): GoogleOidc | null {
  if (env.GOOGLE_TEST_ISSUER && !TEST_ISSUER_BUILD) throw new Error('GOOGLE_TEST_ISSUER is set, but this build does not allow a test issuer');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return new GoogleOidc({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectBaseUrl: env.GOOGLE_REDIRECT_BASE_URL || undefined,
    testIssuer: TEST_ISSUER_BUILD ? env.GOOGLE_TEST_ISSUER || undefined : undefined,
  });
}

/** An organisation's data in its Durable Object's own SQLite (evaluation option (a)). */
export function durableSqliteStore(storage: DurableObjectStorage): OrgStore {
  const run = (sql: string) => storage.sql.exec(sql).toArray() as Record<string, unknown>[];
  migrateOrgSchemaSync(run, (fn) => storage.transactionSync(fn));
  for (const s of [...serverSyncDdl, ...serverChangeTriggers()]) run(s);
  return {
    db: drizzle(storage, { schema }) as unknown as Tx,
    query: (sql, params = []) => storage.sql.exec(sql, ...params).toArray() as Record<string, unknown>[],
    // DO SQLite refuses BEGIN/COMMIT from sql.exec, and transactionSync() cannot
    // wait for an async mutator. The async storage.transaction() can: it runs
    // the closure as an explicit transaction and rolls back if it throws.
    transaction: (fn) => storage.transaction(() => fn()),
  };
}

/** One per organisation: serialises its pushes and holds its poke WebSockets (hibernatable). */
export class OrgDurableObject extends DurableObject<Env> {
  private org: Org;
  private app: Hono;
  private live: LiveHub;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const poke = new PokeCoalescer((exclude, seq) => {
      const msg = JSON.stringify({ type: 'poke', seq } satisfies Poke);
      for (const ws of ctx.getWebSockets('poke')) if (ctx.getTags(ws)[1] !== exclude) ws.send(msg);
    }, Number(env.POKE_WINDOW_MS ?? 500));
    const store = durableSqliteStore(ctx.storage);
    // Which socket owns which session lives on the socket, so it survives hibernation.
    const screens = new ScreenRegistry(d1Sql(env.DB));
    const queue = new SerialQueue();
    this.live = new LiveHub(
      store,
      () => ctx.getWebSockets('live').map(liveSocket),
      Date.now,
      (ids) => void screens.release(ids).catch(() => undefined),
      (fn, ms) => setTimeout(() => void queue.run(async () => fn()).catch(() => undefined), ms),
    );
    this.org = { store, queue, poke, live: this.live };
    // The Worker has authenticated the caller against D1 and passes the result in headers.
    const resolveCaller = async (c: Context) => {
      const userId = c.req.header('x-user')!;
      const role = c.req.header('x-role') as Role;
      // Sync needs neither when the session signed in nor how: those matter only to the auth routes.
      return { caller: { orgId: c.req.header('x-org')!, sessionId: '', ctx: { userId, role }, signedInAt: 0, paired: true }, org: this.org };
    };
    this.app = syncRoutes(resolveCaller, {
      debug: env.SPIKE_DEBUG === '1',
      media: env.MEDIA ? r2Storage(env.MEDIA as unknown as R2Like) : null,
      mediaGraceMs: env.MEDIA_GRACE_MS ? Number(env.MEDIA_GRACE_MS) : undefined,
      // The organisation's object writes its codes to the global index in D1.
      watch: new WatchRegistry(d1Sql(env.DB)),
    });
    const media = env.MEDIA ? r2Storage(env.MEDIA as unknown as R2Like) : null;
    // An output: the Worker found the code (or a temporary screen's id) in D1 and names the output in headers.
    for (const kind of ['watch', 'display', 'screen'] as const) {
      this.app.route(
        '/',
        outputRoutes(kind, async (c, code) => {
          if (c.req.header('x-code') !== code) return null;
          return {
            org: this.org,
            live: this.live,
            orgId: c.req.header('x-org')!,
            orgName: decodeURIComponent(c.req.header('x-org-name') ?? ''),
            displayId: c.req.header('x-display')!,
            code,
          };
        }, media),
      );
    }
    const clientAddress = (c: Context) => c.req.header('cf-connecting-ip') ?? 'unknown';
    this.app.route('/', screenPairRoutes(resolveCaller, { screens, accounts: new Accounts(d1Sql(env.DB)), clientAddress }));
    this.app.get('/api/debug/triggers', (c) => c.json(triggerCheck((s, ...p) => ctx.storage.sql.exec(s, ...p).toArray())));
    this.app.get('/api/debug/tx-probe', async (c) => c.json(await transactionProbe(ctx.storage)));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') === 'websocket') {
      const url = new URL(request.url);
      const pair = new WebSocketPair();
      if (url.pathname === '/api/live/socket') {
        this.ctx.acceptWebSocket(pair[1], ['live']);
        pair[1].serializeAttachment({ id: crypto.randomUUID(), userId: request.headers.get('x-user')!, role: request.headers.get('x-role') as Role, owns: [] } satisfies LiveAttachment);
        const s = liveSocket(pair[1]);
        void this.org.queue.run(() => this.live.opened(s));
      } else this.ctx.acceptWebSocket(pair[1], ['poke', url.searchParams.get('clientId') ?? '']);
      // The client offered credentials as subprotocols too; the answer names only this one.
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'sec-websocket-protocol': WS_PROTOCOL } });
    }
    return this.app.fetch(request);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (this.ctx.getTags(ws)[0] !== 'live') return;
    await this.org.queue.run(() => this.live.message(liveSocket(ws), typeof message === 'string' ? message : new TextDecoder().decode(message)));
  }
  override async webSocketClose(ws: WebSocket, code: number) {
    if (this.ctx.getTags(ws)[0] === 'live') await this.org.queue.run(() => this.live.closed(liveSocket(ws)));
    ws.close(code, 'closing');
  }
  /** A socket that failed is gone as surely as one that closed: what it owned freezes. */
  override async webSocketError(ws: WebSocket) {
    if (this.ctx.getTags(ws)[0] === 'live') await this.org.queue.run(() => this.live.closed(liveSocket(ws)));
  }
}

/** What a live socket carries through hibernation: who it is, and the sessions it owns. */
interface LiveAttachment {
  id: string;
  userId: string;
  role: Role;
  owns: string[];
}

/** A hibernatable live socket as the hub sees it. */
function liveSocket(ws: WebSocket): LiveSocket {
  const get = () => ws.deserializeAttachment() as LiveAttachment;
  return {
    id: get().id,
    userId: get().userId,
    role: get().role,
    get owns() {
      return get().owns.slice();
    },
    set owns(owns: string[]) {
      ws.serializeAttachment({ ...get(), owns } satisfies LiveAttachment);
    },
    send: (m) => ws.send(m),
  };
}

/** Creates a table with a trigger in a scratch table set and reports whether the trigger fired. */
function triggerCheck(run: (sql: string, ...params: unknown[]) => unknown[]) {
  run('CREATE TABLE IF NOT EXISTS _tc_t (id TEXT PRIMARY KEY)');
  run('CREATE TABLE IF NOT EXISTS _tc_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, pk TEXT, UNIQUE (pk))');
  run(`CREATE TRIGGER IF NOT EXISTS _tc_tr AFTER INSERT ON _tc_t BEGIN
         INSERT OR REPLACE INTO _tc_log (pk) VALUES (NEW.id); END`);
  const id = crypto.randomUUID();
  run('INSERT INTO _tc_t (id) VALUES (?)', id);
  return { fired: run('SELECT seq FROM _tc_log WHERE pk = ?', id).length === 1 };
}

/**
 * The three ways to make an async mutator atomic on DO SQLite, tried side by
 * side with a "mutator" that writes, awaits, writes and throws.
 */
async function transactionProbe(storage: DurableObjectStorage) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS _probe (id TEXT PRIMARY KEY)');
  const mutator = async (id: string) => {
    sql.exec('INSERT INTO _probe (id) VALUES (?)', id + '-a');
    await Promise.resolve();
    sql.exec('INSERT INTO _probe (id) VALUES (?)', id + '-b');
    throw new Error('mutator failed');
  };
  const left = (id: string) => sql.exec('SELECT id FROM _probe WHERE id LIKE ?', id + '%').toArray().map((r) => r.id);
  const outcome = async (run: () => unknown) => {
    try {
      await run();
      return 'no error';
    } catch (e) {
      return (e as Error).message;
    }
  };

  const id1 = crypto.randomUUID();
  const begin = await outcome(() => sql.exec('BEGIN'));
  const id2 = crypto.randomUUID();
  // transactionSync commits when the callback returns, i.e. at the first await.
  const sync = await outcome(() =>
    storage.transactionSync(() => {
      mutator(id2).catch(() => undefined); // its rejection arrives after the commit
    }),
  );
  await new Promise((r) => setTimeout(r, 10));
  const id3 = crypto.randomUUID();
  const asyncTx = await outcome(() => storage.transaction(() => mutator(id3)));
  return {
    rawBegin: { error: begin, rowsLeft: left(id1) },
    transactionSync: { error: sync, rowsLeft: left(id2) },
    transaction: { error: asyncTx, rowsLeft: left(id3) },
  };
}

function d1Sql(db: D1Database): GlobalSql {
  return {
    all: async (sql, params = []) => (await db.prepare(sql).bind(...params).all<Row>()).results,
    run: async (sql, params = []) => (await db.prepare(sql).bind(...params).run()).meta.changes,
    batch: async (statements) => (await db.batch(statements.map(([sql, params]) => db.prepare(sql).bind(...params)))).map((r) => r.meta.changes),
  };
}

/** The global tables and the auth routes, made once per isolate (and again if the migration failed). */
let ready: Promise<{ accounts: Accounts; auth: Hono }> | undefined;
function globals(env: Env) {
  ready ??= (async () => {
    const sql = d1Sql(env.DB);
    await migrateGlobal(sql);
    const accounts = new Accounts(sql, { sessionIdleMs: env.SESSION_IDLE_MS ? Number(env.SESSION_IDLE_MS) : undefined });
    const auth = authRoutes({
      accounts,
      setupToken: env.SETUP_TOKEN || null,
      clientAddress: (c) => c.req.header('cf-connecting-ip') ?? 'unknown',
      google: googleOf(env),
      passkeys: passkeysOf(env),
      freshSignInMs: env.FRESH_SIGN_IN_MS ? Number(env.FRESH_SIGN_IN_MS) : undefined,
      debug: env.SPIKE_DEBUG === '1',
      log: (e) => console.warn(JSON.stringify(e)),
    });
    return { accounts, auth };
  })().catch((e: unknown) => {
    ready = undefined;
    throw e;
  });
  return ready;
}

/** Paths an organisation's Durable Object answers; everything else is the global auth API. */
const orgPaths = ['/api/sync/', '/api/bibles/', '/api/media/', '/api/live/', '/api/debug/dump', '/api/debug/triggers', '/api/debug/tx-probe'];

const worker = new Hono<{ Bindings: Env }>();

worker.use('/api/debug/*', async (c, next) => (c.env.SPIKE_DEBUG === '1' ? next() : c.notFound()));
// Triggers in local D1: same check as in the Durable Object.
worker.get('/api/debug/d1-triggers', async (c) => {
  const db = c.env.DB;
  await db.prepare('CREATE TABLE IF NOT EXISTS _tc_t (id TEXT PRIMARY KEY)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS _tc_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, pk TEXT, UNIQUE (pk))').run();
  await db
    .prepare(`CREATE TRIGGER IF NOT EXISTS _tc_tr AFTER INSERT ON _tc_t BEGIN
                INSERT OR REPLACE INTO _tc_log (pk) VALUES (NEW.id); END`)
    .run();
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO _tc_t (id) VALUES (?)').bind(id).run();
  const { results } = await db.prepare('SELECT seq FROM _tc_log WHERE pk = ?').bind(id).all();
  return c.json({ fired: results.length === 1 });
});

// Sign-in and users are answered here, against D1. Everything for an
// organisation is authenticated against D1, then handed to its Durable Object.
// Public outputs and saved screens (spec 04 §5, §6): anonymous. The code names the organisation and the output.
const toOutput = (c: Context<{ Bindings: Env }>, target: { orgId: string; orgName: string; displayId: string }, key: string) => {
  const stub = c.env.ORG.get(c.env.ORG.idFromName(target.orgId));
  const headers = new Headers(c.req.raw.headers);
  for (const h of ['x-user', 'x-role']) headers.delete(h);
  headers.set('x-org', target.orgId);
  headers.set('x-display', target.displayId);
  headers.set('x-org-name', encodeURIComponent(target.orgName));
  headers.set('x-code', key);
  return stub.fetch(new Request(c.req.raw, { headers }));
};
for (const kind of ['watch', 'display']) {
  worker.get(`/api/${kind}/:code/*`, async (c) => {
    const { accounts } = await globals(c.env); // the global tables are migrated before the first lookup
    const target = await lookupThrottled(new WatchRegistry(d1Sql(c.env.DB)), accounts, c.req.param('code'), c.req.header('cf-connecting-ip') ?? 'unknown');
    if (target && 'lockedUntil' in target) return watchLocked(target.lockedUntil);
    if (!target) return c.json({ error: 'not-found' }, 404);
    return toOutput(c, target, c.req.param('code'));
  });
}
// A temporary screen (spec 04 §5): its id, a secret, names the organisation it is paired with.
worker.get('/api/screen/:id/*', async (c) => {
  await globals(c.env);
  const target = await new ScreenRegistry(d1Sql(c.env.DB)).orgOf(c.req.param('id'));
  if (!target) return c.json({ error: 'not-found' }, 404);
  return toOutput(c, { ...target, displayId: c.req.param('id') }, c.req.param('id'));
});
// Made once per isolate, like the auth routes: every TV showing a code asks every 3 s.
let screenStart: Hono | undefined;
worker.post('/api/screen', async (c) => {
  const { accounts } = await globals(c.env);
  screenStart ??= screenStartRoutes({ screens: new ScreenRegistry(d1Sql(c.env.DB)), accounts, clientAddress: (x) => x.req.header('cf-connecting-ip') ?? 'unknown' });
  return screenStart.fetch(c.req.raw);
});

// The web app, as the Node server serves it (node.ts): every request reaches the Worker first
// (`run_worker_first`), so the app gets its CSP and index.html and /sw.js get `no-cache`.
worker.all('*', async (c, next) => {
  const assets = c.env.ASSETS;
  if (!assets || isApiPath(c.req.path)) return next();
  // With `html_handling = "none"` /index.html is served as it is, never redirected to `/`: the
  // service worker keeps it under that name, and a kept redirect would break navigation offline.
  const res = await assets.fetch(isAppPage(c.req.path) ? new Request(new URL('/index.html', c.req.url), c.req.raw) : c.req.raw);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(staticHeaders(c.req.path))) out.headers.set(k, v);
  return out;
});

worker.all('*', async (c) => {
  const { accounts, auth } = await globals(c.env);
  if (!orgPaths.some((p) => c.req.path.startsWith(p))) return auth.fetch(c.req.raw);
  const caller = await authenticate(c.req.raw, accounts);
  if (caller instanceof Response) return caller;
  const stub = c.env.ORG.get(c.env.ORG.idFromName(caller.orgId));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-user', caller.ctx.userId);
  headers.set('x-role', caller.ctx.role);
  headers.set('x-org', caller.orgId);
  return stub.fetch(new Request(c.req.raw, { headers }));
});

export default worker;
