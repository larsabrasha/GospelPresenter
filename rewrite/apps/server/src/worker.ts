import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { Hono, type Context } from 'hono';
import { labelSeedSql, migrateOrgSchemaSync, schema, serverChangeTriggers, serverSyncDdl, type Poke, type Role, type Tx } from '@gp/core';
import { outputRoutes, syncRoutes, type Org } from './app.ts';
import { playRoutes } from './video-routes.ts';
import { authenticate, authRoutes, credentials, isApiPath, WS_PROTOCOL } from './auth/index.ts';
import { mailConfigFrom } from './mail.ts';
import { GoogleOidc, TEST_ISSUER_BUILD } from './google.ts';
import { Accounts, migrateGlobal, tooManyAttempts, type GlobalSql, type Row } from './global/index.ts';
import { LiveHub, type LiveSocket } from './live-hub.ts';
import { logServerErrors } from './server-error.ts';
import { LIVE_SESSION_CHECK_MS, liveSessionHolds, liveTokenHash } from './live-session.ts';
import { r2Storage, type R2Like } from './media.ts';
import { PlayTokens } from './play-tokens.ts';
import { Passkeys } from './webauthn.ts';
import { lookupThrottled, WatchRegistry } from './watch.ts';
import { screenPairRoutes, screenStartRoutes } from './screen-routes.ts';
import { ScreenRegistry } from './screens.ts';
import { isAppPage, staticHeaders } from './static.ts';
import { PokeCoalescer, SerialQueue, type OrgStore } from '@gp/sync/server';
import { appCors } from './cors.ts';

