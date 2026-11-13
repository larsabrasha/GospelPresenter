// Differential test: the same random mutations through the TS mutators and the Rust/WASM ones, each on its own
// SQLite; after every step the outcome and both databases must be the same. Then a timing run.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { getMutator, runMutator, migrateOrgSchemaSync, schema, drizzleProxy } from './.out/ts-core.mjs';
import { SEED_SQL } from './seed-sql.mjs';

const dir = new URL('.', import.meta.url).pathname;
const OPS = Number(process.argv[2] ?? 3000);
const SEEDS = Number(process.argv[3] ?? 5);

// ---------------------------------------------------------------- databases


export function openDb() {
  const db = new DatabaseSync(':memory:');
  migrateOrgSchemaSync(
    (sql) => db.prepare(sql).all(),
    (fn) => { db.exec('BEGIN'); fn(); db.exec('COMMIT'); },
  );
  for (const s of SEED_SQL) db.exec(s);
  return db;
}

let roundTrips = 0;
/** Async, as wa-sqlite through the client's proxy is. */
async function query(db, sql, params) {
  await Promise.resolve(); // a turn of the event loop, as wa-sqlite answers
  roundTrips++;
  const st = db.prepare(sql);
  st.setReturnArrays(true);
  return st.all(...params);
}

export const dump = (db) =>
  JSON.stringify([
    db.prepare('SELECT * FROM presentations ORDER BY id').all(),
    db.prepare('SELECT * FROM presentation_items ORDER BY id').all(),
  ]);

function restore(db, from) {
  db.exec('DELETE FROM presentation_items; DELETE FROM presentations');
  for (const t of ['presentations', 'presentation_items'])
    for (const row of from.prepare(`SELECT * FROM ${t}`).all()) {
      const cols = Object.keys(row);
      db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row));
    }
}

// ---------------------------------------------------------------- the two cores

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
    return e.code ?? `crash: ${e.message}`;
  }
}

const wasmBytes = readFileSync(`${dir}/.out/gp_core.wasm`);
const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { now_ms: () => Date.now() } });
const w = instance.exports;
const enc = new TextEncoder(), dec = new TextDecoder();
const pass = (s) => { const b = enc.encode(s); const p = w.gp_alloc(b.length); new Uint8Array(w.memory.buffer, p, b.length).set(b); return [p, b.length]; };
const out = () => dec.decode(new Uint8Array(w.memory.buffer, w.gp_out_ptr(), w.gp_out_len()));

async function runRust(db, input) {
  db.exec('BEGIN');
  let st = w.gp_start(...pass(JSON.stringify(input)));
  while (st === 2) {
    const req = JSON.parse(out());
    st = w.gp_resume(...pass(JSON.stringify(await query(db, req.sql, req.params))));
  }
  if (st === 0) { db.exec('COMMIT'); return 'ok'; }
  db.exec('ROLLBACK');
  return out();
}

// ---------------------------------------------------------------- random mutations

