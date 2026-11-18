// The export zip's rows against the TS as it was when they moved to the core (packages/core/src/legacy.ts at fb03e798,
// build.sh's LEGACY_REFERENCE): `legacyUpgradeView`, `legacyRowsProblemView`, `legacyBlobsView` and
// `legacyOverlayPageView` against upgradeLegacyRows, legacyRowsProblem, legacyBlobs and legacyOverlayPage, on zips' rows
// of every format made here: every table's columns in another order, some missing or extra, ids of every kind, pages
// with pictures of Bilder by id and without, PDF decks, Bible passages, RTF leftovers, themes with pictures, outputs'
// kinds, and JSON text written loosely. The upgraded rows are compared table by table as JSON.stringify writes them,
// so each rewritten page is the same text; a refusal where the TS threw.
import { CLASSIC, LEGACY_TABLES, legacyBlobs, legacyOverlayPage, legacyRowsProblem, tableByName, upgradeLegacyRows } from '../.out/legacy-core.mjs';
import { DatabaseSync } from 'node:sqlite';
import { fieldTimeMigration } from '../beyond-reference.mjs';
import { viewRust } from '../diff.mjs';

let seed = 67;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);
const hex = () => Array.from({ length: 64 }, () => '0123456789abcdef'[int(16)]).join('');
const HASHES = Array.from({ length: 6 }, hex);
const hash = () => pick([...HASHES, ...HASHES, '', null, 'not-a-hash']);
const ID = () => pick(['a', 'b', 'c', 'd', 'e', '', 7, null, 'Ä', '10']);
/** JSON text as other code may write it: compact, spaced, or not JSON at all. */
const loose = (v) => pick([JSON.stringify(v), JSON.stringify(v), JSON.stringify(v, null, 1), `  ${JSON.stringify(v)} `, '{oops', '']);
const shuffled = (xs) => xs.map((x) => [rand(), x]).toSorted((a, b) => a[0] - b[0]).map((p) => p[1]);

function element(images) {
  const box = { id: pick(['t', 'i', 'r']), x: int(1920), y: int(1080), w: 100 + int(500), h: 50 + int(300) };
  return pick([
    () => ({ ...box, kind: 'text', text: pick(['Välkommen', '  Kollekt \n Swish  ', '']), size: 40, bold: false, italic: false, align: 'left', color: pick(['#ffffff', null, 'red']) }),
    () => ({ ...box, kind: 'image', picture: { full: pick(HASHES), thumb: pick(HASHES) }, fit: 'contain' }),
    () => ({ ...box, kind: 'image', imageId: pick([...images, 'missing', 7]), fit: 'cover' }),
    () => ({ kind: 'image', imageId: pick(images.length ? images : ['x']), ...box, fit: 'contain', extra: 1 }),
    () => ({ ...box, kind: 'rect', fill: '#000000', stroke: null, strokeWidth: 2, radius: 4 }),
  ])();
}

/** A page as stored: with pictures of Bilder by id before format 5, its own after; keys in another order at times. */
function page(images) {
  const p = { background: pick([null, '#112233']), backgroundPicture: pick([null, { full: pick(HASHES), thumb: pick(HASHES) }]), backgroundPage: null, elements: Array.from({ length: int(4) }, () => element(images)) };
  if (rand() < 0.3) { delete p.backgroundPicture; p.backgroundImageId = pick([...images, 'gone', null]) }
  if (rand() < 0.1) delete p.backgroundPage;
  if (rand() < 0.1) p.elements = pick([null, 'x']);
  if (rand() < 0.1) delete p.elements;
  if (rand() < 0.1) p['2'] = 'index';
  return rand() < 0.3 ? Object.fromEntries(shuffled(Object.entries(p))) : p;
}

/** A theme's definition with pictures in its backgrounds at times. */
function definition() {
  const d = structuredClone(CLASSIC.definition);
  for (const bg of [d.song.background, d.bible.background, d.media]) if (rand() < 0.4) bg.image = { kind: 'picture', full: pick(HASHES), thumb: pick(HASHES) };
  return loose(rand() < 0.1 ? { song: 1 } : d);
}

