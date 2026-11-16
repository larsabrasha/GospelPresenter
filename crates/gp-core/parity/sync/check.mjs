// node parity/sync/check.mjs [--steps N] [--seeds N]: sync's client logic, the Rust core's against the TS SyncClient.
// Device A runs twice, the TS client against a real server engine and the Rust core's commands fed the very pages
// it got; device B changes the same library meanwhile, conflicting edits among them. Each step one of: a change on A,
// a change on B, B syncing, A pushing or pulling through a network that loses answers, goes offline and refuses
// ("update required", signed out), A's role changing (the server resets A's copy). After every step A's two databases
// (every table, the queue, `_sync_meta`, `_undo`), the push A would send, the mutations the server rejected and the
// tables each change reported must be the same.
import { PROTOCOL_VERSION, SCHEMA_VERSION } from '../.out/ts-sync.mjs';
import { clock, dumpAll, openRustClient, openServer, openTsClient, schemaOf, transport, tsDump, tsSchema } from './world.mjs';
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
  const A = await openTsClient(tA, ctxA, 'clientA');
  const R = await openRustClient(ctxA, 'clientA');
  const B = await openTsClient(transport(store, ctxB), ctxB, 'clientB');
  await A.client.localWrite(localBlobs);
  for (const b of localBlobs) R.db.prepare(b.sql).run(...b.params);
  R.db.exec('DELETE FROM temp.changed_tables'); // as localWrite forgets them
  const genA = tools(random, R.db), genB = tools(random, serverDb);
  if (await tsSchema(A.client) !== schemaOf(R.db)) differ('open: different schema', '', '');

  for (let step = 1; step <= STEPS; step++) {
    clock.now += 1000;
    const q = random();
    let kind;
    if (q < 0.4) {
      const input = JSON.parse(JSON.stringify((random() < 0.4 ? generators[0] : genA.pick(generators))(genA, step)));
      if (!input.name) continue; // a step of the shell's own (a Bible text stored): not a change
      kind = 'A change';
      const [ra, rb] = [await settle(A.client.mutate(input.name, input.args)), await settle(R.mutate(input.name, input.args))];
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
      const sent = tA.sent.length, seen = tA.seen.length;
      const done = await settle(kind === 'A push' ? A.client.push() : A.client.pull());
      const stopped = A.client.stopped;
      note(`${kind} ${fate}${stopped ? ' (refused)' : ''}${fate === 'through' && done !== 'ok' ? `: ${done}` : ''}`);
      if (kind === 'A push') await comparePush(R, tA.sent.slice(sent), step);
      else if (done === 'ok' && !stopped) await R.rebase(tA.seen.slice(seen).map((x) => x.answer.body));
      A.client.updateRequired = false; // as when the app is updated or signed in again
      A.client.authError = null;
      fate = 'through';
    } else {
      kind = 'A role';
      ctxA.role = ctxA.role === 'admin' ? 'user' : 'admin'; // the server resets A's copy at its next pull
    }
    const [x, y] = [await tsDump(A.client), dumpAll(R.db)];
    if (x !== y) { differ(`${kind}: different rows`, '', firstDifference(x, y)); break; }
    if (canon(A.client.rejected) !== canon(R.rejected)) { differ(`${kind}: different rejections`, JSON.stringify(A.client.rejected.slice(-4)), JSON.stringify(R.rejected.slice(-4))); break; }
    if (JSON.stringify(A.changes) !== JSON.stringify(R.changes)) { differ(`${kind}: different tables reported`, JSON.stringify(A.changes.at(-1)), JSON.stringify(R.changes.at(-1))); break; }
  }
  return { rows: JSON.parse(dumpAll(R.db)).reduce((n, [, r]) => n + r.length, 0), queued: R.db.prepare('SELECT count(*) AS n FROM _mutation').get().n, refused: R.replaysRefused ?? 0 };
}

/** JSON with every object's keys in order: the rejections compare by content (the core's JSON sorts its keys). */
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).toSorted()) : x));

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

/** What A's TS client sent, if it had anything to send, against the push the Rust A would send. */
async function comparePush(R, sent, step) {
  const want = sent.find((x) => x.path.endsWith('/push'))?.req ?? null;
  const got = await R.pushRequest(PROTOCOL_VERSION, SCHEMA_VERSION);
  const same = want ? JSON.stringify(want) === JSON.stringify(got) : got.mutations.length === 0;
  if (!same) differ('A push: a different queue sent', JSON.stringify(want).slice(0, 300), JSON.stringify(got).slice(0, 300) + ` (step ${step})`);
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

const t0 = performance.now();
for (let s = 1; s <= SEEDS; s++) {
  const { rows, queued, refused } = await seedRun(s);
  console.log(`seed ${s}: ${rows} rows on A, ${queued} queued at the end, ${refused} replays refused`);
}
console.log(`sync: ${STEPS * SEEDS} steps over ${SEEDS} seeds in ${((performance.now() - t0) / 1000).toFixed(0)} s; ${Object.entries(tally).toSorted().map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(differences.size ? `  ${differences.size} kinds of difference:` : '  no differences');
for (const [kind, { count, a, b }] of differences) console.log(`  ${count}x ${kind}\n     ${typeof a === 'string' ? a : JSON.stringify(a).slice(0, 300)}\n     ${b}`);
process.exitCode = differences.size ? 1 : 0;
