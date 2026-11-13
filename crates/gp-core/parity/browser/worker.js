// The Rust core in a browser, as the web's client would run it: in a Web Worker, over wa-sqlite (in memory, or on
// OPFS as the app keeps its database), every query awaited. The TS core's random mutations (export.mjs's fixture) are
// sent through it, each seed its own database; every outcome and the final rows are compared.
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from '@journeyapps/wa-sqlite';
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import { waSqliteConnection } from 'gp-wa-sqlite-api';
import { migrateOrgSchema } from 'gp-org-schema';
import { getMutator, runMutator } from 'gp-mutators';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from 'gp-schema';
import { SEED_SQL } from '../seed-sql.mjs';

const say = (line) => postMessage(line);
const json = async (path) => (await fetch(path)).json();

/** A fresh database for a seed: in memory, or a new file on OPFS (any left by an earlier run removed first). */
async function open(sqlite3, opfs, seed) {
  if (!opfs) return waSqliteConnection(sqlite3, await sqlite3.open_v2(':memory:'));
  const name = `rust-core-check-${seed}.sqlite`;
  const root = await navigator.storage.getDirectory();
  for (const suffix of ['', '-journal', '-wal']) await root.removeEntry(name + suffix).catch(() => {});
  return waSqliteConnection(sqlite3, await sqlite3.open_v2(name));
}

onmessage = async ({ data: { opfs, engine, pragmas = [] } }) => {
  try {
    const module = await SQLiteESMFactory({ wasmBinary: await (await fetch('wa-sqlite.wasm')).arrayBuffer() });
    const sqlite3 = SQLite.Factory(module);
    // OPFS as the web's database worker opens it (apps/web/src/db/worker.ts).
    if (opfs) sqlite3.vfs_register(await OPFSCoopSyncVFS.create('opfs', module), true);
    const { instance } = await WebAssembly.instantiate(await (await fetch('gp_core.wasm')).arrayBuffer(), { env: { now_ms: () => Date.now() } });
    const w = instance.exports;
    const pass = (s) => {
      const b = new TextEncoder().encode(s);
      const p = w.gp_alloc(b.length);
      new Uint8Array(w.memory.buffer, p, b.length).set(b);
      return [p, b.length];
    };
    const out = () => new TextDecoder().decode(new Uint8Array(w.memory.buffer, w.gp_out_ptr(), w.gp_out_len()));
    const lines = (await (await fetch('parity.jsonl')).text()).trim().split('\n').map((l) => JSON.parse(l));
    const finals = await json('parity-final.json');
    let differ = 0, calls = 0;
    const t = performance.now();
    for (const seed of new Set(lines.map((l) => l.seed))) {
      const db = await open(sqlite3, opfs, seed);
      const objects = async (sql, params) => {
        const { columns, rows } = await db.query(sql, params);
        return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
      };
      // Settings to measure, e.g. `PRAGMA synchronous = NORMAL`; the journal mode they leave, said once.
      for (const p of pragmas) await db.query(p);
      if (seed === 1) say(`journal_mode ${(await db.query('PRAGMA journal_mode')).rows[0]}, synchronous ${(await db.query('PRAGMA synchronous')).rows[0]}`);
      await migrateOrgSchema((sql) => objects(sql), async (fn) => {
        await db.query('BEGIN');
        await fn();
        await db.query('COMMIT');
      });
      for (const s of SEED_SQL) await db.query(s);
      // The TS core the same way, for the time it takes: its mutators through Drizzle over the same connection.
      const tx = drizzle(async (sql, params, method) => {
        calls++;
        const { rows } = await db.query(sql, params);
        return { rows: method === 'get' ? rows[0] : rows };
      }, { schema });
      for (const line of lines.filter((l) => l.seed === seed)) {
        await db.query('BEGIN');
        let got;
        if (engine === 'ts') {
          got = await runMutator(getMutator(line.input.name), tx, line.input.args, line.input.ctx).then(() => 'ok', (e) => e.code ?? `crash: ${e.message}`);
        } else {
          let st = w.gp_start(...pass(JSON.stringify(line.input)));
          while (st === 2) {
            const req = JSON.parse(out());
            calls++;
            st = w.gp_resume(...pass(JSON.stringify((await db.query(req.sql, req.params)).rows)));
          }
          got = st === 0 ? 'ok' : out();
        }
        await db.query(got === 'ok' ? 'COMMIT' : 'ROLLBACK');
        if (got !== line.outcome && ++differ < 4) say(`DIFF seed ${seed}: TS ${line.outcome}, browser ${got}: ${JSON.stringify(line.input).slice(0, 160)}`);
      }
      const rows = JSON.stringify([await objects('SELECT * FROM presentations ORDER BY id', []), await objects('SELECT * FROM presentation_items ORDER BY id', [])]);
      say(`seed ${seed}: ${rows === finals[seed - 1] ? 'same rows' : 'DIFFERENT rows'}`);
      await db.close();
    }
    const ms = performance.now() - t;
    say(`${engine === 'ts' ? 'TS core' : 'Rust core'} (${opfs ? 'OPFS' : 'memory'}${pragmas.length ? `, ${pragmas.join('; ')}` : ''}): ${lines.length} mutations, ${differ} different outcomes, ${calls} SQL calls, ${(ms * 1000 / lines.length).toFixed(0)} µs each`);
    say('done');
  } catch (e) {
    say(`error: ${e?.name ?? ""} ${e?.message ?? ""} ${e?.stack || String(e)}`);
    say('done');
  }
};
