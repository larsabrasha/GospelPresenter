// The sync check's world: a server (packages/sync's engine over SQLite, as the Node host runs it), a second device B
// (the TS SyncClient), and device A twice: the TS SyncClient talking to the server, and the Rust core's sync
// commands on a database of their own, fed the very pages and answers A's TS client got.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  SyncClient, openNodeSqliteClient, handlePush, handlePull, RustCore, serverSyncDdl, serverChangeTriggers, migrateOrgSchemaSync, labelSeedSql,
  schema, drizzleProxy,
} from '../.out/ts-sync.mjs';

const out = new URL('../.out/', import.meta.url).pathname;
const wasm = readFileSync(process.env.GP_CORE_WASM ?? `${out}/gp_core.wasm`);
/** The core the TS client and the server run their Rust mutators on: always the core as built, never a planted fault. */
const appModule = new WebAssembly.Module(readFileSync(`${out}/gp_core.wasm`));

/** The clock every part reads: fixed per step, so both A's write the same times. */
export const clock = { now: 1_700_000_000_000 };
Date.now = () => clock.now;

// ---------------------------------------------------------------- the server

export function openServer(seed) {
  const db = new DatabaseSync(':memory:');
  const query = (sql, params = []) => db.prepare(sql).all(...params);
  const rows = (sql, params = []) => { const st = db.prepare(sql); st.setReturnArrays(true); return st.all(...params); };
  migrateOrgSchemaSync(query, (fn) => { db.exec('BEGIN'); fn(); db.exec('COMMIT'); });
  for (const s of [...serverSyncDdl, ...serverChangeTriggers(), ...seed, ...labelSeedSql]) db.exec(s);
  const store = {
    db: drizzleProxy(async (sql, params, method) => { const all = rows(sql, params); return { rows: method === 'get' ? all[0] : all }; }, { schema }),
    query, rows, core: new RustCore(appModule),
    async transaction(fn) {
      db.exec('BEGIN');
      try { const r = await fn(); db.exec('COMMIT'); return r; } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
    },
  };
  return { db, store };
}

/**
 * A device's way to the server, as its user (`ctx`, which a test may change: a new role resets the device's copy).
 * `fault` decides each exchange's fate: through, a refusal answered instead, the answer lost after the server ran
 * it, or no network. `sent` records every request, `seen` what got through and its answer, for the Rust A.
 */
export function transport(store, ctx, fault = () => 'through') {
  const seen = [], sent = [];
  return {
    seen,
    sent,
    async post(path, body) {
      sent.push({ path, req: JSON.parse(JSON.stringify(body)) });
      const what = fault(path);
      if (what === 'offline') throw new Error('offline');
      if (what === 'update') return { status: 426, body: { error: 'update-required' } };
      if (what === 'signed-out') return { status: 401, body: { error: 'unauthenticated' } };
      const req = JSON.parse(JSON.stringify(body));
      const res = path.endsWith('/push') ? await handlePush(store, { ...ctx }, req) : handlePull(store, { ...ctx }, req);
      if (what === 'lost') throw new Error('the answer was lost');
      const answer = { status: res.status, body: JSON.parse(JSON.stringify(res.body)) };
      seen.push({ path, req, answer });
      return answer;
    },
  };
}

export async function openTsClient(t, ctx, clientId) {
  const changes = [];
  const client = await SyncClient.open(openNodeSqliteClient(), { transport: t, ctx, core: new RustCore(appModule), clientId });
  client.onChange((tables) => changes.push([...tables].toSorted()));
  return { client, changes };
}

// ---------------------------------------------------------------- the Rust A: the core's commands over node:sqlite

const { instance } = await WebAssembly.instantiate(wasm, { env: { now_ms: () => clock.now } });
const w = instance.exports;
const enc = new TextEncoder(), dec = new TextDecoder();
const pass = (s) => { const b = enc.encode(s); const p = w.gp_alloc(b.length); new Uint8Array(w.memory.buffer, p, b.length).set(b); return [p, b.length]; };
const said = () => dec.decode(new Uint8Array(w.memory.buffer, w.gp_out_ptr(), w.gp_out_len()));

