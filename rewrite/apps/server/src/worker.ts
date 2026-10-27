import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { Hono } from 'hono';
import { migrateOrgSchemaSync, schema, serverChangeTriggers, serverSyncDdl, type Poke, type Role, type Tx } from '@gp/core';
import { syncRoutes, type Org } from './app.ts';
import { authenticate, authRoutes, WS_PROTOCOL } from './auth.ts';
import { GoogleOidc, TEST_ISSUER_BUILD } from './google.ts';
import { Accounts, migrateGlobal, type GlobalSql, type Row } from './global.ts';
import { r2Storage, type R2Like } from './media.ts';
import { Passkeys } from './webauthn.ts';
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const poke = new PokeCoalescer((exclude, seq) => {
      const msg = JSON.stringify({ type: 'poke', seq } satisfies Poke);
      for (const ws of ctx.getWebSockets()) if (ctx.getTags(ws)[0] !== exclude) ws.send(msg);
    }, Number(env.POKE_WINDOW_MS ?? 500));
    this.org = { store: durableSqliteStore(ctx.storage), queue: new SerialQueue(), poke };
    // The Worker has authenticated the caller against D1 and passes the result in headers.
    this.app = syncRoutes(async (c) => {
      const userId = c.req.header('x-user')!;
      const role = c.req.header('x-role') as Role;
      // Sync needs neither when the session signed in nor how: those matter only to the auth routes.
      return { caller: { orgId: c.req.header('x-org')!, sessionId: '', ctx: { userId, role }, signedInAt: 0, paired: true }, org: this.org };
    }, env.SPIKE_DEBUG === '1', env.MEDIA ? r2Storage(env.MEDIA as unknown as R2Like) : null, env.MEDIA_GRACE_MS ? Number(env.MEDIA_GRACE_MS) : undefined);
    this.app.get('/api/debug/triggers', (c) => c.json(triggerCheck((s, ...p) => ctx.storage.sql.exec(s, ...p).toArray())));
    this.app.get('/api/debug/tx-probe', async (c) => c.json(await transactionProbe(ctx.storage)));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') === 'websocket') {
      const clientId = new URL(request.url).searchParams.get('clientId') ?? '';
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [clientId]);
      // The client offered credentials as subprotocols too; the answer names only this one.
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'sec-websocket-protocol': WS_PROTOCOL } });
    }
    return this.app.fetch(request);
  }

  override async webSocketMessage() {}
  override async webSocketClose(ws: WebSocket, code: number) {
    ws.close(code, 'closing');
  }
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
const orgPaths = ['/api/sync/', '/api/bibles/', '/api/media/', '/api/debug/dump', '/api/debug/triggers', '/api/debug/tx-probe'];

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
