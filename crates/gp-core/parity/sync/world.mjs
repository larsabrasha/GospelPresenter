// The sync check's world: a server (packages/sync's engine over SQLite, as the Node host runs it), a second device B,
// and device A twice: the TS SyncClient as it was before the switch (the reference) talking to the server, and the
// SyncClient on the Rust core's sync commands, on a database of its own, given the very answers the reference got.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  SyncClient, ReferenceSyncClient, handlePush, handlePull, RustCore, serverSyncDdl, serverChangeTriggers, migrateOrgSchemaSync, labelSeedSql,
  schema, drizzleProxy,
} from '../.out/ts-sync.mjs';

const out = new URL('../.out/', import.meta.url).pathname;
/** The core the reference client and the server run their mutators on: always the core as built, never a planted fault. */
const appModule = new WebAssembly.Module(readFileSync(`${out}/gp_core.wasm`));
/** The core under test: the one built, or one with a planted fault. */
const testedModule = new WebAssembly.Module(readFileSync(process.env.GP_CORE_WASM ?? `${out}/gp_core.wasm`));

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
 * it, or no network. `log` records every exchange and how it went, for the client on the core to be given the same.
 */
export function transport(store, ctx, fault = () => 'through') {
  const log = [];
  return {
    log,
    async post(path, body) {
      const req = JSON.parse(JSON.stringify(body));
      const what = fault(path);
      const entry = { path, req, what };
      log.push(entry);
      if (what === 'offline') throw new Error('offline');
      if (what === 'update') return (entry.answer = { status: 426, body: { error: 'update-required' } });
      if (what === 'signed-out') return (entry.answer = { status: 401, body: { error: 'unauthenticated' } });
      const res = path.endsWith('/push') ? await handlePush(store, { ...ctx }, req) : handlePull(store, { ...ctx }, req);
      if (what === 'lost') throw new Error('the answer was lost');
      return (entry.answer = { status: res.status, body: JSON.parse(JSON.stringify(res.body)) });
    },
  };
}

/**
 * The same exchanges again, for the client on the core: each request it makes is checked against the reference's
 * (`differ` hears of any other), and answered as the reference's was.
 */
export function replay(entries, differ) {
  let at = 0;
  return {
    async post(path, body) {
      const was = entries[at++];
      const req = JSON.parse(JSON.stringify(body));
      if (!was || was.path !== path || JSON.stringify(was.req) !== JSON.stringify(req)) {
        differ(`a different request: ${path}`, JSON.stringify(was?.req ?? null).slice(0, 300), JSON.stringify(req).slice(0, 300));
        throw new Error('not the reference request');
      }
      if (was.what === 'offline') throw new Error('offline');
      if (was.what === 'lost') throw new Error('the answer was lost');
      return structuredClone(was.answer);
    },
    /** Whether every exchange of the reference's was asked for. */
    get done() {
      return at === entries.length;
    },
  };
}

/** node:sqlite as a client's ClientSqlite (as `openNodeSqliteClient`), its DatabaseSync kept for the check to read. */
function clientSqlite() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    sqlite: {
      async query(sql, params = []) {
        const st = db.prepare(sql);
        st.setReturnArrays(true);
        const rows = st.all(...params);
        return { columns: st.columns().map((c) => c.name), rows };
      },
      async close() { db.close(); },
    },
  };
}

/** A device's client: the reference's (`reference`) or the one on the core, over node:sqlite, its changes recorded. */
export async function openClient({ reference, transport: t, ctx, clientId }) {
  const changes = [];
  const { db, sqlite } = clientSqlite();
  const Client = reference ? ReferenceSyncClient : SyncClient;
  const client = await Client.open(sqlite, { transport: t, ctx, core: new RustCore(reference ? appModule : testedModule), clientId });
  client.onChange((tables) => changes.push([...tables].toSorted()));
  return { client, changes, db };
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