/** A shell over one SQLite: each command in a transaction of its own (`syncOpen` none), its SQL answered, an error as such. */
export function rustShell() {
  const db = new DatabaseSync(':memory:');
  const query = async (sql, params) => {
    await Promise.resolve(); // a turn of the event loop, as wa-sqlite answers
    try { const st = db.prepare(sql); st.setReturnArrays(true); return st.all(...params); } catch (e) { return { error: e.message }; }
  };
  async function command(name, args, ctx, { transaction = true } = {}) {
    if (transaction) db.exec('BEGIN');
    let st = w.gp_start(...pass(JSON.stringify({ name, args, ctx })));
    while (st === 2) {
      const ask = JSON.parse(said());
      st = w.gp_resume(...pass(JSON.stringify(await query(ask.sql, ask.params))));
    }
    const answer = said();
    if (transaction) db.exec(st === 0 ? 'COMMIT' : 'ROLLBACK');
    if (st !== 0) throw Object.assign(new Error(answer), { code: answer });
    return answer ? JSON.parse(answer) : null;
  }
  return { db, command };
}

/** Device A on the Rust core: migrated, opened, and the commands a shell calls. */
export async function openRustClient(ctx, clientId) {
  const shell = rustShell();
  await shell.command('migrateOrgSchema', {}, {});
  await shell.command('syncOpen', { clientId }, {}, { transaction: false });
  return {
    db: shell.db,
    rejected: [],
    changes: [],
    async mutate(name, args) {
      const { tables } = await shell.command('syncMutate', { mutator: name, args: JSON.stringify(args) }, ctx);
      this.changes.push(tables.toSorted());
    },
    /** The push request A's TS client would send now. */
    async pushRequest(protocol, schemaVersion) {
      const pending = await shell.command('syncPending', {}, ctx);
      return { protocol, schemaVersion, clientId, mutations: pending.map((m) => ({ id: m.id, name: m.name, v: m.v, args: JSON.parse(m.args) })) };
    },
    async rebase(pages) {
      const { tables, results, changed, replaysRefused } = await shell.command('syncRebase', { pages }, ctx);
      this.rejected.push(...results);
      this.replaysRefused = (this.replaysRefused ?? 0) + replaysRefused;
      if (changed) this.changes.push(tables.toSorted());
    },
  };
}

// ---------------------------------------------------------------- comparing

/** Every table of the database (the synced ones, the queue, `_sync_meta`, `_undo`) and the temp record, in order. */
export function dumpAll(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  const order = (t) => (db.prepare(`SELECT count(*) AS n FROM pragma_table_info('${t}')`).get().n > 1 ? '1, 2' : '1');
  const all = tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY ${order(t)}`).all()]);
  all.push(['temp.changed_tables', db.prepare('SELECT * FROM temp.changed_tables ORDER BY 1').all()]);
  return JSON.stringify(all);
}

/** The schema, temp triggers included. */
export const schemaOf = (db) =>
  JSON.stringify([db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all(), db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_temp_master ORDER BY type, name').all()]);

/** The TS client's database: openNodeSqliteClient keeps its DatabaseSync to itself, so it is read through the client. */
export async function tsDump(client) {
  const q = (sql) => client.query(sql);
  const tables = (await q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((t) => t.name);
  const all = [];
  for (const t of tables) {
    const n = (await q(`SELECT count(*) AS n FROM pragma_table_info('${t}')`))[0].n;
    all.push([t, await q(`SELECT * FROM "${t}" ORDER BY ${n > 1 ? '1, 2' : '1'}`)]);
  }
  all.push(['temp.changed_tables', await q('SELECT * FROM temp.changed_tables ORDER BY 1')]);
  return JSON.stringify(all);
}

export async function tsSchema(client) {
  return JSON.stringify([await client.query('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name'), await client.query('SELECT type, name, tbl_name, sql FROM sqlite_temp_master ORDER BY type, name')]);
}