interface Env {
  DB: D1Database;
  /** Where picture blobs are kept (D31). Without the binding the media endpoints answer 503. */
  MEDIA?: R2Bucket;
  ORG: DurableObjectNamespace<OrgDurableObject>;
  SPIKE_DEBUG?: string;
  POKE_WINDOW_MS?: string;
  /** What first-run setup must be given (D19). Unset: setup stays closed. A secret, so never in wrangler.toml. */
  SETUP_TOKEN?: string;
  /** The Superadmins' addresses, comma-separated (docs/accounts-and-roles.md); without it the mark setup gave counts. */
  SUPER_ADMINS?: string;
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
  /** How long a live socket's session is trusted before its next message checks it (`LIVE_SESSION_CHECK_MS`; tests shorten it). */
  LIVE_SESSION_CHECK_MS?: string;
  /** The built web app (Workers static assets, wrangler.toml's [assets]). Without it, only the API answers. */
  ASSETS?: Fetcher;
  /** E-mail through Resend: the key (a secret), the sender ("Gospel Presenter <noreply@example.org>") and the app's public address for links. All three, or no mail. */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  APP_URL?: string;
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
  // After the change triggers, so the default labels sync like any change (SONG-R47).
  for (const s of [...serverSyncDdl, ...serverChangeTriggers(), ...labelSeedSql]) run(s);
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
  private accounts: Accounts;
  private liveSessionCheckMs: number;

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
      return { caller: { orgId: c.req.header('x-org')!, sessionId: c.req.header('x-session') ?? '', ctx: { userId, role }, signedInAt: 0, paired: true }, org: this.org };
    };
    this.app = syncRoutes(resolveCaller, {
      debug: env.SPIKE_DEBUG === '1',
      media: env.MEDIA ? r2Storage(env.MEDIA as unknown as R2Like) : null,
      mediaGraceMs: env.MEDIA_GRACE_MS ? Number(env.MEDIA_GRACE_MS) : undefined,
      // The organisation's object writes its codes to the global index in D1.
      watch: new WatchRegistry(d1Sql(env.DB)),
      playTokens: new PlayTokens(d1Sql(env.DB)),
    });
    // The organisation's routes log what they throw too; the Worker's own are in `globals`.
    logServerErrors(this.app, (e) => console.warn(JSON.stringify(e)));
    const media = env.MEDIA ? r2Storage(env.MEDIA as unknown as R2Like) : null;
    // A video's stream: the Worker checked the token in D1 and names its organisation (only it reaches this object).
    this.app.route(
      '/',
      playRoutes(async (c) => {
        const orgId = c.req.header('x-play-org');
        return orgId ? { org: this.org, orgId } : null;
      }, media),
    );
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
    this.accounts = new Accounts(d1Sql(env.DB), { sessionIdleMs: env.SESSION_IDLE_MS ? Number(env.SESSION_IDLE_MS) : undefined, superAdmins: superAdminsOf(env) });
    this.liveSessionCheckMs = env.LIVE_SESSION_CHECK_MS ? Number(env.LIVE_SESSION_CHECK_MS) : LIVE_SESSION_CHECK_MS;
    this.app.route('/', screenPairRoutes(resolveCaller, { screens, accounts: this.accounts, clientAddress }));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') === 'websocket') {
      const url = new URL(request.url);
      const pair = new WebSocketPair();
      if (url.pathname === '/api/live/socket') {
        this.ctx.acceptWebSocket(pair[1], ['live']);
        pair[1].serializeAttachment({
          id: crypto.randomUUID(),
          userId: request.headers.get('x-user')!,
          role: request.headers.get('x-role') as Role,
          owns: [],
          tokenHash: await liveTokenHash(credentials(request).token),
          checkedAt: Date.now(),
        } satisfies LiveAttachment);
        const s = liveSocket(pair[1]);
        void this.org.queue.run(() => this.live.opened(s));
      } else this.ctx.acceptWebSocket(pair[1], ['poke', url.searchParams.get('clientId') ?? '']);
      // The client offered credentials as subprotocols too; the answer names only this one.
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'sec-websocket-protocol': WS_PROTOCOL } });
    }
    // The organisation was deleted (`DELETE /api/orgs/{id}`): only the Worker reaches this path, through the stub.
    if (new URL(request.url).pathname === '/internal/drop' && request.method === 'POST') {
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'organisation deleted');
      this.live.dispose();
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    return this.app.fetch(request);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (this.ctx.getTags(ws)[0] !== 'live') return;
    await this.org.queue.run(() => this.live.message(liveSocket(ws), typeof message === 'string' ? message : new TextDecoder().decode(message)));
    // After the message, never before it (live-session.ts): the session is checked again now and then.
    const a = ws.deserializeAttachment() as LiveAttachment;
    // A socket let in before sockets kept their session has none to check: it goes on until it reconnects.
    if (a.tokenHash === undefined || Date.now() - a.checkedAt < this.liveSessionCheckMs) return;
    ws.serializeAttachment({ ...a, checkedAt: Date.now() } satisfies LiveAttachment);
    if (!(await liveSessionHolds(this.accounts, a.tokenHash, a).catch(() => true))) ws.close(4401, 'session-ended');
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

/** What a live socket carries through hibernation: who it is, the sessions it owns, and its session to check again. */
interface LiveAttachment {
  id: string;
  userId: string;
  role: Role;
  owns: string[];
  /** The hash of the session token it was let in with (live-session.ts), never the token. */
  tokenHash: string | null;
  checkedAt: number;
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
    const accounts = new Accounts(sql, { sessionIdleMs: env.SESSION_IDLE_MS ? Number(env.SESSION_IDLE_MS) : undefined, superAdmins: superAdminsOf(env) });
    const auth = authRoutes({
      accounts,
      setupToken: env.SETUP_TOKEN || null,
      clientAddress: (c) => c.req.header('cf-connecting-ip') ?? 'unknown',
      google: googleOf(env),
      passkeys: passkeysOf(env),
      freshSignInMs: env.FRESH_SIGN_IN_MS ? Number(env.FRESH_SIGN_IN_MS) : undefined,
      mail: mailConfigFrom({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, appUrl: env.APP_URL }),
      dropOrgData: async (orgId) => {
        await env.ORG.get(env.ORG.idFromName(orgId)).fetch('https://org/internal/drop', { method: 'POST' });
        if (env.MEDIA) await r2Storage(env.MEDIA as unknown as R2Like).deleteAll(`org/${orgId}/`);
      },
      debug: env.SPIKE_DEBUG === '1',
      log: (e) => console.warn(JSON.stringify(e)),
    });
    logServerErrors(auth, (e) => console.warn(JSON.stringify(e)));
    return { accounts, auth };
  })().catch((e: unknown) => {
    ready = undefined;
    throw e;
  });
  return ready;
}

