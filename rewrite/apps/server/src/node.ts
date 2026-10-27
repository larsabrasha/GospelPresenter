import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { serve, type HttpBindings } from '@hono/node-server';
import type BetterSqlite3 from 'better-sqlite3';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { WebSocketServer, type WebSocket } from 'ws';
import { migrateOrgSchemaSync, schema, serverChangeTriggers, serverSyncDdl, type Poke, type Tx } from '@gp/core';
import { syncRoutes, type Org } from './app.ts';
import { authenticate, authRoutes, deviceOf, pairingGuard, isApiPath, WS_PROTOCOL, type Pairing } from './auth.ts';
import { newSecret } from './crypto.ts';
import { GoogleOidc, type GoogleConfig } from './google.ts';
import { Accounts, migrateGlobal, type GlobalSql } from './global.ts';
import { diskStorage } from './media-disk.ts';
import type { MediaStorage } from './media.ts';
import { Passkeys, type PasskeyConfig } from './webauthn.ts';
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

/**
 * Headers for the static app: a strict CSP (ADR 0007, decision 6). wa-sqlite
 * compiles WebAssembly, and React sets inline style attributes.
 */
const STATIC_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

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
  /** Where refused sign-ins are reported (JSON on stderr by default). */
  log?: (event: Record<string, unknown>) => void;
}

export interface RunningServer {
  url: string;
  port: number;
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
  const setupToken = opts.setupToken ?? newSecret('gpst_');
  const orgs = new Map<string, Org & { file: SqliteFile; sockets: Map<WebSocket, string> }>();

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
      org = { file, store: nodeOrgStore(file), queue: new SerialQueue(), poke, sockets };
      orgs.set(orgId, org);
    }
    return org;
  }

  const google = opts.google ? new GoogleOidc(opts.google) : null;
  const passkeys = opts.passkeys ? new Passkeys(opts.passkeys) : null;
  const clientAddress = (c: Context) => (c.env as HttpBindings).incoming.socket.remoteAddress ?? 'unknown';
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
  app.route(
    '/',
    syncRoutes(async (c) => {
      const caller = await authenticate(c.req.raw, accounts);
      if (caller instanceof Response) return caller;
      return { caller, org: openOrg(caller.orgId) };
    }, !!opts.debug, opts.media ?? diskStorage(join(opts.dataDir, 'media')), opts.mediaGraceMs),
  );
  if (opts.webRoot) {
    app.use('/*', async (c, next) => {
      if (isApiPath(c.req.path)) return c.json({ error: 'not-found' }, 404);
      await next();
      for (const [k, v] of Object.entries(STATIC_HEADERS)) c.header(k, v);
    });
    app.use('/*', serveStatic({ root: opts.webRoot }));
    // An address with no file behind it is a page of the app: the client's router draws it.
    app.get('*', (c, next) => (/\.[a-z0-9]+$/i.test(c.req.path) ? next() : serveStatic({ root: opts.webRoot, path: 'index.html' })(c, next)));
  }

  const server = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname: opts.hostname ?? '127.0.0.1' });
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', () => resolve())));

  // Credentials arrive as subprotocols (see `credentials`); the answer names only WS_PROTOCOL.
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (offered) => (offered.has(WS_PROTOCOL) ? WS_PROTOCOL : false) });
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(url, { headers });
    if (url.pathname !== '/sync/poke') return void socket.destroy();
    if (opts.pairing && !(await deviceOf(request, accounts, opts.pairing))) return void socket.destroy();
    const caller = await authenticate(request, accounts);
    if (caller instanceof Response) return void socket.destroy();
    const clientId = url.searchParams.get('clientId') ?? '';
    const org = openOrg(caller.orgId);
    wss.handleUpgrade(req, socket, head, (ws) => {
      org.sockets.set(ws, clientId);
      ws.on('close', () => org.sockets.delete(ws));
    });
  });

  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://${opts.hostname && opts.hostname !== '0.0.0.0' ? opts.hostname : '127.0.0.1'}:${port}`,
    setupToken: (await accounts.setupDone()) ? null : setupToken,
    async close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
      for (const o of orgs.values()) o.file.close();
      globalFile.close();
    },
  };
}
