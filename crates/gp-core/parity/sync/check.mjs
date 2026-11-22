// node parity/sync/check.mjs [--steps N] [--seeds N]: the SyncClient on the Rust core's sync commands against the TS
// SyncClient as it was before the switch (frozen by build.sh). Device A runs twice, the reference against a real
// server engine and the client on the core given the very answers the reference got, each of its requests checked
// against the reference's; device B changes the same library meanwhile, conflicting edits among them. Each step one of: a change on A,
// a change on B, B syncing, A pushing or pulling through a network that loses answers, goes offline and refuses
// ("update required", signed out), A's role changing (the server resets A's copy). After every step A's two databases
// (every table, the queue, `_sync_meta`, `_undo`), the push A would send, the mutations the server rejected and the
// tables each change reported, and whether the client stopped, must be the same.
import { clock, dumpAll, openClient, openServer, replay, schemaOf, transport, TREE } from './world.mjs';
import { rng, tools } from '../mutations/tools.mjs';
import { KNOWN, SEED } from '../mutations/seed.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : Number(argv[i + 1]); };
const STEPS = flag('--steps', 1500), SEEDS = flag('--seeds', 10);

/** The mutators' generators a device draws its changes from. */
const FILES = ['presentations', 'songs', 'arrangements', 'labels', 'song-materials', 'history', 'templates', 'custom-slides', 'overlays', 'displays', 'media', 'trash'];
const generators = await Promise.all(FILES.map(async (f) => (await import(`../mutations/gen-${f}.mjs`)).generator));

/** A seed's server: the mutators' organisation, and for every third seed 5 500 more songs, so a first pull is two pages. */
const serverSeed = (s) => [...SEED, ...(s % 3 === 0 ? [`INSERT INTO songs (id, name) SELECT 'bulk' || x, 'Sång ' || x FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 5500) SELECT x FROM c)`] : [])];
const localBlobs = KNOWN.map((h) => ({ sql: 'INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, NULL, 0)', params: [h, 'image/jpeg', 10] }));

const differences = new Map();
const tally = {};
const note = (kind) => (tally[kind] = (tally[kind] ?? 0) + 1);

async function seedRun(s) {
  const random = rng(s * 104729);
  const { db: serverDb, store } = openServer(serverSeed(s));
  const ctxA = { userId: 'uA', role: s % 4 === 0 ? 'user' : 'admin' }, ctxB = { userId: 'uB', role: 'admin' };
  let fate = 'through';
  const tA = transport(store, ctxA, () => fate);
  let replayed = replay([], differ);
  const A = await openClient({ reference: true, transport: tA, ctx: ctxA, clientId: 'clientA' });
  const R = await openClient({ reference: false, transport: { post: (path, body) => replayed.post(path, body) }, ctx: ctxA, clientId: 'clientA' });
  const B = await openClient({ reference: true, transport: transport(store, ctxB), ctx: ctxB, clientId: 'clientB' });
  for (const c of [A, R]) await c.client.localWrite(localBlobs);
  const genA = tools(random, R.db), genB = tools(random, serverDb);
  if (schemaOf(A.db) !== schemaOf(R.db)) differ('open: different schema', '', '');

  for (let step = 1; step <= STEPS; step++) {
    clock.now += 1000;
    const q = random();
    let kind;
    if (q < 0.4) {
      const input = JSON.parse(JSON.stringify((random() < 0.4 ? generators[0] : genA.pick(generators))(genA, step)));
      if (!input.name) continue; // a step of the shell's own (a Bible text stored): not a change
      kind = 'A change';
      const [ra, rb] = [await settle(A.client.mutate(input.name, input.args)), await settle(R.client.mutate(input.name, input.args))];
      note(`A change ${ra}`);
      if (ra !== rb) differ(`A change ${input.name}: TS ${ra}, Rust ${rb}`, input, '');
    } else if (q < 0.6) {
      kind = 'B change';
      const input = JSON.parse(JSON.stringify(random() < 0.5 ? takeAway(genB) : genB.pick(generators)(genB, step)));
      if (input.name) note(`B change ${await settle(B.client.mutate(input.name, input.args))}`);
    } else if (q < 0.7) {
      kind = 'B sync';
      await settle(B.client.sync());
    } else if (q < 0.99) {
      kind = random() < 0.35 ? 'A push' : 'A pull'; // pulls more often than pushes, so a change waits in the queue
      fate = pickFate(random);
      const from = tA.log.length;
      const call = (c) => settle(kind === 'A push' ? c.client.push() : c.client.pull());
      const ra = await call(A);
      replayed = replay(tA.log.slice(from), differ);
      const rb = await call(R);
      const stopped = (c) => `${c.client.updateRequired} ${c.client.authError}`;
      note(`${kind} ${fate}${A.client.stopped ? ' (refused)' : ''}${fate === 'through' && ra !== 'ok' ? `: ${ra}` : ''}`);
      if (ra !== rb || !replayed.done || stopped(A) !== stopped(R)) differ(`${kind}: TS ${ra}, Rust ${rb}${replayed.done ? '' : ', fewer requests'}`, '', '');
      // As when the app is updated or signed in again: the reference's flags cleared, and the driver's state as a new
      // client on the same database starts it (crates/gp-core/src/sync_driver.rs).
      if (TREE) for (const c of [A, R]) c.client.state = { ...c.client.state, stopped: null };
      else {
        A.client.updateRequired = false;
        A.client.authError = null;
        R.client.state = { ...R.client.state, stopped: null };
      }
      fate = 'through';
    } else {
      kind = 'A role';
      ctxA.role = ctxA.role === 'admin' ? 'user' : 'admin'; // the server resets A's copy at its next pull
    }
    const [x, y] = [dumpAll(A.db), dumpAll(R.db)];
    if (x !== y) { differ(`${kind}: different rows`, '', firstDifference(x, y)); break; }
    if (canon(A.client.rejected) !== canon(R.client.rejected)) { differ(`${kind}: different rejections`, JSON.stringify(A.client.rejected.slice(-4)), JSON.stringify(R.client.rejected.slice(-4))); break; }
    if (JSON.stringify(A.changes) !== JSON.stringify(R.changes)) { differ(`${kind}: different tables reported`, JSON.stringify(A.changes.at(-1)), JSON.stringify(R.changes.at(-1))); break; }
  }
  return { rows: JSON.parse(dumpAll(R.db)).reduce((n, [, r]) => n + r.length, 0), queued: R.db.prepare('SELECT count(*) AS n FROM _mutation').get().n };
}