/** The headers the Worker tells an organisation's object who and what with: a request's own are never passed on. */
const TRUSTED = ['x-user', 'x-role', 'x-session', 'x-org', 'x-play-org', 'x-display', 'x-org-name', 'x-code'];

/** The request to organisation `orgId`'s object, with every trusted header the client sent removed and `trusted` set. */
function toOrg(c: Context<{ Bindings: Env }>, orgId: string, trusted: Record<string, string>): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  for (const h of TRUSTED) headers.delete(h);
  for (const [h, v] of Object.entries(trusted)) headers.set(h, v);
  return c.env.ORG.get(c.env.ORG.idFromName(orgId)).fetch(new Request(c.req.raw, { headers }));
}

/** Paths an organisation's Durable Object answers; everything else is the global auth API. */
const orgPaths = ['/api/sync/', '/api/bibles/', '/api/media/', '/api/live/', '/api/import/legacy', '/api/debug/dump'];

const worker = new Hono<{ Bindings: Env }>();

// The phone app's calls, before everything else: a preflight carries no credentials (cors.ts).
worker.use('/api/*', appCors());

worker.use('/api/debug/*', async (c, next) => (c.env.SPIKE_DEBUG === '1' ? next() : c.notFound()));

// Sign-in and users are answered here, against D1. Everything for an
// organisation is authenticated against D1, then handed to its Durable Object.
// Public outputs and saved screens (spec 04 §5, §6): anonymous. The code names the organisation and the output.
const toOutput = (c: Context<{ Bindings: Env }>, target: { orgId: string; orgName: string; displayId: string }, key: string) => {
  return toOrg(c, target.orgId, { 'x-org': target.orgId, 'x-display': target.displayId, 'x-org-name': encodeURIComponent(target.orgName), 'x-code': key });
};
for (const kind of ['watch', 'display']) {
  worker.get(`/api/${kind}/:code/*`, async (c) => {
    const { accounts } = await globals(c.env); // the global tables are migrated before the first lookup
    const target = await lookupThrottled(new WatchRegistry(d1Sql(c.env.DB)), accounts, c.req.param('code'), c.req.header('cf-connecting-ip') ?? 'unknown');
    if (target && 'lockedUntil' in target) return tooManyAttempts(target.lockedUntil, Date.now());
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
// A video's `<video src>` (TODO.md "Video"): the token, checked in D1, names the organisation; no session header.
worker.get('/api/play/:token/:hash', async (c) => {
  await globals(c.env);
  const orgId = await new PlayTokens(d1Sql(c.env.DB)).orgOf(c.req.param('token'), c.req.param('hash'));
  if (!orgId) return c.json({ error: 'not-found' }, 404);
  return toOrg(c, orgId, { 'x-play-org': orgId });
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
  // With the execution context, so work after an answer (a mail) is kept alive with waitUntil.
  if (!orgPaths.some((p) => c.req.path.startsWith(p))) return auth.fetch(c.req.raw, c.env, c.executionCtx);
  const caller = await authenticate(c.req.raw, accounts);
  if (caller instanceof Response) return caller;
  // A video's play token ends with the session (`x-session`).
  return toOrg(c, caller.orgId, { 'x-user': caller.ctx.userId, 'x-session': caller.sessionId, 'x-role': caller.ctx.role, 'x-org': caller.orgId });
});

export default worker;

/** `SUPER_ADMINS` as a list, or null without it. */
function superAdminsOf(env: Env): string[] | null {
  return env.SUPER_ADMINS ? env.SUPER_ADMINS.split(',').map((e) => e.trim()).filter(Boolean) : null;
}
