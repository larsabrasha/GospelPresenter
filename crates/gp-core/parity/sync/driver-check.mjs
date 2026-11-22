// node parity/sync/driver-check.mjs [--steps N] [--seeds N] (GP_TS=tree, port.sh, ADR 0008): the sync driver
// (`syncStepView`) and the sync status (`syncStatusView`) of the TS core against the Rust core's: the same random
// events, each core holding its own state, on one device database whose queue and cookie change between steps. After
// every step the states, the effects (the requests' bodies to the byte) and the status must be the same.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { rng } from '../mutations/tools.mjs';

const { RustCore } = await import('../.out/ts-sync-tree.mjs');
const out = new URL('../.out/', import.meta.url).pathname;
const module = new WebAssembly.Module(readFileSync(`${out}/gp_core.wasm`));
const rust = new RustCore(module, true), ts = new RustCore(module, false);

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : Number(argv[i + 1]); };
const STEPS = flag('--steps', 2000), SEEDS = flag('--seeds', 10);

const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).toSorted()) : x));
const settle = async (p) => { try { return { ok: await p }; } catch (e) { return { refused: e.code ?? e.message }; } };

let differences = 0;
const kinds = {};
for (let seed = 1; seed <= SEEDS; seed++) {
  const random = rng(seed * 7727);
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE _sync_meta (one INTEGER PRIMARY KEY, client_id TEXT NOT NULL, cookie TEXT, last_mutation_id INTEGER NOT NULL DEFAULT 0,
    next_mutation_id INTEGER NOT NULL DEFAULT 1, capture INTEGER NOT NULL DEFAULT 1)`);
  db.exec(`CREATE TABLE _mutation (id INTEGER PRIMARY KEY, name TEXT NOT NULL, v INTEGER NOT NULL, args TEXT NOT NULL)`);
  if (random() < 0.8) db.prepare('INSERT INTO _sync_meta (one, client_id, cookie) VALUES (1, ?, ?)').run(pick(['c1', 'é"\\', '']), pick([null, '7', '{"a":1}']));
  const rows = (sql, params) => { const st = db.prepare(sql); st.setReturnArrays(true); return st.all(...params); };
  const init = random() < 0.5 ? { init: { hooks: random() < 0.5, ...(random() < 0.3 ? { protocol: pick([0, 1, 2]) } : {}) } } : {};
  let a = null;
  let nextId = 1;
  for (let step = 0; step < STEPS; step++) {
    // The device between events: a change queued, the queue sent and confirmed, a cookie kept.
    const q = random();
    if (q < 0.15) db.prepare('INSERT INTO _mutation (id, name, v, args) VALUES (?, ?, 1, ?)').run(nextId++, pick(['createSong', 'renameItem']), pick(['{"id":"s"}', '{"x":[1,2.5,"ö"]}', '{}']));
    else if (q < 0.2) db.exec(`DELETE FROM _mutation WHERE id <= ${Math.floor(random() * nextId)}`);
    else if (q < 0.25) db.exec(`UPDATE _sync_meta SET cookie = '${pick(['8', '9', 'c'])}', last_mutation_id = ${Math.floor(random() * nextId)}`);
    const event = pick([
      () => ({ type: 'sync', ...(random() < 0.3 ? { push: random() < 0.5, pull: random() < 0.5 } : {}), ...(random() < 0.3 ? { media: true } : {}) }),
      () => ({ type: 'pushLimit', limit: pick([0, 1, 2, 5, -1, 1.5]) }),
      () => ({ type: 'answer', status: pick([200, 200, 200, 401, 403, 426, 500, 'x']), ...(random() < 0.2
        ? { text: pick(['{"cookie":"5","more":true}', 'not json', '{"error":"update-required"}']) }
        : { body: pick([{ cookie: '5', more: true }, { cookie: '6', more: false }, { more: true }, { error: 'update-required' }, { error: 'unauthenticated' }, { error: 'device-not-paired' }, { error: 'forbidden', b: 1, a: 2 }, null, 'text']) }) }),
      () => ({ type: 'failed', ...(random() < 0.8 ? { error: pick(['offline', 'x']) } : {}) }),
      () => ({ type: pick(['rebased', 'start', 'close', 'socketOpened', 'poke', 'socketClosed']) }),
      () => ({ type: 'timer', name: pick(['poll', 'reconnect', 'other']) }),
      () => ({ type: pick(['nothing', 42]) }),
    ])();
    const args = (state) => (state === null ? { ...init, ...(random() < 0.9 ? { event } : {}) } : { state, event });
    const given = args(a);
    const [ra, rb] = [await settle(rust.view('syncStepView', structuredClone(given), rows)), await settle(ts.view('syncStepView', structuredClone(given), rows))];
    if (canon(ra) !== canon(rb)) {
      differences++;
      if (differences <= 5) console.log(`  DIFFERENT step ${step} (seed ${seed}): ${JSON.stringify(given).slice(0, 300)}\n    Rust ${canon(ra).slice(0, 400)}\n    TS   ${canon(rb).slice(0, 400)}`);
    }
    const kind = ra.refused ? `refused ${ra.refused}` : event.type;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (ra.ok) a = ra.ok.state;
    // The bar's words for the state now.
    const status = { pending: db.prepare('SELECT count(*) AS n FROM _mutation').get().n, stopped: a?.stopped ?? null, connected: !!a?.connected, busy: !!a?.busy, waitedLong: random() < 0.5 };
    if (canon(rust.pure('syncStatusView', status)) !== canon(ts.pure('syncStatusView', status))) {
      differences++;
      if (differences <= 5) console.log(`  DIFFERENT status ${JSON.stringify(status)}: Rust ${canon(rust.pure('syncStatusView', status))} TS ${canon(ts.pure('syncStatusView', status))}`);
    }
  }
}
console.log(`sync driver: ${STEPS * SEEDS} events; ${Object.entries(kinds).toSorted().map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(differences ? `  ${differences} differences` : '  no differences');
process.exitCode = differences ? 1 : 0;
