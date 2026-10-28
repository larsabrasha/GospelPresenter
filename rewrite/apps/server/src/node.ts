import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { serve, type HttpBindings, type ServerType } from '@hono/node-server';
import { createServer as createHttpsServer } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type BetterSqlite3 from 'better-sqlite3';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { WebSocketServer, type WebSocket } from 'ws';
import { migrateOrgSchemaSync, schema, serverChangeTriggers, serverSyncDdl, type Poke, type Tx } from '@gp/core';
import { outputRoutes, syncRoutes, watchLocked, type Org } from './app.ts';
import { authenticate, authRoutes, deviceOf, pairingGuard, isApiPath, WS_PROTOCOL, type Pairing } from './auth.ts';
import { newSecret } from './crypto.ts';
import { GoogleOidc, type GoogleConfig } from './google.ts';
import { Accounts, migrateGlobal, type GlobalSql } from './global.ts';
import { LiveHub, type LiveSocket } from './live-hub.ts';
import { diskStorage } from './media-disk.ts';
import type { MediaStorage } from './media.ts';
import { forwardedClient, trustedProxies } from './proxy.ts';
import { screenPairRoutes, screenStartRoutes } from './screen-routes.ts';
import { ScreenRegistry } from './screens.ts';
import { isAppPage, staticHeaders } from './static.ts';
import { Passkeys, type PasskeyConfig } from './webauthn.ts';
import { lookupThrottled, WatchRegistry } from './watch.ts';
import { PokeCoalescer, SerialQueue, type OrgStore } from '@gp/sync/server';

const require = createRequire(import.meta.url);

export type NodeDriver = 'better-sqlite3' | 'node:sqlite';

/** A synchronous SQLite connection, whichever driver opened it. */
interface SqliteFile {
  query(sql: string, params?: unknown[]): Record<string, unknown>[];
  /** Runs one writing statement and returns the number of rows it changed. */
  run(sql: string, params?: unknown[]): number;
  exec(sql: string): void;
  inTransaction(): boolean;
  drizzle(): Tx;
  close(): void;
}

function openBetterSqlite3(file: string): SqliteFile {
  // Loaded lazily (with Drizzle's driver, which imports it), so a node:sqlite
  // build never needs the native module.
  // better-sqlite3 13 is a Node-API addon: the same binary loads in Node 22 and Electron 45.
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  const { drizzle } = require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
  const db = new Database(file);
  return {
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (stmt.reader) return stmt.all(...params) as Record<string, unknown>[];
      stmt.run(...params);
      return [];
    },
    run: (sql, params = []) => db.prepare(sql).run(...params).changes,
    exec: (sql) => void db.exec(sql),
    inTransaction: () => db.inTransaction,
    drizzle: () => drizzle(db, { schema }) as unknown as Tx,
    close: () => db.close(),
  };
}

/**
 * Node's built-in node:sqlite (Electron 45 ships Node 24): an option that
 * needs no native module at all. Drizzle 0.45 has no node:sqlite
 * driver; sqlite-proxy wraps it (an async driver over a sync connection),
 * which the async mutators do not notice.
 */
function openNodeSqlite(file: string): SqliteFile {
  const { DatabaseSync: Db } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
  const db = new Db(file);
  db.exec('PRAGMA foreign_keys = ON'); // better-sqlite3's default; node:sqlite leaves it off
  return {
    query: (sql, params = []) => db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[],
    run: (sql, params = []) => Number(db.prepare(sql).run(...(params as never[])).changes),
    exec: (sql) => db.exec(sql),
    inTransaction: () => db.isTransaction,
    drizzle: () =>
      drizzleProxy(
        async (sql, params, method) => {
          const stmt = db.prepare(sql);
          stmt.setReturnArrays(true);
          const rows = stmt.all(...(params as never[])) as unknown as unknown[][];
          return { rows: method === 'get' ? (rows[0] as unknown[]) : rows };
        },
        { schema },
      ) as unknown as Tx,
    close: () => db.close(),
  };
}

export function openSqlite(file: string, driver: NodeDriver): SqliteFile {
  const f = driver === 'node:sqlite' ? openNodeSqlite(file) : openBetterSqlite3(file);
  f.exec('PRAGMA journal_mode = WAL');
  return f;
}

