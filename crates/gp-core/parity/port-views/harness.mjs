// The view checks of the way back (ADR 0008, docs/core-back-to-typescript.md): a view of the TS core against the Rust
// core's, the same arguments through both, on the demo data with what views/fixture.mjs adds (read only) or on a
// database a group makes. The answers are compared as JSON with every object's keys in order; a refusal by its code.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const { RustCore } = await import('../.out/ts-sync-tree.mjs');
const out = new URL('../.out/', import.meta.url).pathname;
const module = new WebAssembly.Module(readFileSync(`${out}/gp_core.wasm`));
/** The reference, all in Rust, and the core as the app has it, the TS core's views first. */
export const rust = new RustCore(module, true);
export const ts = new RustCore(module, false);

/** JSON with every object's keys in order, as the Rust core writes it. */
export const canon = (v) => JSON.stringify(v ?? null, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** A statement's rows as arrays, on `db`. */
export const rowsOn = (db) => (sql, params = []) => {
  const st = db.prepare(sql);
  st.setReturnArrays(true);
  return st.all(...params);
};

/** A fresh database of today's schema, empty, with `statements` run in it. */
export function emptyDb(statements = []) {
  const db = new DatabaseSync(':memory:');
  rust.runSync('migrateOrgSchema', {}, undefined, rowsOn(db));
  for (const s of statements) db.exec(s);
  return db;
}

const settle = async (f) => {
  try {
    return { ok: await f() };
  } catch (e) {
    return { refused: e?.code ?? `crash: ${e?.message}` };
  }
};

/**
 * Each case through both cores: `{ name, args, db?, pure? }` (`pure` calls `pure()`, else `view()` on `db` or the
 * group's). Returns the differences, at most `show` of them printed.
 */
export async function compare(group, cases, db, show = 5) {
  let differences = 0;
  const outcomes = {};
  for (const c of cases) {
    const on = c.db ?? db;
    const call = (core) => (c.pure ? core.pure(c.name, structuredClone(c.args)) : core.view(c.name, structuredClone(c.args), rowsOn(on)));
    const [r, t] = [await settle(() => call(rust)), await settle(() => call(ts))];
    const key = `${c.name} ${r.refused ? `refused ${r.refused}` : 'ok'}`;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    if (canon(r) !== canon(t)) {
      differences++;
      if (differences <= show) console.log(`  DIFFERENT ${c.name} ${JSON.stringify(c.args).slice(0, 200)}\n    Rust ${canon(r).slice(0, 500)}\n    TS   ${canon(t).slice(0, 500)}`);
    }
  }
  console.log(`${group}: ${cases.length} cases; ${Object.entries(outcomes).toSorted().map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(differences ? `  ${differences} differences` : '  no differences');
  return differences;
}