/** Whether this zip's rows are as a sound export writes them, so the check gets past the first table. */
let clean = false;
let serial = 0;

/** A row of `t` with what the export writes, in another order at times, a column missing or one more at times. */
function row(t, format, images) {
  const columns = tableByName.get(t).columns;
  const r = Object.fromEntries(columns.map((c) => [c, pick(['x', 1, null, 'Söndag'])]));
  r.id = clean ? `${t}-${serial++}` : ID();
  if ('updated_at' in r) r.updated_at = pick([100, null, 200]);
  const fill = {
    images: () => Object.assign(r, { full_hash: hash(), thumb_hash: hash(), original_full_hash: hash(), original_thumb_hash: pick([hash(), undefined]) }),
    audios: () => (r.hash = hash()),
    videos: () => Object.assign(r, { hash: pick([hash(), 3]), still_hash: hash(), thumb_hash: hash() }),
    song_materials: () => (r.hash = hash()),
    song_parts: () => (r.content = pick([';;', '\\*;;', ' ; \n', 'Härlig är jorden', ';', '', null, 'a;b'])),
    song_arrangements: () => (r.part_ids = pick([loose(shuffled(['a', 'b', 'c', 7, null])), 'x', null])),
    custom_slides: () => (r.pages = pick([loose(Array.from({ length: 1 + int(3) }, () => page(images))), loose([]), null])),
    overlays: () => (r.content = format === 1 ? pick(['Kollekt\nSwish 123', '  ', null, 'x'.repeat(2100)]) : pick([loose(page(images)), null])),
    themes: () => (r.definition = definition()),
    displays: () => (r.kind = pick(['public', 'screen', 'scene', null])),
    presentation_items: () => {
      r.type = pick(['song', 'slides', 'bible', 'custom', 'header']);
      r.content = r.type === 'slides' ? loose({ fileName: 'a.pdf', pages: pick([[{ full: pick(HASHES), thumb: pick(HASHES) }], [], [{ full: 'x' }]]) })
        : r.type === 'bible' ? pick([loose({ translation: 'SFB', slides: [[{ n: pick([1, null, 1.5, 1000]), t: 'I begynnelsen' }]] }), '', null]) : pick(['x', null]);
    },
  }[t];
  fill?.();
  if (format === 1 && t === 'overlays') r.image_id = pick([...images, 'gone', null]);
  if (clean) {
    if (t === 'displays') r.kind = pick(['public', 'screen', 'screen', 'public', 'scene']);
    if (t === 'presentation_items' && r.type === 'bible' && rand() < 0.8) r.content = JSON.stringify({ translation: 'SFB', slides: [[{ n: 1, t: 'I begynnelsen' }]] });
    if (t === 'presentation_items' && r.type === 'slides' && format >= 3 && rand() < 0.5) r.type = 'song';
    if (t === 'custom_slides' && rand() < 0.8) r.pages = JSON.stringify([{ background: null, backgroundPicture: null, backgroundPage: null, elements: [] }]);
    if (rand() < 0.97) return r;
  }
  if (rand() < 0.04) delete r[pick(Object.keys(r))];
  if (rand() < 0.04) r[pick(['extra', '5', '0'])] = 1;
  return rand() < 0.3 ? Object.fromEntries(shuffled(Object.entries(r))) : r;
}

/** A zip's rows of `format`, with the tables it has. */
function rowsOf(format) {
  clean = rand() < 0.5;
  const images = ['img1', 'img2', 7];
  const rows = {};
  for (const t of LEGACY_TABLES) {
    if (format < 8 && ['themes', 'videos', 'song_materials'].includes(t)) continue;
    if (format < 4 && t === 'custom_slides') continue;
    rows[t] = Array.from({ length: int(4) }, () => row(t, format, images));
  }
  if (rows.images.length) rows.images[0].id = pick(images);
  if (format === 3) rows.slide_decks = Array.from({ length: int(3) }, () => ({ id: ID(), name: pick(['Predikan.pdf', null]), pages: pick([loose([{ full: pick(HASHES), thumb: pick(HASHES) }]), loose([]), '{']) }));
  return rows;
}

