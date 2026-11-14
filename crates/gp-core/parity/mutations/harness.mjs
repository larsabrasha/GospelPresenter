// The differential check of the mutators, file by file: the same random inputs through the TS core (packages/core)
// and the Rust core, each on its own SQLite, the outcome and every table compared after every step.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getMutator, runMutator, migrateOrgSchemaSync, schema, drizzleProxy } from '../.out/ts-core.mjs';

const out = new URL('../.out/', import.meta.url).pathname;

/** The clock both cores read where a mutator is run without the server's (`ctx.now` absent): fixed per step. */
let clock = 0;
Date.now = () => clock;

const { instance } = await WebAssembly.instantiate(readFileSync(`${out}/gp_core.wasm`), { env: { now_ms: () => clock } });
const w = instance.exports;
const enc = new TextEncoder(), dec = new TextDecoder();
const pass = (s) => { const b = enc.encode(s); const p = w.gp_alloc(b.length); new Uint8Array(w.memory.buffer, p, b.length).set(b); return [p, b.length]; };
const output = () => dec.decode(new Uint8Array(w.memory.buffer, w.gp_out_ptr(), w.gp_out_len()));

/** A statement's rows as arrays; a turn of the event loop first, as wa-sqlite answers. */
export async function query(db, sql, params) {
  await Promise.resolve();
  const st = db.prepare(sql);
  st.setReturnArrays(true);
  return st.all(...params);
}

/** An organisation database of today's schema, with `seed` in it. */
export function openDb(seed = []) {
  const db = new DatabaseSync(':memory:');
  migrateOrgSchemaSync((sql) => db.prepare(sql).all(), (fn) => { db.exec('BEGIN'); fn(); db.exec('COMMIT'); });
  for (const s of seed) db.exec(s);
  return db;
}

/** A command through the TS core, in one transaction: `ok`, or the refusal's code. */
export async function runTs(db, { name, args, ctx }) {
  const tx = drizzleProxy(async (sql, params, method) => {
    const rows = await query(db, sql, params);
    return { rows: method === 'get' ? rows[0] : rows };
  }, { schema });
  db.exec('BEGIN');
  try {
    await runMutator(getMutator(name), tx, args, ctx);
    db.exec('COMMIT');
    return 'ok';
  } catch (e) {
    db.exec('ROLLBACK');
    return e.code ?? sqlError(e.cause) ?? `crash: ${e.message}`;
  }
}

/** A statement SQLite refused, as both cores' outcome: the shell aborts the mutation. */
const sqlError = (e) => (e?.code === 'ERR_SQLITE_ERROR' ? `sql-error: ${e.message}` : undefined);

/** A command through the Rust core, in one transaction: `ok` (or its JSON answer), or the refusal's code. */
export async function runRust(db, input) {
  db.exec('BEGIN');
  try {
    let st = w.gp_start(...pass(JSON.stringify(input)));
    while (st === 2) {
      const req = JSON.parse(output());
      st = w.gp_resume(...pass(JSON.stringify(await query(db, req.sql, req.params))));
    }
    if (st === 0) { db.exec('COMMIT'); return output() ? JSON.parse(output()) : 'ok'; }
    db.exec('ROLLBACK');
    return output();
  } catch (e) {
    db.exec('ROLLBACK');
    return sqlError(e) ?? `trap: ${e.message}`;
  }
}

