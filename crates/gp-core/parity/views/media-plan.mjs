// What a device does with its media files (`mediaPlanView`, `mediaUploadsView`, `mediaStorageView`) against the web's
// own syncMedia, MediaUploads and storageReport (packages/sync/src/client/media.ts at bb87c4aa, built by build.sh): on
// the demo data with pictures held and not, old and new blobs nothing names (one without bytes, a video's), queued
// changes naming blobs of every kind, videos kept whole, a presentation kept offline, and every policy and budget.
import { copyFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { MediaUploads, storageReport, syncMedia } from '../.out/sync-media.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';

const hash = (n) => n.toString(16).padStart(64, '0');
const NOW = 10_000_000_000;
const HOUR = 60 * 60 * 1000;

/** A fresh copy of the demo, with what a device holds and has queued. */
function device(file, label) {
  const copy = file.replace(/\.sqlite$/, `-${label}.sqlite`);
  rmSync(copy, { force: true });
  copyFileSync(file, copy);
  const db = new DatabaseSync(copy);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  run('CREATE TABLE IF NOT EXISTS _mutation (id INTEGER PRIMARY KEY, name TEXT NOT NULL, v INTEGER NOT NULL, args TEXT NOT NULL)');
  const held = (h, size, at, bytes = true) => run('INSERT OR REPLACE INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, ?, ?)', h, 'image/jpeg', size, bytes ? new Uint8Array([1]) : null, at);
  // Eight pictures of the library, their thumbnails and full pictures held, of growing age and size.
  for (let k = 0; k < 8; k++) {
    run("INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at) VALUES (?, ?, 'image/jpeg', ?, ?, 10, 10, ?)", `img-p${k}`, `p${k}.jpg`, hash(100 + 2 * k), hash(101 + 2 * k), k);
    held(hash(100 + 2 * k), 1000 * (k + 1), NOW - (10 - k) * HOUR);
    held(hash(101 + 2 * k), 10 * (k + 1), NOW - (10 - k) * HOUR);
  }
  // One of them in the first presentation; the demo's own picture (h-full) held too.
  const first = db.prepare('SELECT id FROM presentations ORDER BY id LIMIT 1').get().id;
  run("INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES ('i-p0', ?, 'image', 'p0', 'img-p0', 99)", first);
  held('h-full', 500, NOW - 5 * HOUR);
  // Blobs nothing names: old, new (within the grace), old but queued, old without bytes (a video's record).
  held(hash(1), 700, NOW - 3 * HOUR);
  held(hash(2), 700, NOW - 60_000);
  held(hash(3), 700, NOW - 3 * HOUR);
  held(hash(4), 700, NOW - 3 * HOUR, false);
  held(hash(5), 80, NOW - 3 * HOUR);
  held(hash(6), 90, NOW - 3 * HOUR);
  held(hash(9), 60, NOW - 3 * HOUR);
  const page = { background: null, backgroundPicture: { full: hash(9), thumb: hash(10) }, backgroundPage: null, elements: [{ id: 'e', kind: 'image', x: 0, y: 0, w: 1, h: 1, fit: 'cover', picture: { full: hash(11), thumb: hash(12) } }] };
  const queue = [
    ['createPresentation', { id: 'q', name: 'Köad' }],
    ['addImage', { id: 'qi', fullHash: hash(3), thumbHash: hash(5) }],
    ['addSlides', { presentationId: first, itemId: 'qs', afterItemId: null, deckId: 'qd', fileName: 'a.pdf', pages: [{ full: hash(6), thumb: hash(7) }], at: 1 }],
    ['addVideo', { id: 'qv', hash: hash(8), stillHash: hash(6), thumbHash: hash(13) }],
    ['createCustomSlide', { id: 'qc', name: 'Välkommen', pages: [page], at: 1 }],
    ['addImage', { id: 'qx', fullHash: 'not-a-hash', thumbHash: hash(5) }],
  ];
  queue.forEach(([name, args], i) => run('INSERT INTO _mutation (id, name, v, args) VALUES (?, ?, 1, ?)', i + 1, name, JSON.stringify(args)));
  // Videos kept whole, and the first presentation kept offline by hand.
  run('INSERT INTO video_files (hash, size, received, used_at) VALUES (?, 5000, 5000, 1), (?, 9000, 300, 2)', hash(20), hash(21));
  run('INSERT INTO pinned_presentations (id, pinned_at) VALUES (?, 1)', first);
  const client = {
    query: async (sql, params = []) => db.prepare(sql).all(...params),
    localWrite: async (statements) => { for (const s of statements) db.prepare(s.sql).run(...(s.params ?? [])); },
    pending: async () => db.prepare('SELECT id, name, v, args FROM _mutation ORDER BY id').all(),
  };
  return { db, client, first };
}

const blobsHeld = (db) => db.prepare('SELECT hash FROM media_blobs ORDER BY hash').all().map((r) => r.hash);

export default async function check(_, file) {
  const differ = [];
  let compared = 0;
  const base = device(file, 'plan-base');
  const policies = [];
  for (const presenting of [null, base.first]) {
    for (const [persistent, keepComing] of [[true, false], [false, false], [true, true]]) {
      for (const budget of [0, 3000, 2 ** 31]) policies.push({ presenting, persistent, keepComing, today: '2026-04-01', days: 7, budget });
    }
  }
  policies.push({ presenting: base.first, persistent: true, keepComing: false, today: '2026-04-01', days: 7, budget: 0, fetch: false });
  for (const [n, policy] of policies.entries()) {
    compared++;
    const want = device(file, `plan-${n}`);
    const before = blobsHeld(want.db);
    const r = await syncMedia(want.client, async () => null, NOW, policy);
    const dropped = before.filter((h) => !blobsHeld(want.db).includes(h)).toSorted();
    const got = await viewRust(base.db, 'mediaPlanView', { ...policy, now: NOW });
    const mine = { fetch: got.fetch, drop: [...got.drop].toSorted(), cache: got.cache };
    if (canon(mine) !== canon({ fetch: r.missing, drop: dropped, cache: r.cache })) differ.push(`mediaPlanView ${JSON.stringify(policy)}: TS ${canon({ fetch: r.missing, drop: dropped, cache: r.cache }).slice(0, 400)} Rust ${canon(mine).slice(0, 400)}`);
    // A shell that keeps its files in a folder (the Mac and iOS app) says what it holds: the same plan, but for a
    // row without bytes, which only `media_blobs` has.
    compared++;
    const withBytes = base.db.prepare('SELECT hash, size, received_at AS at FROM media_blobs WHERE bytes IS NOT NULL').all().map((b) => ({ ...b }));
    const folder = await viewRust(base.db, 'mediaPlanView', { ...policy, now: NOW, held: withBytes });
    const noBytes = new Set(base.db.prepare('SELECT hash FROM media_blobs WHERE bytes IS NULL').all().map((b) => b.hash));
    const expected = { fetch: r.missing, drop: dropped.filter((h) => !noBytes.has(h)), cache: r.cache };
    const held = { fetch: folder.fetch, drop: [...folder.drop].toSorted(), cache: folder.cache };
    if (canon(held) !== canon(expected)) differ.push(`mediaPlanView held ${JSON.stringify(policy)}: TS ${canon(expected).slice(0, 400)} Rust ${canon(held).slice(0, 400)}`);
    // What the shell's player has (an old blob nothing names) is kept, the rest as before; the web has no such list.
    compared++;
    const playing = await viewRust(base.db, 'mediaPlanView', { ...policy, now: NOW, held: withBytes, inUse: [hash(1)] });
    const kept = { ...expected, drop: expected.drop.filter((h) => h !== hash(1)) };
    const mineKept = { fetch: playing.fetch, drop: [...playing.drop].toSorted(), cache: playing.cache };
    if (canon(mineKept) !== canon(kept)) differ.push(`mediaPlanView inUse ${JSON.stringify(policy)}: expected ${canon(kept).slice(0, 400)} Rust ${canon(mineKept).slice(0, 400)}`);
    compared++;
    const storage = await storageReport(base.client, policy);
    const rust = await viewRust(base.db, 'mediaStorageView', policy);
    if (canon(storage) !== canon(rust)) differ.push(`mediaStorageView ${JSON.stringify(policy)}: TS ${canon(storage)} Rust ${canon(rust)}`);
  }
  // A folder's video (the demo's, of pres-main) is cache over a budget of 0, but kept while its presentation is presented.
  const video = [{ hash: 'h-video', size: 5000, at: NOW - 3 * HOUR }];
  for (const presenting of [null, 'pres-main']) {
    compared++;
    const plan = await viewRust(base.db, 'mediaPlanView', { presenting, persistent: false, today: '2026-04-01', budget: 0, now: NOW, held: video });
    if (plan.drop.includes('h-video') !== !presenting) differ.push(`mediaPlanView a folder's video, presenting ${presenting}: drop ${canon(plan.drop)}`);
  }
  // The uploads before a push: all of them; none again within half the grace; all again after it.
  let t = NOW;
  const sent = [];
  const uploads = new MediaUploads(async (h) => (sent.push(h), 200), () => t);
  const uploaded = {};
  for (const [label, at] of [['first', NOW], ['10 minutes on', NOW + 10 * 60_000], ['31 minutes on', NOW + 31 * 60_000]]) {
    compared++;
    t = at;
    sent.length = 0;
    await uploads.beforePush(await base.client.pending(), base.client);
    const got = await viewRust(base.db, 'mediaUploadsView', { uploaded, now: at });
    // What the shell sends of the list when every upload goes through: each blob once, at its first change.
    const mine = [...new Set(got.uploads.map((u) => u.hash))];
    if (canon(mine) !== canon(sent)) differ.push(`mediaUploadsView ${label}: TS ${canon(sent)} Rust ${canon(mine)}`);
    for (const h of sent) uploaded[h] = at;
  }
  return { compared, differ, notes: ['every policy and budget: what to fetch, what to drop, the cache; the uploads before a push; the storage report'] };
}