const tables = (text) => {
  const rows = JSON.parse(text);
  return Object.fromEntries(Object.keys(rows).toSorted().map((t) => [t, JSON.stringify(rows[t])]));
};
const refusal = (got) => (got && typeof got === 'object' && 'refused' in got ? `refused ${got.refused}` : null);

export default async function check(db, file) {
  const differ = [];
  let compared = 0;
  let upgraded = 0;
  let rewritten = 0;
  let problems = 0;
  let named = 0;
  const same = (what, want, got) => {
    compared++;
    if (want !== got) differ.push(`${what}: TS ${want.slice(0, 300)} Rust ${got.slice(0, 300)}`);
  };
  for (let i = 0; i < 1500; i++) {
    const format = 1 + int(8);
    const text = JSON.stringify(rowsOf(format));
    let want;
    try {
      want = upgradeLegacyRows(format, JSON.parse(text));
      upgraded++;
    } catch {
      want = null;
    }
    const got = await viewRust(db, 'legacyUpgradeView', { format, rows: text });
    if (!want) {
      same(`upgrade ${i} (format ${format})`, 'refused invalid-rows', refusal(got) ?? 'upgraded');
      continue;
    }
    if (refusal(got)) {
      same(`upgrade ${i} (format ${format})`, 'upgraded', refusal(got));
      continue;
    }
    const w = tables(JSON.stringify(want));
    const g = tables(got);
    same(`upgrade ${i} (format ${format}) tables`, Object.keys(w).join(), Object.keys(g).join());
    for (const t of Object.keys(w)) if (w[t] !== g[t]) same(`upgrade ${i} (format ${format}) ${t}`, w[t], g[t] ?? '');
    const rows = JSON.stringify(want);
    if (rows !== text) rewritten++;
    const problem = legacyRowsProblem(want);
    if (problem) problems++;
    same(`problem ${i}`, JSON.stringify(problem), JSON.stringify(await viewRust(db, 'legacyRowsProblemView', { rows })));
    const blobs = legacyBlobs(want);
    named += blobs.named.length;
    same(`blobs ${i}`, JSON.stringify({ named: blobs.named, videos: [...blobs.videos] }), JSON.stringify(await viewRust(db, 'legacyBlobsView', { rows })));
  }
  for (let i = 0; i < 300; i++) {
    const content = pick([null, 'Kollekt', ' Swish \n 123 \n', '', 'x'.repeat(2100), 'Rad\n'.repeat(30)]);
    const picture = pick([null, { full: pick(HASHES), thumb: pick(HASHES) }]);
    same(`overlay page ${i}`, JSON.stringify(legacyOverlayPage(content, picture)), await viewRust(db, 'legacyOverlayPageView', { content, picture }));
  }
  // The export's rows from a copy of the demo's database brought to schema 27, as orgExport.ts read them before (`readRows`).
  const copy = new DatabaseSync(':memory:');
  copy.exec(`ATTACH '${file}' AS demo`);
  for (const { name, sql } of copy.prepare("SELECT name, sql FROM demo.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    copy.exec(sql);
    copy.exec(`INSERT INTO main.${name} SELECT * FROM demo.${name}`);
  }
  for (const s of fieldTimeMigration()) copy.exec(s);
  const read = Object.fromEntries(LEGACY_TABLES.map((t) => [t, copy.prepare(`SELECT ${tableByName.get(t).columns.join(', ')} FROM ${t} ORDER BY id`).all()]));
  same('export rows', JSON.stringify(read), await viewRust(copy, 'exportRowsView', {}));
  const what = `${upgraded} upgraded (${rewritten} changed by it), ${problems} with a row the server refuses, ${named} blobs named`;
  return { compared, differ, notes: [`1 500 zips' rows of formats 1 to 8: ${what}; 300 overlays of 1.x`] };
}
