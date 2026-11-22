// Imports, exports and files (wave 5): every view of the group through both cores. ProPresenter files and translations'
// zips made and damaged (files/made.mjs), DEFLATE streams sound and not; ProPresenter imports' duplicates; export zips'
// rows of every format upgraded, checked and their blobs named (files/rows.mjs), on the rows as given and as upgraded;
// 1.x's overlays; the export's rows of the demo and of odd values; Bible texts read, planned, kept and uploaded on
// devices holding them or not; the media plans for every policy, budget and `held` on devices with queued changes of
// every kind; and arguments that are not what they should be.
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { rust } from './harness.mjs';
import { makers } from './files/made.mjs';
import { rowMaker } from './files/rows.mjs';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const DEMO = fileURLToPath(new URL('../.out/fixtures/demo-views.sqlite', import.meta.url));

/** A copy of the demo with what the views read, `_mutation` made where the demo has none. */
function copyOfDemo() {
  const copy = new DatabaseSync(':memory:');
  copy.exec(`ATTACH '${DEMO}' AS demo`);
  for (const { name, sql } of copy.prepare("SELECT name, sql FROM demo.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    copy.exec(sql);
    copy.exec(`INSERT INTO main."${name}" SELECT * FROM demo."${name}"`);
  }
  copy.exec('DETACH demo');
  copy.exec('CREATE TABLE IF NOT EXISTS _mutation (id INTEGER PRIMARY KEY, name TEXT NOT NULL, v INTEGER NOT NULL, args TEXT NOT NULL)');
  return copy;
}

const garbage = [undefined, null, 0, 'x', [], [1], true, { data: 7 }, { data: null }, { data: '' }, { data: 'A' }, { data: 'AB=C' }, { data: 'ä' }, { data: ' QQ==' }, { data: 'QQ==' }, { data: 'QQ' }, { data: 'QUJD====' }];

export function cases(db, { random }) {
  const out = [];
  const m = makers(random);
  const { pick, int } = m;
  const pure = (name, args) => out.push({ name, args, pure: true });

  // ------------------------------------------------------------------ ProPresenter
  for (let i = 0; i < 1200; i++) {
    const bytes = m.proFile();
    const fileName = pick([null, undefined, 'Hos Dig', 'Untitled 3', '', ' Äran ', '𝄞'.repeat(120), 7]);
    pure('proPresenterSongView', { data: b64(bytes), fileName });
    pure('proPresenterSongView', { data: b64(m.damaged(bytes)), fileName });
  }
  for (let i = 0; i < 300; i++) pure('proPresenterSongView', { data: b64(m.noise(64)), fileName: 'x' });
  for (const g of garbage) pure('proPresenterSongView', g);
  pure('proPresenterSongView', { data: b64(m.proFile()).replace(/=+$/, '') });

  // ------------------------------------------------------------------ ProPresenter imports' duplicates
  const NAMES = ['Härlig är jorden', 'HÄRLIG ÄR JORDEN', 'Härlig är jorden'.normalize('NFD'), '  Härlig är jorden ', 'Tusen skäl', 'tusen skäl', 'Ὀδυσσεύς', 'ΣΟΦΟΣ', 'σοφος', 'Ett', '', 'İstanbul', 'istanbul'];
  const LINES = ['Härlig är jorden', 'härlig är Guds himmel', 'Skön är själarnas', 'pilgrimsgång'];
  const text = () => Array.from({ length: 1 + int(3) }, () => pick(LINES)).join(pick(['\n', ' ', '  \n', '\n\n', '\t', ' ', '﻿']));
  const odd = () => pick([null, 7, ['x'], { name: 'x' }, 'Härlig är jorden']);
  for (let i = 0; i < 800; i++) {
    const songs = Array.from({ length: 1 + int(5) }, () => (random() < 0.05 ? odd() : { name: pick(NAMES), text: text() }));
    const library = Array.from({ length: int(6) }, () => (random() < 0.05 ? odd() : { id: pick(['L1', 'L2', 'L3', '', null, 0, 5, false, true, ['x']]), name: pick(NAMES), text: text() }));
    pure('songNamesakesView', { names: songs.map((s) => (s && typeof s === 'object' ? s.name : s)), library: library.map((s) => (s && typeof s === 'object' ? s.name : s)) });
    pure('songImportDuplicatesView', { songs, library });
  }
  for (const g of [undefined, null, [], {}, { names: [] }, { names: [], library: 'x' }, { songs: [], library: null }, { songs: {}, library: [] }]) {
    pure('songNamesakesView', g);
    pure('songImportDuplicatesView', g);
  }

  // ------------------------------------------------------------------ translations' zips
  for (let i = 0; i < 700; i++) {
    const bytes = m.translation();
    pure('bibleImportView', { data: b64(bytes) });
    if (i % 2 === 0) pure('bibleImportView', { data: b64(m.damaged(bytes)) });
  }
  for (const [what, stream] of m.streams()) {
    const usfm = m.zip([{ name: `${what}.usfm`, raw: stream, size: 10 }, { name: 'b.usfm', text: '\\id EXO\n\\c 1\n\\v 1 Ord', deflate: true }]);
    pure('bibleImportView', { data: b64(usfm) });
    for (let k = 0; k < 20; k++) pure('bibleImportView', { data: b64(m.zip([{ name: 'a.usfm', raw: m.damaged(stream), size: 10 }])) });
  }
  for (const what of ['', 'not a zip', 'PK\u0005\u0006', 'PK\u0005\u0006'.padEnd(22, '\0'), 'PK\u0005\u0006\u0000\u0000\u0000\u0000\u0001\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000']) pure('bibleImportView', { data: b64(new TextEncoder().encode(what)) });
  for (const g of garbage) pure('bibleImportView', g);
  out.push({ name: 'bibleImportView', pure: true, args: { data: b64(new Uint8Array(52_428_801)) } });

  // ------------------------------------------------------------------ export zips' rows
  const r = rowMaker(random);
  for (let i = 0; i < 900; i++) {
    const format = pick([1, 2, 3, 4, 5, 6, 7, 8, 8, 2.5, 0, 9, -1]);
    const rows = r.textOf(r.rowsOf(Math.max(1, Math.min(8, Math.floor(format)))));
    pure('legacyUpgradeView', { format, rows });
    pure('legacyRowsProblemView', { rows });
    pure('legacyBlobsView', { rows });
    let upgraded;
    try {
      upgraded = rust.pure('legacyUpgradeView', { format, rows });
    } catch {
      continue;
    }
    pure('legacyRowsProblemView', { rows: upgraded });
    pure('legacyBlobsView', { rows: upgraded });
  }
  for (let i = 0; i < 300; i++) {
    const content = pick([null, 'Kollekt', ' Swish \n 123 \n', '', 'x'.repeat(2100), 'Rad\n'.repeat(30), '𝄞'.repeat(1001), 7]);
    const picture = pick([null, { full: pick(r.HASHES), thumb: pick(r.HASHES) }, { full: 1 }, { thumb: { b: 1, 10: 2, a: [3, { z: 1, 9: 2 }] }, full: 2 ** 60 }, 'x', [1]]);
    pure('legacyOverlayPageView', { content, picture });
  }
  for (const g of [undefined, null, [], {}, { rows: 7 }, { rows: '[]' }, { rows: '{' }, { format: 8 }, { format: '8', rows: '{}' }, { format: null, rows: '{}' }, { format: 8, rows: '{}' }, { rows: '{}' }, { rows: 'null' }]) {
    pure('legacyUpgradeView', g);
    pure('legacyRowsProblemView', g);
    pure('legacyBlobsView', g);
    pure('legacyOverlayPageView', g);
  }
  out.push({ name: 'exportRowsView', args: {} });
  out.push({ name: 'exportRowsView', args: [] });
  const oddRows = copyOfDemo();
  oddRows.exec("INSERT INTO labels (id, text, color, sort) VALUES ('z1', 'a\"b\\c\u0001', 'red', 9007199254740991), ('z2', X'00ff', 'x', 1.5), ('z3', '𝄞', 'y', -0.0), ('z4', 'big', 'y', 1e300), ('z5', 'e20', 'y', 1e20), ('z6', 'e19', 'y', 1.5e19), ('z7', 'small', 'y', 1e-7)");
  out.push({ name: 'exportRowsView', args: {}, db: oddRows });

  // ------------------------------------------------------------------ Bible texts
  out.push(...bibleTextCases(random, pick, int));

  // ------------------------------------------------------------------ media
  out.push(...mediaCases(random, pick));
  const answered = out.filter(beyondRust);
  console.log(`files: left out ${left.trap} cases where the Rust core traps, ${left.unordered} with a book sorted by a comparison that is no order`);
  return answered;
}

/**
 * Whether the Rust core answers a case at all, as a reference can: it traps (a panic) on a picture without `full` or
 * `thumb` for 1.x's overlay (serde_json's `map["thumb"]`), and its sort traps on, or orders as V8's does not, a book of
 * more than 20 verses whose chapter is not a number (a comparison that is no order). Those cases are left out, counted.
 */
const left = { trap: 0, unordered: 0 };
function beyondRust(c) {
  if (c.name !== 'bibleImportView' && c.name !== 'legacyOverlayPageView') return true;
  let answer;
  try {
    answer = rust.pure(c.name, structuredClone(c.args));
  } catch (e) {
    if (!(e instanceof WebAssembly.RuntimeError)) return true;
    left.trap++;
    return false;
  }
  const unordered = c.name === 'bibleImportView' && answer.books.some((b) => b.verses.length > 20 && b.verses.some((v) => v[0] === null));
  if (unordered) left.unordered++;
  return !unordered;
}

// ------------------------------------------------------------------ Bible texts

function bibleTextCases(random, pick, int) {
  const out = [];
  const CHARS = ['a', 'Å', 'ö', ' ', '"', '\\', '\n', '\t', '\u0001', '\u001f', '\u007f', ' ', '😀', '/', '<', 'é', 'é', ' '];
  const word = () => Array.from({ length: 1 + int(12) }, () => pick(CHARS)).join('');
  const CODES = ['GEN', 'EXO', 'MAT', 'JHN', 'REV', '1CO', 'PS2'];
  const text = () => [...new Set(Array.from({ length: 1 + int(4) }, () => pick(CODES)))].map((code) => ({ code, verses: Array.from({ length: 1 + int(5) }, () => [int(999), int(999), word()]) }));
  const canonical = (books) => `{"v":1,"books":[${books.map((b) => `{"code":${JSON.stringify(b.code)},"verses":${JSON.stringify(b.verses)}}`).join(',')}]}`;
  const one = (code, verses) => JSON.stringify({ v: 1, books: [{ code, verses }] });
  const WAYS = {
    canonical: (b) => canonical(b),
    spaced: (b) => JSON.stringify({ v: 1, books: b }, null, 2),
    floats: (b) => canonical(b).replace(/\[(\d+),(\d+),/g, '[$1.0,$2e0,').replace('"v":1', '"v":1.0'),
    exponent: (b) => canonical(b).replace('"v":1', '"v":10e-1'),
    extraKeys: (b) => JSON.stringify({ v: 1, x: 2, books: b.map((k) => ({ ...k, note: 'n' })) }),
    v2: (b) => JSON.stringify({ v: 2, books: b }),
    vString: (b) => JSON.stringify({ v: '1', books: b }),
    noBooks: () => '{"v":1,"books":[]}',
    lowerCode: (b) => one(b[0].code.toLowerCase(), b[0].verses),
    twice: (b) => JSON.stringify({ v: 1, books: [b[0], b[0]] }),
    fourParts: (b) => one(b[0].code, [[1, 1, 'a', 4]]),
    chapter1000: (b) => one(b[0].code, [[1000, 1, 'a']]),
    negative: (b) => one(b[0].code, [[-1, 1, 'a']]),
    minusZero: (b) => canonical(b).replace(/\[(\d+),/, '[-0,').replace(/\[-0,/, '[-0.0,'),
    half: (b) => one(b[0].code, [[1.5, 1, 'a']]),
    stringNumber: (b) => one(b[0].code, [['1', 1, 'a']]),
    emojiLimit: (b) => one(b[0].code, [[1, 1, '😀'.repeat(10_000)]]),
    emojiOver: (b) => one(b[0].code, [[1, 1, '😀'.repeat(10_001)]]),
    noVerses: (b) => one(b[0].code, []),
    tooMany: () => JSON.stringify({ v: 1, books: ['GEN', 'EXO'].map((code) => ({ code, verses: Array.from({ length: 30_001 }, (_, i) => [1, i % 999, 'a']) })) }),
    manyBooks: () => JSON.stringify({ v: 1, books: Array.from({ length: 201 }, (_, i) => ({ code: String(i).padStart(3, '0'), verses: [[1, 1, 'a']] })) }),
    notJson: (b) => canonical(b).slice(0, -3),
    array: (b) => JSON.stringify(b),
    lone: (b) => canonical(b).replace('"verses":[[', '"verses":[[1,1,"\\ud800"],['),
    huge: (b) => canonical(b).replace('"v":1', '"v":1,"x":1e400'),
    deep: (b) => canonical(b).replace('"v":1', `"v":1,"x":${'['.repeat(126)}${']'.repeat(126)}`),
    deeper: (b) => canonical(b).replace('"v":1', `"v":1,"x":${'['.repeat(127)}${']'.repeat(127)}`),
  };
  for (let n = 0; n < 500; n++) {
    const books = text();
    const [, write] = n < Object.keys(WAYS).length ? Object.entries(WAYS)[n] : pick(Object.entries(WAYS));
    const json = write(books);
    const hash = random() < 0.1 ? sha(json) : sha(canonical(books));
    out.push({ name: 'bibleTextStoreView', args: { hash, json }, pure: true });
  }
  for (const g of [undefined, null, [], {}, { hash: 7, json: '{}' }, { hash: 'x' }, { json: 7 }]) out.push({ name: 'bibleTextStoreView', args: g, pure: true });

  // Devices: translations kept and not, texts held and not, imports queued with sound and odd arguments.
  const texts = Array.from({ length: 9 }, () => {
    const books = text();
    return { books, hash: sha(canonical(books)) };
  });
  const QUEUES = [
    [],
    [['importBible', { contentHash: texts[8].hash }]],
    [['createPresentation', { id: 'p', name: 'P' }], ['importBible', { contentHash: texts[1].hash }], ['importBible', { contentHash: texts[3].hash }], ['importBible', { contentHash: 7 }], ['importBible', { name: 'x' }]],
    [['importBible', '{"contentHash":9007199254740993}'], ['importBible', '{"contentHash":1.0}'], ['importBible', '{"contentHash":-0.0}'], ['importBible', '{"contentHash":1e21}'], ['importBible', '{"contentHash":18446744073709551615}']],
    [['importBible', '{"contentHash":[1,null,"a"],"b":1e400}'], ['importBible', 'not json'], ['importBible', '{"contentHash":"\\ud800"}'], ['importBible', '[1]'], ['importBible', '{"contentHash":{"a":1}}'], ['importBible', '{"contentHash":12345678901234567890123}']],
    [['importBible', `{"contentHash":"${texts[2].hash}","x":${'['.repeat(127)}${']'.repeat(127)}}`], ['importBible', `{"contentHash":"${texts[2].hash}","x":${'['.repeat(126)}${']'.repeat(126)}}`]],
  ];
  for (const [q, queue] of QUEUES.entries()) {
    for (const held of [0, 1, 2]) {
      const d = copyOfDemo();
      const run = (sql, ...p) => d.prepare(sql).run(...p);
      texts.forEach(({ hash, books }, i) => {
        if (i < texts.length - 1) run('INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) VALUES (?, ?, ?, ?, 1, ?)', `bible:${i}`, `B${i}`, `B${i}`, 'sv', hash);
        if (i % 2 === 0) run('INSERT INTO kept_bibles (id, kept_at) VALUES (?, ?)', `bible:${i}`, i);
        if ((i + held) % 3 !== 0) {
          books.forEach((b, k) => run('INSERT INTO bible_texts (hash, book, sort, chunk) VALUES (?, ?, ?, ?)', hash, b.code, k, JSON.stringify(b.verses)));
          run('INSERT INTO bible_blobs (hash, verse_count) VALUES (?, 1)', hash);
        }
      });
      run("INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) VALUES ('bible:twin', 'T', 'T', 'sv', 1, ?)", texts[0].hash);
      if (held === 2) run("INSERT INTO bible_blobs (hash, verse_count) VALUES ('only-marker', 1)");
      queue.forEach(([name, args], i) => run('INSERT INTO _mutation (id, name, v, args) VALUES (?, ?, 1, ?)', i * 3 + 1, name, typeof args === 'string' ? args : JSON.stringify(args)));
      for (const keeping of ['all', 'chosen', undefined, 7]) out.push({ name: 'bibleTextPlanView', args: { keeping }, db: d });
      for (const uploaded of [[], [texts[1].hash], [texts[3].hash, 7, null, [1, 2]], 'x', ['9007199254740993', '1', '-0', '1e21', '18446744073709551616']]) out.push({ name: 'bibleUploadsView', args: { uploaded }, db: d });
      for (const hash of [...texts.map((t) => t.hash), 'only-marker', 'none', 7]) out.push({ name: 'bibleTextJsonView', args: { hash }, db: d });
      if (q === 0 && held === 0) for (const g of [undefined, null, []]) for (const name of ['bibleTextPlanView', 'bibleUploadsView', 'bibleTextJsonView']) out.push({ name, args: g, db: d });
    }
  }
  return out;
}

// ------------------------------------------------------------------ media

function mediaCases(random, pick) {
  const out = [];
  const hash = (n) => n.toString(16).padStart(64, '0');
  const NOW = 10_000_000_000;
  const HOUR = 60 * 60 * 1000;
  const devices = [];
  for (const kind of ['web', 'odd']) {
    const d = copyOfDemo();
    const run = (sql, ...p) => d.prepare(sql).run(...p);
    const held = (h, size, at, bytes = true) => run('INSERT OR REPLACE INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, ?, ?)', h, 'image/jpeg', size, bytes ? new Uint8Array([1]) : null, at);
    for (let k = 0; k < 8; k++) {
      run("INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at) VALUES (?, ?, 'image/jpeg', ?, ?, 10, 10, ?)", `img-p${k}`, `p${k}.jpg`, hash(100 + 2 * k), hash(101 + 2 * k), k);
      held(hash(100 + 2 * k), 1000 * (k + 1), NOW - (10 - k) * HOUR);
      held(hash(101 + 2 * k), 10 * (k + 1), NOW - (10 - k) * HOUR);
    }
    const first = d.prepare('SELECT id FROM presentations ORDER BY id LIMIT 1').get().id;
    run("INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES ('i-p0', ?, 'image', 'p0', 'img-p0', 99)", first);
    run("INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort, content) VALUES ('i-p1', ?, 'image', 'p1', 'x', 98, ?), ('i-p2', ?, 'image', 'p2', 'x', 97, 'not json')", first, JSON.stringify({ images: ['img-p1', 'img-p2', 'gone'] }), first);
    run("INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES ('i-v', ?, 'video', 'v', 'vid-2', 96)", first);
    held('h-full', 500, NOW - 5 * HOUR);
    for (const [n, size, at, bytes] of [[1, 700, NOW - 3 * HOUR, true], [2, 700, NOW - 60_000, true], [3, 700, NOW - 3 * HOUR, true], [4, 700, NOW - 3 * HOUR, false], [5, 80, NOW - 3 * HOUR, true], [6, 90, NOW - 3 * HOUR, true], [9, 60, NOW - 3 * HOUR, true]]) held(hash(n), size, at, bytes);
    const page = { background: null, backgroundPicture: { full: hash(9), thumb: hash(10) }, backgroundPage: null, elements: [{ id: 'e', kind: 'image', x: 0, y: 0, w: 1, h: 1, fit: 'cover', picture: { full: hash(11), thumb: hash(12) } }] };
    const definition = { song: { background: { image: { kind: 'picture', full: hash(14), thumb: hash(15) } } }, bible: { background: {} }, media: { image: { kind: 'picture', full: 7, thumb: hash(16) } } };
    const queue = [
      ['createPresentation', { id: 'q', name: 'Köad' }],
      ['addImage', { id: 'qi', fullHash: hash(3), thumbHash: hash(5) }],
      ['addSlides', { pages: [{ full: hash(6), thumb: hash(7) }, 7, { full: 2 ** 60 }] }],
      ['addVideo', { id: 'qv', hash: hash(8), stillHash: hash(6), thumbHash: hash(13) }],
      ['createCustomSlide', { id: 'qc', name: 'Välkommen', pages: [page], at: 1 }],
      ['updateCustomSlide', { pages: [page, { elements: [{ kind: 'image', picture: 'x' }] }] }],
      ['createOverlay', { page }],
      ['updateOverlay', { page: 0 }],
      ['createTheme', { definition }],
      ['updateTheme', { definition: { song: 1 } }],
      ['addAudio', { hash: hash(1) }],
      ['addSongFile', { hash: [1, null, 'a'] }],
      ['editImage', { fullHash: 1.5, thumbHash: true }],
      ['addImage', { id: 'qx', fullHash: 'not-a-hash', thumbHash: hash(5) }],
    ];
    queue.forEach(([name, args], i) => run('INSERT INTO _mutation (id, name, v, args) VALUES (?, ?, 1, ?)', i + 1, name, JSON.stringify(args)));
    if (kind === 'odd') {
      for (const [name, args] of [['addImage', '{"fullHash":9007199254740993,"thumbHash":1e21}'], ['addVideo', 'nope'], ['addAudio', '{"hash":"\\ud800"}'], ['addImage', '{"fullHash":-0.0,"thumbHash":18446744073709551615}']])
        run('INSERT INTO _mutation (id, name, v, args) VALUES ((SELECT max(id) + 1 FROM _mutation), ?, 1, ?)', name, args);
      held('big', 2 ** 52, 3, true);
      held('big2', 2 ** 51 + 0.5, 4, true);
      run("UPDATE media_blobs SET size = 'many' WHERE hash = ?", hash(5));
      run("INSERT INTO overlays (id, title, content, sort, updated_at) VALUES ('ov-p', 'P', ?, 0, 0)", JSON.stringify(page));
      run("INSERT INTO themes (id, name, definition, sort, updated_at) VALUES ('th-p', 'P', ?, 9, 0)", JSON.stringify(definition));
    }
    run("INSERT INTO video_files (hash, size, received, used_at) VALUES (?, 5000, 5000, 1), ('vh', 9000, 300, 2)", hash(20));
    run('INSERT OR IGNORE INTO pinned_presentations (id, pinned_at) VALUES (?, 1)', first);
    run("UPDATE presentations SET event_date = '2026-11-25' WHERE id = (SELECT id FROM presentations ORDER BY id LIMIT 1 OFFSET 2)");
    run("UPDATE presentations SET event_date = '2027-01-02' WHERE id = (SELECT id FROM presentations ORDER BY id LIMIT 1 OFFSET 3)");
    devices.push({ d, first });
  }
  const emptyDevice = copyOfDemo();
  emptyDevice.exec('DROP TABLE _mutation');
  const HELD = [undefined, null, [], [{ hash: hash(1), size: 700, at: 1 }, { hash: hash(100), size: 1000, at: NOW }, { hash: 'b', size: 5, at: 1 }, { hash: 'a', size: 5, at: 1 }, { hash: hash(20), size: 7000, at: 2 }], [{ hash: 'x', size: 9e18, at: -5 }, { hash: 'y', size: 9e18, at: 'z' }, 7, { size: 1.5 }, { hash: 'x', size: 2 ** 63 }]];
  const policies = [];
  for (const { first } of devices)
    for (const presenting of [undefined, null, first, 'none'])
      for (const persistent of [true, false, undefined])
        for (const keepComing of [true, false]) for (const fetch of [true, false, 'yes']) policies.push({ presenting, persistent, keepComing, today: '2026-11-22', days: pick([7, 0, 45, -3, 2.5]), fetch });
  const odd = [
    { presenting: '' },
    { presenting: 'x'.repeat(101) },
    { presenting: '𝄞'.repeat(100) },
    { presenting: 7 },
    { keepComing: true, today: '2026-02-27', days: 2 },
    { keepComing: true, today: 'x-13-40', days: 2 ** 63 },
    { keepComing: true, today: '+2026-+11-22', days: 1e300 },
    { keepComing: true, today: '-5-1-1', days: -9007199254740991 },
    { keepComing: true, today: '2026-11-22', days: 2 ** 62 },
    { keepComing: true, today: '99999999999999999999-1-1', days: '7' },
    { keepComing: true, today: '0-0-0', days: -800 },
    { keepComing: true, today: '2026-11', days: 3 },
    { keepComing: true, today: '', days: 3 },
  ];
  for (const { d } of devices) {
    for (const policy of [...policies, ...odd]) {
      out.push({ name: 'wantedMediaView', args: policy, db: d });
      for (let k = 0; k < 2; k++) out.push({ name: 'mediaStorageView', args: { ...policy, held: pick(HELD) }, db: d });
      for (let k = 0; k < 3; k++)
        out.push({ name: 'mediaPlanView', args: { ...policy, held: pick(HELD), inUse: pick([undefined, [hash(1), 7], 'x']), budget: pick([undefined, null, 0, 600, 5000, 2 ** 62, -1, 'x']), now: pick([NOW, undefined, 0, 1e300, -1e300, NOW + 0.5]) }, db: d });
    }
    for (const uploaded of [undefined, {}, { [hash(3)]: NOW - 1000 }, { [hash(3)]: NOW - HOUR, [hash(5)]: 'x', [hash(6)]: 1e300 }, [hash(3)], 'x'])
      for (const now of [NOW, undefined, -1e300, 2 ** 63]) out.push({ name: 'mediaUploadsView', args: { uploaded, now }, db: d });
  }
  for (const name of ['wantedMediaView', 'mediaPlanView', 'mediaUploadsView', 'mediaStorageView']) {
    out.push({ name, args: {}, db: emptyDevice });
    for (const g of [undefined, null, [], 'x']) out.push({ name, args: g, db: devices[0].d });
  }
  return out;
}