const readers = new WeakMap();
/** Every table but SQLite's own, every row, in a fixed order. */
export function dumpAll(db) {
  if (!readers.has(db)) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
    const order = (t) => (db.prepare(`SELECT count(*) AS n FROM pragma_table_info('${t}')`).get().n > 1 ? '1, 2' : '1');
    readers.set(db, tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY ${order(t)}`)]));
  }
  return JSON.stringify(readers.get(db).map(([t, st]) => [t, st.all()]), (_, v) => (v instanceof Uint8Array ? Array.from(v) : v));
}

/** The tables, indexes and triggers, with their SQL. */
export const schemaOf = (db) => JSON.stringify(db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all());

export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** What a generator draws from: a random number, a pick, a maybe, and the TS database's ids of a table. */
export function tools(random, db) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const maybe = (p, f) => (random() < p ? f() : undefined);
  const idsOf = (sql) => db.prepare(sql).all().map((r) => Object.values(r)[0]);
  const opt = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  let n = 0;
  const fresh = (p) => `${p}${++n}`;
  /** One of `good` mostly, one of `bad` now and then (an invalid argument, a limit). */
  const mostly = (good, bad, p = 0.9) => (random() < p ? pick(good) : pick(bad));
  return { random, pick, maybe, mostly, idsOf, opt, fresh };
}

const ROLES = ['user', 'user', 'admin', 'admin', 'superAdmin', 'guest'];

/**
 * `ops` random mutations of each of `seeds` seeds through both cores; `generator(tools, step)` gives a mutator's
 * name and arguments. A step without the server's clock (`now` absent) is a client's. Returns the differences.
 */
export async function prove(label, { seed = [], seedFor = () => [], generator, ops, seeds }) {
  const differences = new Map();
  const outcomes = {};
  for (let s = 1; s <= seeds; s++) {
    const a = openDb([...seed, ...seedFor(s, seeds)]), b = openDb([...seed, ...seedFor(s, seeds)]);
    const t = tools(rng(s * 7919 + label.length), a);
    for (let step = 1; step <= ops; step++) {
      const { name, args, role, client } = generator(t, step);
      const ctx = { userId: t.pick(['u1', 'u2']), role: role ?? t.pick(ROLES) };
      if (!(client ?? t.random() < 0.3)) ctx.now = step * 60_000;
      const input = JSON.parse(JSON.stringify({ name, args, ctx }));
      clock = 1_700_000_000_000 + step;
      const ra = await runTs(a, structuredClone(input));
      const rb = await runRust(b, structuredClone(input));
      outcomes[`${name} ${ra}`] = (outcomes[`${name} ${ra}`] ?? 0) + 1;
      if (ra !== rb || dumpAll(a) !== dumpAll(b)) {
        const kind = ra !== rb ? `${name}: TS ${ra}, Rust ${rb}` : `${name}: same outcome (${ra}), different rows`;
        if (!differences.has(kind)) differences.set(kind, { count: 0, input, rows: ra === rb ? firstDifference(a, b) : '' });
        differences.get(kind).count++;
        copyInto(b, a);
      }
    }
  }
  return { differences, outcomes, steps: ops * seeds };
}

/** The first table whose rows differ, both sides. */
function firstDifference(a, b) {
  const [x, y] = [JSON.parse(dumpAll(a)), JSON.parse(dumpAll(b))];
  for (const [i, [t, rows]] of x.entries()) if (JSON.stringify(rows) !== JSON.stringify(y[i]?.[1])) {
    const other = y[i][1];
    const k = rows.findIndex((r, j) => JSON.stringify(r) !== JSON.stringify(other[j]));
    return `${t}: TS ${JSON.stringify(rows[k]).slice(0, 300)}\n       Rust ${JSON.stringify(other[k]).slice(0, 300)}`;
  }
  return '';
}

/** Makes `to`'s rows `from`'s, to go on from where the TS core is after a difference. */
function copyInto(to, from) {
  to.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of from.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    to.exec(`DELETE FROM "${name}"`);
    for (const row of from.prepare(`SELECT * FROM "${name}"`).all()) {
      const cols = Object.keys(row);
      to.prepare(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row));
    }
  }
  to.exec('PRAGMA foreign_keys = ON');
}

/** Prints a check's result; false when there were differences. */
export function report(label, { differences, outcomes, steps }) {
  const kinds = Object.entries(outcomes).toSorted();
  console.log(`${label}: ${steps} mutations; outcomes ${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(differences.size ? `  ${differences.size} kinds of difference:` : '  no differences');
  for (const [kind, { count, input, rows }] of differences) {
    console.log(`  ${count}x ${kind}\n     e.g. ${JSON.stringify(input).slice(0, 400)}${rows ? `\n     ${rows}` : ''}`);
  }
  return differences.size === 0;
}
