import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { WebSocketServer, type WebSocket } from 'ws';
import { orgDdl, schema, serverChangeTriggers, serverSyncDdl, type Poke, type Role, type Tx } from '@spike/core';
import { adminRoutes, authenticate, globalDdl, syncRoutes, type GlobalStore, type Org } from './app.ts';
import { PokeCoalescer, SerialQueue, type OrgStore } from './sync-server.ts';

/** An organisation's SQLite file on better-sqlite3. */
export function betterSqliteStore(db: Database.Database): OrgStore {
  db.pragma('journal_mode = WAL');
  for (const s of [...orgDdl, ...serverSyncDdl, ...serverChangeTriggers()]) db.exec(s);
  return {
    db: drizzle(db, { schema }) as unknown as Tx,
    query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (stmt.reader) return stmt.all(...params) as Record<string, unknown>[];
      stmt.run(...params);
      return [];
    },
    // better-sqlite3's own db.transaction() refuses async functions. Instead an
    // explicit BEGIN/COMMIT around the awaited mutator: safe because the
    // caller's SerialQueue lets nothing else touch this connection meanwhile,
    // and the mutator awaits only synchronous queries.
    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function globalStore(db: Database.Database): GlobalStore {
  for (const s of globalDdl) db.exec(s);
  return {
    async role(userId, orgId) {
      const row = db.prepare('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?').get(userId, orgId) as
        | { role: Role }
        | undefined;
      return row?.role ?? null;
    },
    async setRole(userId, orgId, role) {
      db.prepare('INSERT OR REPLACE INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)').run(userId, orgId, role);
    },
  };
}

export interface NodeServerOptions {
  dataDir: string;
  port?: number;
  hostname?: string;
  pokeWindowMs?: number;
  debug?: boolean;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** The whole server on Node: Hono over HTTP, one SQLite file per organisation, `ws` pokes. */
export async function startNodeServer(opts: NodeServerOptions): Promise<RunningServer> {
  mkdirSync(opts.dataDir, { recursive: true });
  const globalDb = new Database(join(opts.dataDir, 'global.sqlite'));
  const global = globalStore(globalDb);
  const orgs = new Map<string, Org & { db: Database.Database; sockets: Map<WebSocket, string> }>();

  function openOrg(orgId: string) {
    let org = orgs.get(orgId);
    if (!org) {
      const db = new Database(join(opts.dataDir, `org-${encodeURIComponent(orgId)}.sqlite`));
      const sockets = new Map<WebSocket, string>();
      const poke = new PokeCoalescer((exclude, seq) => {
        const msg = JSON.stringify({ type: 'poke', seq } satisfies Poke);
        for (const [ws, clientId] of sockets) if (clientId !== exclude) ws.send(msg);
      }, opts.pokeWindowMs);
      org = { db, store: betterSqliteStore(db), queue: new SerialQueue(), poke, sockets };
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

  const server = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname: opts.hostname ?? '127.0.0.1' });
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', () => resolve())));

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const caller = url.pathname === '/sync/poke' ? await authenticate(new Request(url), global) : null;
    if (!caller || caller instanceof Response) return void socket.destroy();
    const clientId = url.searchParams.get('clientId') ?? '';
    wss.handleUpgrade(req, socket, head, (ws) => {
      const org = openOrg(caller.orgId);
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
      await new Promise<void>((r) => server.close(() => r()));
      for (const o of orgs.values()) o.db.close();
      globalDb.close();
    },
  };
}