/** An organisation's SQLite file as an OrgStore. */
export function nodeOrgStore(f: SqliteFile): OrgStore {
  migrateOrgSchemaSync(f.query, (fn) => {
    f.exec('BEGIN IMMEDIATE');
    try {
      fn();
      f.exec('COMMIT');
    } catch (e) {
      if (f.inTransaction()) f.exec('ROLLBACK');
      throw e;
    }
  });
  for (const s of [...serverSyncDdl, ...serverChangeTriggers()]) f.exec(s);
  return {
    db: f.drizzle(),
    query: f.query,
    // better-sqlite3's own db.transaction() refuses async functions. Instead an
    // explicit BEGIN/COMMIT around the awaited mutator: safe because the
    // caller's SerialQueue lets nothing else touch this connection meanwhile,
    // and the mutator awaits only this connection's synchronous queries.
    async transaction(fn) {
      f.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        f.exec('COMMIT');
        return result;
      } catch (e) {
        if (f.inTransaction()) f.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** The global SQLite file as `GlobalSql`. Every call is synchronous underneath, so a batch cannot interleave with anything. */
export function nodeGlobalSql(f: SqliteFile): GlobalSql {
  return {
    all: async (sql, params) => f.query(sql, params),
    run: async (sql, params) => f.run(sql, params),
    async batch(statements) {
      f.exec('BEGIN IMMEDIATE');
      try {
        const changes = statements.map(([sql, params]) => f.run(sql, params));
        f.exec('COMMIT');
        return changes;
      } catch (e) {
        if (f.inTransaction()) f.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export interface NodeServerOptions {
  dataDir: string;
  /** better-sqlite3 (default) or Node's built-in node:sqlite (used inside Electron). */
  driver?: NodeDriver;
  port?: number;
  hostname?: string;
  pokeWindowMs?: number;
  debug?: boolean;
  /** A built web app to serve from the same origin, as the desktop does for tablets on the LAN. */
  webRoot?: string;
  /**
   * Where picture blobs are kept (D31): a folder, `{dataDir}/media` by
   * default. Pass another storage to keep them elsewhere (tests, later S3).
   */
  media?: MediaStorage;
  /** How long a picture blob nothing names is kept: an hour (tests shorten it). */
  mediaGraceMs?: number;
  /** What first-run setup must be given (D19). Without one, a random one is made at start; see `RunningServer.setupToken`. */
  setupToken?: string;
  /** Refuse every API request from a device that is not paired (the desktop host). */
  pairing?: Pairing;
  sessionIdleMs?: number;
  /** Sign-in with Google. */
  google?: GoogleConfig;
  /**
   * Passkeys: the RP ID and the origins ceremonies may come from. Without it
   * and without Google nobody can sign in or set up; paired devices and
   * existing sessions still work.
   */
  passkeys?: PasskeyConfig;
  /** How young a session must be to add a login (tests shorten it). */
  freshSignInMs?: number;
  /**
   * Also serve over https, with a certificate the operator provides (PEM),
   * on its own port and address: on a desktop host, the LAN gets https while
   * the host's own window keeps http on 127.0.0.1. A device that trusts the
   * certificate is then a secure context (OPFS, Web Crypto). See README,
   * "https on the LAN".
   */
  tls?: { key: string | Buffer; cert: string | Buffer; port?: number; hostname?: string };
  /**
   * Reverse proxies (addresses or CIDR blocks) whose `X-Forwarded-For` names
   * the client, for the throttles and the host's own sign-in. Without them the
   * header is ignored. See README, "Behind a reverse proxy".
   */
  trustedProxies?: string[];
  /** Where refused sign-ins are reported (JSON on stderr by default). */
  log?: (event: Record<string, unknown>) => void;
}

export interface RunningServer {
  url: string;
  port: number;
  /** The https listener, when `tls` was given. */
  tls: { url: string; port: number } | null;
  /** While setup is not finished: the token it needs. Null once someone has signed in. */
  setupToken: string | null;
  close(): Promise<void>;
}

/** The whole server on Node: Hono over HTTP, one SQLite file per organisation plus a global one, `ws` pokes. */
export async function startNodeServer(opts: NodeServerOptions): Promise<RunningServer> {
  const driver = opts.driver ?? 'better-sqlite3';
  mkdirSync(opts.dataDir, { recursive: true });
  const globalFile = openSqlite(join(opts.dataDir, 'global.sqlite'), driver);
  const globalSql = nodeGlobalSql(globalFile);
  await migrateGlobal(globalSql);
  const accounts = new Accounts(globalSql, { sessionIdleMs: opts.sessionIdleMs });
  const watch = new WatchRegistry(globalSql);
  const screens = new ScreenRegistry(globalSql);
  const setupToken = opts.setupToken ?? newSecret('gpst_');
  const orgs = new Map<string, Org & { file: SqliteFile; sockets: Map<WebSocket, string>; live: LiveHub; liveSockets: Map<WebSocket, LiveSocket> }>();

  // Synchronous, so two requests can never open the same organisation twice.
  function openOrg(orgId: string) {
    let org = orgs.get(orgId);
    if (!org) {
      const file = openSqlite(join(opts.dataDir, `org-${encodeURIComponent(orgId)}.sqlite`), driver);
      const sockets = new Map<WebSocket, string>();
      const poke = new PokeCoalescer((exclude, seq) => {
        const msg = JSON.stringify({ type: 'poke', seq } satisfies Poke);
        for (const [ws, clientId] of sockets) if (clientId !== exclude) ws.send(msg);
      }, opts.pokeWindowMs);
      const store = nodeOrgStore(file);
      const liveSockets = new Map<WebSocket, LiveSocket>();
      const queue = new SerialQueue();
      const live = new LiveHub(
        store,
        () => [...liveSockets.values()],
        Date.now,
        (ids) => void screens.release(ids).catch(() => undefined),
        (fn, ms) => setTimeout(() => void queue.run(async () => fn()).catch(() => undefined), ms),
      );
      org = { file, store, queue, poke, sockets, live, liveSockets };
      orgs.set(orgId, org);
    }
    return org;
  }

  const google = opts.google ? new GoogleOidc(opts.google) : null;
  const passkeys = opts.passkeys ? new Passkeys(opts.passkeys) : null;
  const proxies = opts.trustedProxies?.length ? trustedProxies(opts.trustedProxies) : null;
  const socketAddress = (c: Context) => (c.env as HttpBindings).incoming.socket.remoteAddress ?? 'unknown';
  const clientAddress = proxies ? (c: Context) => forwardedClient(socketAddress(c), c.req.header('x-forwarded-for'), proxies) : socketAddress;
  const app = new Hono<{ Bindings: HttpBindings }>();
  if (opts.pairing) app.use('*', pairingGuard(accounts, opts.pairing, clientAddress));
  app.route(
    '/',
    authRoutes({
      accounts,
      setupToken,
      clientAddress,
      google,
      passkeys,
      freshSignInMs: opts.freshSignInMs,
      pairing: opts.pairing,
      debug: opts.debug,
      log: opts.log ?? ((e) => process.stderr.write(JSON.stringify(e) + '\n')),
    }),
  );
  const media = opts.media ?? diskStorage(join(opts.dataDir, 'media'));
  // Public outputs and saved screens are found by their code, temporary screens by their id (spec 04 §5, §6).
  for (const kind of ['watch', 'display'] as const) {
    app.route(
      '/',
      outputRoutes(kind, async (c, code) => {
        const t = await lookupThrottled(watch, accounts, code, clientAddress(c));
        if (t && 'lockedUntil' in t) return watchLocked(t.lockedUntil);
        if (!t) return null;
        const org = openOrg(t.orgId);
        return { org, live: org.live, orgId: t.orgId, orgName: t.orgName, displayId: t.displayId, code };
      }, media),
    );
  }
  app.route(
    '/',
    outputRoutes('screen', async (_c, id) => {
      const t = await screens.orgOf(id);
      if (!t) return null;
      const org = openOrg(t.orgId);
      return { org, live: org.live, orgId: t.orgId, orgName: t.orgName, displayId: id, code: id };
    }, media),
  );
  const resolveCaller = async (c: Context) => {
    const caller = await authenticate(c.req.raw, accounts);
    if (caller instanceof Response) return caller;
    return { caller, org: openOrg(caller.orgId) };
  };
  app.route('/', screenStartRoutes({ screens, accounts, clientAddress }));
  app.route('/', screenPairRoutes(resolveCaller, { screens, accounts, clientAddress }));
  app.route(
    '/',
    syncRoutes(resolveCaller, {
      debug: !!opts.debug,
      media,
      mediaGraceMs: opts.mediaGraceMs,
      watch,
    }),
  );
  if (opts.webRoot) {
    app.use('/*', async (c, next) => {
      if (isApiPath(c.req.path)) return c.json({ error: 'not-found' }, 404);
      await next();
      for (const [k, v] of Object.entries(staticHeaders(c.req.path))) c.header(k, v);
    });
    app.use('/*', serveStatic({ root: opts.webRoot }));
    app.get('*', (c, next) => (isAppPage(c.req.path) ? serveStatic({ root: opts.webRoot, path: 'index.html' })(c, next) : next()));
  }

  const listening = (srv: ServerType) => new Promise<void>((resolve) => (srv.listening ? resolve() : srv.once('listening', () => resolve())));
  const server = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname: opts.hostname ?? '127.0.0.1' });
  await listening(server);
  // The same app over https, for the LAN (README, "https on the LAN").
  const secure = opts.tls
    ? serve({
        fetch: app.fetch,
        port: opts.tls.port ?? 0,
        hostname: opts.tls.hostname ?? '127.0.0.1',
        createServer: createHttpsServer,
        serverOptions: { key: opts.tls.key, cert: opts.tls.cert },
      })
    : null;
  if (secure) await listening(secure);

  // Credentials arrive as subprotocols (see `credentials`); the answer names only WS_PROTOCOL.
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (offered) => (offered.has(WS_PROTOCOL) ? WS_PROTOCOL : false) });
  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(url, { headers });
    if (url.pathname !== '/api/sync/poke' && url.pathname !== '/api/live/socket') return void socket.destroy();
    if (opts.pairing && !(await deviceOf(request, accounts, opts.pairing))) return void socket.destroy();
    const caller = await authenticate(request, accounts);
    if (caller instanceof Response) return void socket.destroy();
    const org = openOrg(caller.orgId);
    if (url.pathname === '/api/live/socket') {
      // Live sessions (spec 04): every call runs in the organisation's queue, never inside a mutation.
      return void wss.handleUpgrade(req, socket, head, (ws) => {
        const s: LiveSocket = { id: crypto.randomUUID(), userId: caller.ctx.userId, role: caller.ctx.role, owns: [], send: (m) => ws.send(m) };
        org.liveSockets.set(ws, s);
        // A failure here is a closing server: the socket is going with it.
        const run = (fn: () => void) => void org.queue.run(fn).catch(() => undefined);
        run(() => org.live.opened(s));
        ws.on('message', (data) => run(() => org.live.message(s, String(data))));
        ws.on('close', () => {
          org.liveSockets.delete(ws);
          run(() => org.live.closed(s));
        });
      });
    }
    const clientId = url.searchParams.get('clientId') ?? '';
    wss.handleUpgrade(req, socket, head, (ws) => {
      org.sockets.set(ws, clientId);
      ws.on('close', () => org.sockets.delete(ws));
    });
  };
  server.on('upgrade', onUpgrade);
  secure?.on('upgrade', onUpgrade);

  const port = (server.address() as AddressInfo).port;
  const local = (h: string | undefined) => (h && h !== '0.0.0.0' ? h : '127.0.0.1');
  const tlsPort = secure ? (secure.address() as AddressInfo).port : null;
  return {
    port,
    url: `http://${local(opts.hostname)}:${port}`,
    tls: secure && tlsPort ? { port: tlsPort, url: `https://${local(opts.tls?.hostname)}:${tlsPort}` } : null,
    setupToken: (await accounts.setupDone()) ? null : setupToken,
    async close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
      for (const srv of secure ? [server, secure] : [server]) {
        (srv as { closeAllConnections?: () => void }).closeAllConnections?.();
        await new Promise<void>((r) => srv.close(() => r()));
      }
      for (const o of orgs.values()) {
        o.live.dispose();
        o.file.close();
      }
      globalFile.close();
    },
  };
}
