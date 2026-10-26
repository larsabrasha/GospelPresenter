import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { Hono } from 'hono';
import { migrateOrgSchemaSync, schema, serverChangeTriggers, serverSyncDdl, type Poke, type Role, type Tx } from '@gp/core';
import { adminRoutes, authenticate, globalDdl, syncRoutes, type GlobalStore, type Org } from './app.ts';
import { PokeCoalescer, SerialQueue, type OrgStore } from '@gp/sync/server';

interface Env {
  DB: D1Database;
  ORG: DurableObjectNamespace<OrgDurableObject>;
  SPIKE_DEBUG?: string;
  POKE_WINDOW_MS?: string;
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
      return { caller: { orgId: c.req.header('x-org')!, ctx: { userId, role } }, org: this.org };
    }, env.SPIKE_DEBUG === '1');
    this.app.get('/debug/triggers', (c) => c.json(triggerCheck((s, ...p) => ctx.storage.sql.exec(s, ...p).toArray())));
    this.app.get('/debug/tx-probe', async (c) => c.json(await transactionProbe(ctx.storage)));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') === 'websocket') {
      const clientId = new URL(request.url).searchParams.get('clientId') ?? '';
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [clientId]);
      return new Response(null, { status: 101, webSocket: pair[0] });
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

function d1Global(db: D1Database): GlobalStore {
  let ready: Promise<unknown> | undefined;
  const init = () => (ready ??= db.batch(globalDdl.map((s) => db.prepare(s))));
  return {
    async role(userId, orgId) {
      await init();
      const row = await db
        .prepare('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?')
        .bind(userId, orgId)
        .first<{ role: Role }>();
      return row?.role ?? null;
    },
    async setRole(userId, orgId, role) {
      await init();
      await db.prepare('INSERT OR REPLACE INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)').bind(userId, orgId, role).run();
    },
  };
}

const worker = new Hono<{ Bindings: Env }>();

worker.use('/debug/*', async (c, next) => (c.env.SPIKE_DEBUG === '1' ? next() : c.notFound()));
worker.post('/debug/membership', (c) => adminRoutes(d1Global(c.env.DB)).fetch(c.req.raw));
// Triggers in local D1: same check as in the Durable Object.
worker.get('/debug/d1-triggers', async (c) => {
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

// Everything else is for an organisation: authenticate against D1, then hand
// the request to that organisation's Durable Object.
worker.all('*', async (c) => {
  const caller = await authenticate(c.req.raw, d1Global(c.env.DB));
  if (caller instanceof Response) return caller;
  const stub = c.env.ORG.get(c.env.ORG.idFromName(caller.orgId));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-user', caller.ctx.userId);
  headers.set('x-role', caller.ctx.role);
  headers.set('x-org', caller.orgId);
  return stub.fetch(new Request(c.req.raw, { headers }));
});

export default worker;