export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function generator(random, db) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const maybe = (p, f) => (random() < p ? f() : undefined);
  let n = 0;
  const items = () => db.prepare('SELECT id FROM presentation_items').all().map((r) => r.id);
  const pres = () => [...db.prepare('SELECT id FROM presentations').all().map((r) => r.id), 'px'];
  const newId = (p) => pick([`${p}${++n}`, `${p}${++n}`, `${p}${++n}`, 'x'.repeat(100), 'x'.repeat(101), '🎵'.repeat(51), '']);
  const someItem = () => pick([...items(), 'ix', null]);
  const names = ['Söndag', '  Gudstjänst  ', '', '   ', 'a'.repeat(200), 'a'.repeat(201), ' Ny ', '﻿BOM', '\u0085NEL', 'é🎵'.repeat(67), 'é🎵'.repeat(70), 42];
  const roles = ['user', 'user', 'user', 'admin', 'admin', 'superAdmin', 'guest'];
  const opt = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return (step) => {
    const ctx = { userId: 'u', role: pick(roles), now: step * 1000 };
    const r = random();
    let name, args;
    if (random() < 0.4) {
      // The details, an item's name, note and arrangement, and the trash.
      const q = random();
      const anyPres = () => pick([...pres(), ...db.prepare('SELECT id FROM presentations WHERE deleted_at IS NOT NULL').all().map((row) => row.id)]);
      if (q < 0.25) {
        name = 'updatePresentation';
        args = opt({
          id: anyPres(), name: maybe(0.4, () => pick([...names, null])),
          eventDate: maybe(0.3, () => pick(['2026-12-24', '2026-02-30', null, ''])), time: maybe(0.3, () => pick(['18:30', '25:00', null])),
          location: maybe(0.3, () => pick(['Kapellet', '  ', null, 'x'.repeat(101)])), description: maybe(0.3, () => pick(['• Välkommen\n• Sång', '', null])),
          themeId: maybe(0.25, () => pick(['classic', 'light', 'th1', 'tx', null, ''])),
        });
      } else if (q < 0.45) {
        name = 'renameItem';
        args = opt({ itemId: pick([...items(), 'ix']), title: maybe(0.95, () => pick(names)) });
      } else if (q < 0.6) {
        name = 'setItemNote';
        args = opt({ itemId: pick([...items(), 'ix']), note: maybe(0.9, () => pick(['Ta det lugnt', '  ', '', null, 'x'.repeat(201), 'x'.repeat(200)])) });
      } else if (q < 0.8) {
        name = 'setItemArrangement';
        args = opt({ itemId: pick([...items(), 'ix']), arrangementId: maybe(0.95, () => pick(['a1', 'a2', 'a3', 'ax', null])) });
      } else {
        name = pick(['trashPresentation', 'trashPresentation', 'restorePresentation', 'purgePresentation', 'purgePresentation']);
        args = opt({ id: anyPres(), at: name === 'trashPresentation' ? pick([step * 10, step * 10, 1.5, 2 ** 53, -5, undefined]) : undefined });
      }
      return { name, args, ctx };
    }
    if (r < 0.3) {
      name = 'addSongToPresentation';
      args = opt({ itemId: newId('i'), presentationId: pick(pres()), songId: pick(['s1', 's2', 's3', 's4', 'sx']), arrangementId: maybe(0.5, () => pick(['a1', 'a2', 'ax', null])), afterItemId: maybe(0.5, someItem) });
    } else if (r < 0.45) {
      name = 'addHeaderToPresentation';
      args = opt({ itemId: newId('h'), presentationId: pick(pres()), title: pick(names), afterItemId: maybe(0.4, someItem), beforeItemId: maybe(0.4, someItem) });
    } else if (r < 0.65) {
      name = 'moveItem';
      args = { itemId: pick([...items(), 'ix']), by: pick([-1, 1, -1, 1, -3, 5, 0, 1000, 1001, -1000, 1.5, 2.0, '2', null]) };
    } else if (r < 0.75) {
      name = 'reorderItems';
      const its = items().toSorted(() => random() - 0.5).slice(0, Math.floor(random() * 8));
      args = { presentationId: pick(pres()), itemIds: random() < 0.05 ? Array(1001).fill('i1') : [...its, ...(random() < 0.3 ? [its[0] ?? 'ix', 'ix'] : [])] };
    } else if (r < 0.85) {
      name = 'removeItem';
      args = { itemId: pick([...items(), 'ix']) };
    } else if (r < 0.95) {
      name = 'createPresentation';
      args = opt({
        id: newId('np'), name: pick(names),
        eventDate: maybe(0.5, () => pick(['2026-11-15', '2026-02-29', '2024-02-29', '1900-02-29', '2000-02-29', '2026-13-01', '15/11/2026', '２０２６-11-15', null])),
        time: maybe(0.5, () => pick(['10:00', '23:59', '24:00', '9:00', '１０:00', null])),
        location: maybe(0.4, () => pick(['Kyrkan', '   ', 'x'.repeat(100), 'x'.repeat(101), null])),
        description: maybe(0.3, () => pick(['Fika efteråt', '', null])),
      });
    } else {
      name = pick(['moveItem', 'removeItem', 'addSongToPresentation']);
      args = pick([null, [], 'x', 7, {}, { itemId: 7 }]);
    }
    return { name, args, ctx };
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
// ---------------------------------------------------------------- run

const kb = (n) => (n / 1024).toFixed(1) + ' kB';
const tsMin = readFileSync(`${dir}/.out/ts-core.min.mjs`);
console.log(`size  Rust gp_core.wasm: ${kb(wasmBytes.length)} raw, ${kb(brotliCompressSync(wasmBytes).length)} brotli`);
console.log(`size  TS registry (every mutator + drizzle + zod), minified: ${kb(tsMin.length)} raw, ${kb(brotliCompressSync(tsMin).length)} brotli`);

const mismatches = new Map();
let steps = 0, outcomes = {};
for (let seed = 1; seed <= SEEDS; seed++) {
  const a = openDb(), b = openDb();
  const next = generator(rng(seed), a);
  for (let step = 0; step < OPS; step++) {
    const input = next(step);
    const ra = await runTs(a, structuredClone(input));
    const rb = await runRust(b, structuredClone(input));
    steps++;
    outcomes[ra] = (outcomes[ra] ?? 0) + 1;
    const same = ra === rb && dump(a) === dump(b);
    if (!same) {
      const text = input.args?.title ?? input.args?.name; const kind = (ra !== rb ? `${input.name}: TS ${ra}, Rust ${rb}` : `${input.name}: same outcome (${ra}), different rows`) + (typeof text === "string" ? ` [text ${JSON.stringify(Array.from(text.slice(0, 3), (c) => c.codePointAt(0).toString(16)))}]` : "");
      if (!mismatches.has(kind)) mismatches.set(kind, { count: 0, example: input });
      mismatches.get(kind).count++;
      restore(b, a);
    }
  }
}
console.log(`\ndifferential: ${steps} mutations over ${SEEDS} seeds; outcomes ${JSON.stringify(outcomes)}`);
console.log(mismatches.size ? `${mismatches.size} kinds of difference:` : 'no differences');
for (const [kind, { count, example }] of mismatches) console.log(`  ${count}x ${kind}\n     e.g. ${JSON.stringify(example.args).slice(0, 160)} as ${example.ctx.role}`);

// Timing: the same 2 000 mutations on fresh databases, each core alone.
async function timed(runner) {
  const db = openDb(), mirror = openDb();
  const next = generator(rng(99), mirror);
  const inputs = [];
  for (let s = 0; s < 2000; s++) { const i = next(s); inputs.push(i); await runTs(mirror, structuredClone(i)); }
  roundTrips = 0;
  const t = performance.now();
  for (const i of inputs) await runner(db, structuredClone(i));
  return { ms: performance.now() - t, trips: roundTrips };
}
for (let warm = 0; warm < 2; warm++) { await timed(runTs); await timed(runRust); }
const ts = await timed(runTs), rs = await timed(runRust);
console.log(`\ntiming, 2 000 mutations incl. SQLite: TS ${ts.ms.toFixed(0)} ms (${(ts.ms / 2).toFixed(0)} µs each, ${ts.trips} SQL calls)   Rust/WASM ${rs.ms.toFixed(0)} ms (${(rs.ms / 2).toFixed(0)} µs each, ${rs.trips} SQL calls)`);

// The item limit (100 a presentation), which random runs rarely reach.
{
  const a = openDb(), b = openDb();
  const seen = { ts: {}, rust: {} };
  let same = true;
  for (let i = 0; i < 120; i++) {
    const input = { name: 'addHeaderToPresentation', args: { itemId: `L${i}`, presentationId: 'p2', title: `Rubrik ${i}`, afterItemId: i % 3 ? `L${i - 1}` : null }, ctx: { userId: 'u', role: 'user', now: i } };
    const ra = await runTs(a, structuredClone(input)), rb = await runRust(b, structuredClone(input));
    seen.ts[ra] = (seen.ts[ra] ?? 0) + 1; seen.rust[rb] = (seen.rust[rb] ?? 0) + 1;
    same &&= ra === rb && dump(a) === dump(b);
  }
  console.log(`limit: 120 adds to one presentation, TS ${JSON.stringify(seen.ts)}, Rust ${JSON.stringify(seen.rust)}, same rows: ${same}`);
}

}

/** A view of the Rust core: its JSON answer, or the refusal's code. */
export async function viewRust(db, name, args) {
  let st = w.gp_start(...pass(JSON.stringify({ name, args, ctx: { userId: 'u', role: 'user' } })));
  while (st === 2) {
    const req = JSON.parse(out());
    st = w.gp_resume(...pass(JSON.stringify(await query(db, req.sql, req.params))));
  }
  return st === 0 ? JSON.parse(out() || 'null') : { refused: out() };
}
