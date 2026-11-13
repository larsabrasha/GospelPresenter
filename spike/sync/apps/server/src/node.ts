import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';
import type BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { WebSocketServer, type WebSocket } from 'ws';
import { orgDdl, schema, serverChangeTriggers, serverSyncDdl, type Poke, type Role, type Tx } from '@spike/core';
import { adminRoutes, authenticate, globalDdl, syncRoutes, type GlobalStore, type Org } from './app.ts';
import { PokeCoalescer, SerialQueue, type OrgStore } from './sync-server.ts';

const require = createRequire(import.meta.url);

export type NodeDriver = 'better-sqlite3' | 'node:sqlite';

/** A synchronous SQLite connection, whichever driver opened it. */
interface SqliteFile {
  query(sql: string, params?: unknown[]): Record<string, unknown>[];
  exec(sql: string): void;
  inTransaction(): boolean;
  drizzle(): Tx;
  close(): void;
}

function openBetterSqlite3(file: string): SqliteFile {
  // Loaded lazily, so a node:sqlite build never needs the native module.
  // better-sqlite3 13 is a Node-API addon: the same binary loads in Node 22 and Electron 45.
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  const db = new Database(file);
  return {
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (stmt.reader) return stmt.all(...params) as Record<string, unknown>[];
      stmt.run(...params);
      return [];
    },
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
  for (const s of [...orgDdl, ...serverSyncDdl, ...serverChangeTriggers()]) f.exec(s);
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

function nodeGlobalStore(f: SqliteFile): GlobalStore {
  for (const s of globalDdl) f.exec(s);
  return {
    async role(userId, orgId) {
      const [row] = f.query('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
      return (row?.role as Role | undefined) ?? null;
    },
    async setRole(userId, orgId, role) {
      f.query('INSERT OR REPLACE INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)', [userId, orgId, role]);
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
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** The whole server on Node: Hono over HTTP, one SQLite file per organisation plus a global one, `ws` pokes. */
export async function startNodeServer(opts: NodeServerOptions): Promise<RunningServer> {
  const driver = opts.driver ?? 'better-sqlite3';
  mkdirSync(opts.dataDir, { recursive: true });
  const globalFile = openSqlite(join(opts.dataDir, 'global.sqlite'), driver);
  const global = nodeGlobalStore(globalFile);
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

  const app = new Hono();
  if (opts.debug) app.route('/', adminRoutes(global));
  app.route(
    '/',
    syncRoutes(async (c) => {
      const caller = await authenticate(c.req.raw, global);
      if (caller instanceof Response) return caller;
      return { caller, org: openOrg(caller.orgId) };
    }, !!opts.debug),
  );
  if (opts.webRoot) app.use('/*', serveStatic({ root: opts.webRoot }));

  const server = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname: opts.hostname ?? '127.0.0.1' });
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', () => resolve())));

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const caller = url.pathname === '/sync/poke' ? await authenticate(new Request(url), global) : null;
    if (!caller || caller instanceof Response) return void socket.destroy();
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