/**
 * B takes away what A's queued changes name (an overlay, an arrangement, a song, a picture, a slideshow), so a change
 * that applied when A made it no longer does when A replays it: written in part, then refused.
 */
function takeAway({ pick, idsOf }) {
  const of = (sql) => pick([...idsOf(sql), 'x']);
  return pick([
    () => ({ name: 'deleteOverlay', args: { id: of('SELECT id FROM overlays') } }),
    () => ({ name: 'removeArrangement', args: { id: of('SELECT id FROM song_arrangements') } }),
    () => ({ name: pick(['trashSong', 'purgeSong']), args: { id: of('SELECT id FROM songs'), at: 5 } }),
    () => ({ name: pick(['trashImage', 'purgeImage']), args: { id: of('SELECT id FROM images'), at: 5 } }),
    () => ({ name: pick(['trashCustomSlide', 'purgeCustomSlide']), args: { id: of('SELECT id FROM custom_slides'), at: 5 } }),
  ])();
}

/** JSON with every object's keys in order: the rejections compare by content (the core's JSON sorts its keys). */
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).toSorted()) : x));

function pickFate(random) {
  const r = random();
  return r < 0.75 ? 'through' : r < 0.83 ? 'lost' : r < 0.9 ? 'offline' : r < 0.95 ? 'update' : 'signed-out';
}

/** `ok`, or what a change was refused with: the core's code, or SQLite's refusal of a statement. */
async function settle(promise) {
  try { await promise; return 'ok'; } catch (e) {
    const sqlite = e.cause?.code === 'ERR_SQLITE_ERROR' ? e.cause.message : /^sql-error: (.*)/.exec(e.code ?? '')?.[1];
    return sqlite !== undefined ? `sql-error: ${sqlite}` : e.code ?? `crash: ${e.message}`;
  }
}

function differ(kind, a, b) {
  if (!differences.has(kind)) differences.set(kind, { count: 0, a, b });
  differences.get(kind).count++;
}

function firstDifference(x, y) {
  const [a, b] = [JSON.parse(x), JSON.parse(y)];
  for (const [i, [t, rows]] of a.entries()) {
    const other = b[i]?.[1] ?? [];
    if (JSON.stringify(rows) === JSON.stringify(other)) continue;
    const k = Math.max(0, rows.findIndex((r, j) => JSON.stringify(r) !== JSON.stringify(other[j])));
    return `${t}: TS ${JSON.stringify(rows[k] ?? null).slice(0, 300)}\n       Rust ${JSON.stringify(other[k] ?? null).slice(0, 300)}`;
  }
  return '';
}

// In the port's mode the reference is Rust and the one under test is TS: the labels say which is which.
if (TREE) {
  const swap = (k) => k.replaceAll('TS ', '\u0000').replaceAll('Rust ', 'TS ').replaceAll('\u0000', 'Rust ');
  const set = differences.set.bind(differences);
  differences.set = (k, v) => set(swap(k), v);
  const has = differences.has.bind(differences), get = differences.get.bind(differences);
  differences.has = (k) => has(swap(k));
  differences.get = (k) => get(swap(k));
}

const t0 = performance.now();
for (let s = 1; s <= SEEDS; s++) {
  const { rows, queued } = await seedRun(s);
  console.log(`seed ${s}: ${rows} rows on A, ${queued} queued at the end`);
}
console.log(`sync: ${STEPS * SEEDS} steps over ${SEEDS} seeds in ${((performance.now() - t0) / 1000).toFixed(0)} s; ${Object.entries(tally).toSorted().map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(differences.size ? `  ${differences.size} kinds of difference:` : '  no differences');
for (const [kind, { count, a, b }] of differences) console.log(`  ${count}x ${kind}\n     ${typeof a === 'string' ? a : JSON.stringify(a).slice(0, 300)}\n     ${b}`);
process.exitCode = differences.size ? 1 : 0;
