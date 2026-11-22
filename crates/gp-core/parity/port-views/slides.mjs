// The slides group of wave 3: itemSlidesView, bibleSlidesView, verseSearchPlanView, bibleBookNamesView, bibleView,
// presentingKeyView, slideMarksView, themeView and highlightView. Every presentation and item of the demo data (each
// song item in every arrangement), libraries made to read every way (songs' sorts, credits and arrangements that do not
// read, pictures, sounds, videos, custom pages and Bible contents of every shape), stored Bible texts with chunks that
// do not read, random passages, references, running orders and keys, search texts, and arguments that are not what
// they should be.
import { emptyDb } from './harness.mjs';

const CODES = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
const NAMES = ['1 mos', '1:a mosebok', 'första moseboken', 'andra mos', '5:e mos', 'gen', 'Genesis', 'joh', '1 joh', '3:e joh', 'johannes', 'John', 'ps', 'psalm', 'Psaltaren', 'höga visan', 'HV', 'song of songs', 'apg', 'acts', 'upp', 'jak', 'fil', 'filem', 'mat', 'ma', 'j', 'jo', 'x', '1', 'kö', 'kr', 'Ö', 'tess', '2 thess', 'jhn', 'PSA', 'ezk', 'Hes', 'höga', '1 Sam', 'ÅÄÖ', 'jo\u{feff}h', '\u{85}joh', 'joh\u{a0}', ''];
const SPACES = [' ', '  ', '\u{a0}', '\u{85}', '\u{feff}', '\t', '\u{3000}'];
const GARBAGE = [null, 5, 'x', [], true, { a: 1 }];

/** `n` random words of a made-up text, with the marks reading pauses at. */
function words(pick, n) {
  return Array.from({ length: n }, () => pick(['och', 'Herren', 'säger', 'ljus', 'å', 'ö', 'Gud', '”citat”', 'x'.repeat(30)]) + pick(['', '', '', '', ',', '.', ';', ':', '!', '?', '…', '.”', ')', '–'])).join(pick([' ', ' ', '  ']));
}

/** A book of made-up verses, `[chapter, verse, text]`, some chapters with a verse missing. */
function book(pick, random, code) {
  const out = [];
  const chapters = 1 + Math.floor(random() * 5);
  for (let c = 1; c <= chapters; c++) for (let v = 1, n = 1 + Math.floor(random() * 12); v <= n; v++) if (random() > 0.1) out.push([c, v, random() < 0.05 ? '' : `${code} ${words(pick, 1 + Math.floor(random() * 40))}`]);
  return out;
}

function itemSlidesCases(db, { pick, random }) {
  const out = [];
  const add = (items) => out.push({ name: 'itemSlidesView', args: { items } });
  const itemsOf = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ id: r.id, type: r.type, title: r.title, sourceId: r.source_id, arrangementId: r.arrangement_id, content: r.content }));
  const all = itemsOf('SELECT * FROM presentation_items ORDER BY presentation_id, sort, id');
  for (const { id } of db.prepare('SELECT id FROM presentations').all()) add(itemsOf('SELECT * FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id', id));
  add(all);
  add([]);
  for (const item of all) {
    add([item]);
    if (item.type !== 'song') continue;
    const arrangements = db.prepare('SELECT id FROM song_arrangements WHERE song_id = ?').all(item.sourceId).map((r) => r.id);
    for (const arrangementId of [...arrangements, null, 'original', 'gone', '']) add([{ ...item, arrangementId }]);
  }
  for (const { id } of db.prepare('SELECT id FROM songs').all()) add([{ id: 'preview', type: 'song', title: '', sourceId: id, arrangementId: null, content: null }]);
  // Items of kinds that read as songs, an item missing its optional fields, and the same id twice.
  for (const type of ['song', 'other', '', 'SONG', 'bible', 'image', 'audio', 'video', 'custom', 'header']) {
    for (const sourceId of ['song-0', 'img-1', 'aud-1', 'vid-1', 'cs-1', 'gone', '']) add([{ id: 'i', type, sourceId }, { id: 'j', type: 'song', title: 5, sourceId: 'song-0' }]);
  }
  add([{ id: 'same', type: 'song', sourceId: 'song-0' }, { id: 'same', type: 'song', sourceId: 'song-1' }]);
  add([{ id: '__proto__', type: 'song', sourceId: 'song-0' }]);
  // Contents of every shape on image and Bible items.
  const bible = (translation, slides) => JSON.stringify({ translation, slides });
  const contents = [null, '', 'not json', '[]', '{}', '{"images":[]}', '{"images":["img-1","gone-img","img-2","img-3"]}', '{"images":["img-1",5]}', `{"images":["${'x'.repeat(65)}"]}`, `{"images":${JSON.stringify(Array(51).fill('img-1'))}}`, '{"images":[""]}', '{"images":["😀"]}',
    bible('Demo', [[{ n: 1, t: 'a' }, { n: null, t: 'b' }], [{ n: 0, t: '' }]]), bible('', [[{ n: 3, t: 'x' }]]), bible('x'.repeat(51), []), bible('😀'.repeat(50), [[{ n: 2, t: 'y' }]]), bible('T', [[{ n: 1.5, t: 'a' }]]), bible('T', [[{ n: 1000, t: 'a' }]]), bible('T', [[{ t: 'a' }]]),
    bible('T', [[{ n: 1, t: 'x'.repeat(10_001) }]]), bible('T', [[{ n: 1, t: 5 }]]), bible('T', [5]), bible('T', 'x'), bible(5, []), bible('T', []), bible('T', [[]]), '{"translation":"T","slides":[[{"n":1.0,"t":"a"}]]}', '{"translation":"T","slides":[[{"n":"1","t":"a"}]]}', '{"translation":"T","slides":[[{"n":-1,"t":"a"}]]}', '{"translation":"\\ud800","slides":[]}', '{"translation":"T","slides":[[{"n":1e400,"t":"a"}]]}',
    bible('T', Array.from({ length: 1001 }, () => [])), bible('T', [Array.from({ length: 501 }, () => ({ n: null, t: '' }))])];
  for (const content of contents) for (const type of ['image', 'bible']) add([{ id: 'c', type, title: 'Johannes 3:16', sourceId: 'img-1', arrangementId: null, content }]);
  for (const bad of [undefined, null, 5, 'x', {}, [5], [null], [{}], [{ id: '', type: 'song' }], [{ id: 'x'.repeat(101), type: 'song' }], [{ id: '😀'.repeat(100), type: 'song' }], [{ id: 5, type: 'song' }], [{ id: 'a' }], [{ id: 'a', type: 5 }], [{ id: 'a', type: null }]]) out.push({ name: 'itemSlidesView', args: bad === undefined ? {} : { items: bad } });
  for (const args of GARBAGE) out.push({ name: 'itemSlidesView', args });

  // A library made to read every way: sorts and credits as SQLite may hold them, arrangements that do not read,
  // repeated parts, labels gone, trashed songs; pictures, sounds, videos and custom pages of every shape.
  const lib = emptyDb([
    "PRAGMA foreign_keys = OFF",
    "INSERT INTO labels (id, text, color, sort) VALUES ('l1', 'Vers', '#fff', 0), ('l2', 'Kör', '#000', 1)",
    "INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at, deleted_at) VALUES ('img-1', 'a.jpg', 'image/jpeg', 'f1', 't1', 1, 1, 0, NULL), ('img-2', 'b.jpg', 'image/jpeg', 'f2', 't2', 1, 1, 0, 5)",
    "INSERT INTO audios (id, file_name, content_type, hash, size, created_at, deleted_at) VALUES ('aud-1', 'x.mp3', 'audio/mpeg', 'ah', 9, 70, NULL)",
    "INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at, deleted_at) VALUES ('vid-1', 'a.mov', 'video/quicktime', 'hevc', 'vh', 5, 6.5, 7, 8, 'vs', 'vt', 90, NULL)",
  ]);
  const run = (sql, ...p) => lib.prepare(sql).run(...p);
  const authors = [null, '', '  ', 'Okänd', ' A ', '\u{feff}'];
  const publishers = [null, '', ' ', 'Förlaget'];
  const years = [null, 0, 2020, '2020', 1.5, 'abc', -3];
  const sorts = [0, 1, 1, 2, -1, 1.5, null, 'x', 2 ** 40];
  const songIds = [];
  for (let s = 0; s < 60; s++) {
    const id = `s${s}`;
    songIds.push(id);
    run('INSERT INTO songs (id, name, author, publisher, year, deleted_at) VALUES (?, ?, ?, ?, ?, ?)', id, `Sång ${s}`, pick(authors), pick(publishers), pick(years), random() < 0.1 ? 5 : null);
    const parts = [];
    for (let p = 0, n = Math.floor(random() * 6); p < n; p++) {
      const pid = pick([`${id}-p${p}`, `${id}-P${p}`, `${id}-${'ö'.repeat(p)}`]) + (p >= 3 ? `-${p}` : '');
      parts.push(pid);
      const sort = pick(sorts);
      run('INSERT INTO song_parts (id, song_id, sort, label_id, content) VALUES (?, ?, ?, ?, ?)', pid, id, sort === null ? 0 : sort, pick([null, 'l1', 'l2', 'gone']), words(pick, Math.floor(random() * 8)));
    }
    for (let a = 0, n = Math.floor(random() * 4); a < n; a++) {
      const ids = Array.from({ length: Math.floor(random() * 6) }, () => pick([...parts, 'gone']));
      run('INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES (?, ?, ?, ?, ?)', `${id}-a${a}`, id, 'A', pick([JSON.stringify(ids), JSON.stringify(ids), 'not json', '{}', '[1,"x"]', '']), pick([0, 1, 0, 2.5]));
    }
  }
  run("INSERT INTO custom_slides (id, name, pages, created_at, updated_at) VALUES ('cs-0', 'A', '[]', 1, 1), ('cs-1', 'B', 'not json', 1, 1), ('cs-2', 'C', '{}', 1, 1), ('cs-3', 'D', '[5, \"x\", null]', 1, 1)");
  const element = () => ({ id: 'e', kind: pick(['text', 'text', 'picture', 5]), x: pick([0, 10, 10, 1.5, -3, 'x', null]), y: pick([0, 100, 100, 2e10, null]), text: pick(['  ', 'Hej', ' Swisha ', 5, null, 'b\nc']) });
  for (let c = 4; c < 40; c++) {
    const pages = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
      background: pick([null, '#000000']),
      backgroundPicture: null,
      backgroundPage: pick([null, null, { full: 'pf', thumb: 'pt' }, { full: 'pf' }, 5, 'x']),
      elements: pick([[], 5, null, Array.from({ length: Math.floor(random() * 6) }, element)]),
      extra: pick([undefined, 1, 'x']),
    }));
    run('INSERT INTO custom_slides (id, name, pages, created_at, updated_at) VALUES (?, ?, ?, 1, 1)', `cs-${c}`, 'E', JSON.stringify(pages));
  }
  const sources = { song: [...songIds, 'gone'], image: ['img-1', 'img-2', 'gone'], audio: ['aud-1', 'gone'], video: ['vid-1', 'gone'], custom: [...Array.from({ length: 40 }, (_, c) => `cs-${c}`), 'gone'], header: ['h'], bible: ['b'], other: songIds };
  for (let n = 0; n < 600; n++) {
    const items = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, k) => {
      const type = pick(Object.keys(sources));
      const sourceId = pick(sources[type]);
      const arrangementId = type === 'song' ? pick([null, null, `${sourceId}-a0`, `${sourceId}-a1`, 'original', 'gone']) : null;
      return { id: `i${k}`, type, title: 'T', sourceId, arrangementId, content: type === 'image' || type === 'bible' ? pick(contents) : null };
    });
    out.push({ name: 'itemSlidesView', args: { items }, db: lib });
  }
  return out;
}

function bibleCases(db, { pick, random }) {
  const out = [];
  const HASH = 'f'.repeat(64);
  const texts = Object.fromEntries(['GEN', 'PSA', 'JHN', '1JN', 'XYZ'].map((code) => [code, book(pick, random, code)]));
  const statements = Object.entries(texts).map(([code, verses], i) => `INSERT INTO bible_texts (hash, book, sort, chunk) VALUES ('${HASH}', '${code}', ${[2, 0, 1, 3, 4][i]}, '${JSON.stringify(verses).replaceAll("'", "''")}')`);
  // Chunks that do not read as serde reads them, beside texts with points and exponents inside the verses.
  const bad = { AAA: '[[1.0,1,"a"]]', BBB: '[[1,1]]', CCC: '[[1,1,"a",4]]', DDD: 'not json', EEE: '[]', FFF: '[[1e2,1,"x"]]', GGG: '[["1",1,"x"]]', HHH: '{"a":1}', III: '[[1,2,"e.E \\" 1.5e3"],[1,3,"ok"]]', JJJ: '[[1,1,"\\ud800"]]', KKK: '[[-0,1,"neg"],[-1,2,"m"]]', LLL: '[[1,1,null]]' };
  Object.entries(bad).forEach(([code, chunk], i) => statements.push(`INSERT INTO bible_texts (hash, book, sort, chunk) VALUES ('h2', '${code}', ${i}, '${chunk}')`));
  const bibles = emptyDb(statements);
  const view = (args) => out.push({ name: 'bibleView', args, db: bibles });
  view({ hash: HASH });
  view({ hash: 'h2' });
  for (const hash of ['e'.repeat(64), '', 5, null, undefined]) view(hash === undefined ? {} : { hash });
  for (const args of GARBAGE) out.push({ name: 'bibleView', args, db: bibles });
  for (const code of Object.keys(bad)) for (const chapter of [1, 2, undefined]) view({ hash: 'h2', book: code, chapter, passage: { books: [code], from: [0, 0], to: [9, 9] } });
  for (const [code, verses] of Object.entries(texts)) {
    const chapters = [...new Set(verses.map(([c]) => c))];
    view({ hash: HASH, book: code });
    for (const chapter of [...chapters, 99, 1.5, '1', null, -1]) view({ hash: HASH, book: code, chapter });
    const points = verses.map(([c, v]) => [c, v]);
    for (const from of points) for (const to of [pick(points), pick(points), [from[0], 999]]) view({ hash: HASH, passage: { books: pick([[code], [code, 'JHN'], CODES, [code, 5]]), from, to } });
  }
  view({ hash: HASH, book: 'NOPE' });
  view({ hash: HASH, book: 5, chapter: 1 });
  for (const passage of [null, 5, {}, { books: 'GEN', from: [1, 1], to: [2, 2] }, { books: [], from: [1, 1], to: [2, 2] }, { books: ['GEN'], from: [1], to: [2, 2] }, { books: ['GEN'], from: [1, 1, 1], to: [2, 2] }, { books: ['GEN'], from: [1, 1.5], to: [2, 2] }, { books: ['GEN'], from: [1, 1], to: 'x' }, { books: ['GEN'], from: [0, 0], to: [2 ** 53, 0] }])
    for (const hash of [HASH, 'gone']) view({ hash, passage });
  view({ hash: 'x' }); // the demo data has no text
  out.push({ name: 'bibleView', args: { hash: HASH }, db });

  // A passage's preview: random runs of each made-up book, translations of every length, verses that do not read.
  for (let n = 0; n < 800; n++) {
    const code = pick(Object.keys(texts).slice(0, 4));
    const verses = texts[code];
    const from = Math.floor(random() * verses.length);
    const passage = verses.slice(from, from + 1 + Math.floor(random() * pick([3, 10, 40]))).map(([c, v, t]) => ({ b: code, c, v, t }));
    if (random() < 0.1 && passage.length) passage.push({ b: pick(CODES), c: 1, v: 1, t: words(pick, 5) });
    out.push({ name: 'bibleSlidesView', pure: true, args: { translation: pick(['SFB', '', 'x'.repeat(51), 5, undefined]), verses: passage } });
  }
  const long = Array.from({ length: 300 }, (_, v) => ({ b: 'PSA', c: 119, v: v + 1, t: words(pick, 30) }));
  out.push({ name: 'bibleSlidesView', pure: true, args: { translation: 'SFB', verses: long } });
  out.push({ name: 'bibleSlidesView', pure: true, args: { translation: 'SFB', verses: [{ b: 'JHN', c: 3, v: 16, t: 'x'.repeat(10_000) }] } });
  const verse = { b: 'JHN', c: 3, v: 16, t: 'Ty så älskade Gud världen.' };
  for (const wrong of [{ b: 'jhn' }, { b: 'JH' }, { b: 'JHNN' }, { b: 'ÅÄÖ' }, { b: 5 }, { c: -1 }, { c: 1000 }, { c: 1.5 }, { c: '3' }, { v: null }, { t: 5 }, { t: 'x'.repeat(10_001) }, { t: '😀'.repeat(10_000) }, { c: 0, v: 0, t: '' }, { b: '1JN' }, { b: 'XYZ' }])
    out.push({ name: 'bibleSlidesView', pure: true, args: { translation: 'SFB', verses: [verse, { ...verse, ...wrong }] } });
  for (const verses of [undefined, null, 5, 'x', [], [5], [null]]) out.push({ name: 'bibleSlidesView', pure: true, args: verses === undefined ? { translation: 'SFB' } : { translation: 'SFB', verses } });
  for (const args of GARBAGE) out.push({ name: 'bibleSlidesView', pure: true, args });
  return out;
}

function referenceCases({ pick, random }) {
  const out = [];
  const n = () => String(pick([1 + Math.floor(random() * 30), 0, 150, '007', '99999999999', '9223372036854775807', '9223372036854775808']));
  const tails = [() => '', () => ` ${n()}`, () => ` ${n()}:${n()}`, () => ` ${n()}:${n()}-${n()}`, () => ` ${n()}-${n()}`, () => ` ${n()}:${n()}-${n()}:${n()}`, () => ` ${n()}:${n()}-`, () => ` ${n()}:`, () => ` ${n()}-`, () => `  ${n()} : ${n()} - ${n()} `, () => ` ${n()}:x`, () => ` ${n()}--`, () => ` ${n()} ${n()}`, () => `${pick(SPACES)}${n()}${pick(SPACES)}`];
  const books = [CODES, CODES.slice(0, 39), ['JHN', 'PSA', 'GEN'], ['1JN', '2JN', 'JHN', 'JHN'], [], ['jhn', 'Gen', 'XYZ', 5]];
  for (let i = 0; i < 2500; i++) {
    const query = pick([(s) => s, (s) => s.toUpperCase(), (s) => ` ${s} `, (s) => s.normalize('NFD'), (s) => `${pick(SPACES)}${s}`])(pick(NAMES) + pick(tails)());
    out.push({ name: 'verseSearchPlanView', pure: true, args: { query, available: pick(books) } });
  }
  for (const query of ['', ' ', ':', '-', '1', '1 2', ': 3', 'gen:', 'gen 1:2-3:4-5', 'joh 3:16 extra', 'xyz 1', 'x 1', 'g 1', '1 j 1', '\u{feff}joh 3', 'joh\u{85}3:16', 5, null])
    for (const available of [CODES, undefined, 'GEN']) out.push({ name: 'verseSearchPlanView', pure: true, args: { query, available } });
  for (const args of GARBAGE) out.push({ name: 'verseSearchPlanView', pure: true, args });

  const odd = ['XYZ', 'jhn', 'Gen', '', 'ÖÖÖ', 'AAA', 'aaa', 'Z', '😀', 'ß', 'ﬀ', 5, null];
  for (const code of [...CODES, ...odd]) out.push({ name: 'bibleBookNamesView', pure: true, args: { codes: [code] } });
  for (let i = 0; i < 200; i++) out.push({ name: 'bibleBookNamesView', pure: true, args: { codes: Array.from({ length: Math.floor(random() * 12) }, () => pick([...CODES, ...odd])) } });
  for (const codes of [undefined, null, 'GEN', {}]) out.push({ name: 'bibleBookNamesView', pure: true, args: codes === undefined ? {} : { codes } });
  for (const args of GARBAGE) out.push({ name: 'bibleBookNamesView', pure: true, args });
  return out;
}

function presentingCases(db, { pick, random }) {
  const out = [];
  const orders = db.prepare('SELECT id FROM presentations').all().map(({ id }) =>
    db.prepare('SELECT id, type FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id').all(id).map((r) => [r.id, r.type === 'header' ? 0 : Math.floor(random() * 6)]));
  orders.push([], [['a', 3]], [['a', 0], ['b', -2], ['c', 1]], [['a', 2], ['a', 2]]);
  const KEYS = [{ type: 'step', delta: 1 }, { type: 'step', delta: -1 }, { type: 'step', delta: 3 }, { type: 'step', delta: 0 }, { type: 'step' }, { type: 'pick', delta: 1 }, { type: 'pick', delta: -1 }, { type: 'pick', delta: 1.5 }, { type: 'enter' }, { type: 'black' }, { type: 'escape' }];
  const at = (order) => {
    const slides = order.flatMap(([itemId, n]) => Array.from({ length: Math.max(0, n) }, (_, partIndex) => ({ itemId, partIndex })));
    return slides.length && random() < 0.85 ? pick(slides) : pick([{ itemId: null, partIndex: 0 }, { itemId: 'gone', partIndex: 0 }, { itemId: order[0]?.[0] ?? 'a', partIndex: 99 }]);
  };
  for (let n = 0; n < 2500; n++) {
    const order = pick(orders);
    const shown = { ...at(order), black: random() < 0.2 };
    const state = { presenting: random() < 0.6, shown, picked: random() < 0.5 ? null : at(order) };
    out.push({ name: 'presentingKeyView', pure: true, args: { order, state, key: pick(KEYS) } });
    out.push({ name: 'slideMarksView', pure: true, args: { order, shown: random() < 0.9 ? shown : { itemId: shown.itemId, partIndex: shown.partIndex } } });
  }
  const order = orders[0];
  const state = { presenting: true, shown: { itemId: order[0][0], partIndex: 0, black: false }, picked: null };
  const variants = [
    {}, { order: null }, { order: 'x' }, { order: [['a']] }, { order: [[5, 1]] }, { order: [['a', 1.5]] }, { order: [{ 0: 'a', 1: 1 }] }, { state: null }, { state: 5 }, { state: { ...state, presenting: 1 } },
    { state: { ...state, shown: null } }, { state: { ...state, shown: { partIndex: 0, black: false } } }, { state: { ...state, shown: { itemId: 5, partIndex: 0, black: false } } }, { state: { ...state, shown: { itemId: 'a', partIndex: 0 } } },
    { state: { ...state, shown: { itemId: 'a', partIndex: 1.5, black: false } } }, { state: { ...state, picked: 5 } }, { state: { ...state, picked: { itemId: order[0][0] } } }, { state: { ...state, picked: { partIndex: 0 } } }, { state: { ...state, picked: { itemId: null, partIndex: 0 } } },
    { key: null }, { key: {} }, { key: { type: 'jump' } }, { key: { type: 5 } }, { key: { type: 'step', delta: '1' } }, { key: { type: 'step', delta: 2 ** 60 } }, { key: { type: 'pick', delta: -(2 ** 60) } }, { state: { ...state, presenting: false }, key: { type: 'enter' } },
  ];
  for (const v of variants) out.push({ name: 'presentingKeyView', pure: true, args: { order, state, key: { type: 'step', delta: 1 }, ...v } });
  for (const v of [{}, { order: 5 }, { shown: null }, { shown: 5 }, { shown: { itemId: order[0][0] } }, { shown: { itemId: order[0][0], partIndex: 0, black: 'yes' } }, { shown: { itemId: 5, partIndex: 0 } }, { shown: { partIndex: 0 } }])
    out.push({ name: 'slideMarksView', pure: true, args: { order, shown: { itemId: order[0][0], partIndex: 0 }, ...v } });
  for (const args of GARBAGE) for (const name of ['presentingKeyView', 'slideMarksView']) out.push({ name, pure: true, args });
  return out;
}

function themeCases(db) {
  const out = [];
  const ids = [null, undefined, 'light', 'classic', 'own-1', 'own-bad', 'gone', '', 'x'.repeat(100), 'x'.repeat(101), '😀'.repeat(100), 5, true, {}, []];
  const view = (id, on) => out.push({ name: 'themeView', args: id === undefined ? {} : { id }, db: on });
  for (const id of ids) view(id);
  for (const args of GARBAGE) out.push({ name: 'themeView', args });
  // Own themes as they may be stored, and organisation defaults of every kind.
  const def = JSON.parse(db.prepare("SELECT definition FROM themes WHERE id = 'own-1'").get().definition);
  const variants = [
    def, { ...def, media: { ...def.media, image: { kind: 'builtIn', asset: 'a/b' } } }, { ...def, media: { ...def.media, image: { kind: 'builtIn', asset: 'A/b' } } }, { ...def, media: { ...def.media, image: { kind: 'picture', full: 'a'.repeat(64), thumb: 'b'.repeat(64), x: 1 } } },
    { ...def, media: { ...def.media, image: { kind: 'picture', full: 'a'.repeat(63), thumb: 'b'.repeat(64) } } }, { ...def, media: { ...def.media, scrim: 101 } }, { ...def, media: { ...def.media, fit: 'fill' } }, { ...def, media: { ...def.media, color: 'red; x' } },
    { ...def, song: { ...def.song, main: { ...def.song.main, lineHeight: 0.79 } } }, { ...def, song: { ...def.song, main: { ...def.song.main, lineHeight: 2.75 } } }, { ...def, song: { ...def.song, main: { ...def.song.main, fontSize: 75.5 } } }, { ...def, song: { ...def.song, main: { ...def.song.main, fontFamily: 'Arial"' } } },
    { ...def, song: { ...def.song, main: { ...def.song.main, area: { x: 0, y: 0, w: 39, h: 40 } } } }, { ...def, bible: { ...def.bible, credits: { ...def.bible.credits, shadow: 1 } } }, { ...def, bible: { ...def.bible, credits: { ...def.bible.credits, valign: 'center' } } }, { ...def, bible: 5 }, { ...def, media: undefined }, [def], 'x',
  ];
  const statements = variants.map((d, i) => `INSERT INTO themes (id, name, definition, sort, updated_at) VALUES ('t${i}', 'Tema ${i}', '${JSON.stringify(d).replaceAll("'", "''")}', ${[0, 1.5, -2, 3, "'x'"][i % 5]}, 0)`);
  statements.push("INSERT INTO themes (id, name, definition, sort, updated_at) VALUES ('raw', 5, 'not json', 7, 0), ('n', 'N', '{\"song\":1e400}', 1, 0), (7, 'Num', 'x', 0, 0)");
  for (const fallback of [null, 'light', 't0', 'gone', '', 'raw']) {
    const on = emptyDb(fallback === null ? statements : [...statements, `INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', '${fallback}')`]);
    for (const id of [null, 'classic', 'raw', 'n', '7', ...variants.map((_, i) => `t${i}`)]) view(id, on);
  }
  return out;
}

function highlightCases(db, { pick, random }) {
  const out = [];
  const MADE_UP = ['Härlig är jorden', 'HÄRLIG ÄR JORDEN', 'Härlig är jorden'.normalize('NFD'), 'Café crème – O store Gud', 'Ps 23:1–4, v. 2', 'Jesus 𝄞 älskar', 'ÅÄÖ åäö éè', 'ab-cd_ef (gh) "ij"', '', '1:a Mosebok 3:15', 'İstanbul ß ẞ ﬀ', 'ΣΊΣΥΦΟΣ σοφός', 'Ⓐbc ⓐbc', 'x\u{345}y', 'क्षि हिन्दी', '①② ¾ Ⅻ', 'a\u{feff}b \u{85}c', '😀smile 😀', 'tab\there\nline'];
  const texts = [...MADE_UP, ...db.prepare('SELECT name FROM songs').all().map((r) => r.name), ...db.prepare('SELECT content FROM song_parts LIMIT 40').all().flatMap((r) => String(r.content).split('\n'))];
  for (let i = 0; i < 2500; i++) {
    const text = pick(texts);
    const ws = text.split(/\s+/).filter(Boolean);
    const word = pick(ws.length ? ws : ['x']);
    const part = () => word.slice(Math.floor(random() * 2), 1 + Math.floor(random() * word.length));
    const query = pick([
      () => part(),
      () => part().toUpperCase(),
      () => part().normalize('NFD').replace(/\p{M}/gu, ''),
      () => `${part()} ${pick(ws.length ? ws : ['y']).slice(0, 2)}`,
      () => `  ${part()}  `,
      () => pick(['a', 'ä', 'e', 'é', '𝄞', 'jo', 'ÖR', '1', ':', '', 'ss', 'σ', 'ⓐ', 'b', '\u{85}c', 'i̇']),
    ])();
    // A lone surrogate does not travel to the Rust core (its JSON refuses it): a query cut inside a pair is left out.
    if (!/\p{Surrogate}/u.test(query)) out.push({ name: 'highlightView', pure: true, args: { text, query } });
  }
  for (const args of [{}, { text: 5, query: 'a' }, { text: 'abc', query: null }, ...GARBAGE]) out.push({ name: 'highlightView', pure: true, args });
  return out;
}

export function cases(db, { random }) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const tools = { pick, random };
  return [...itemSlidesCases(db, tools), ...bibleCases(db, tools), ...referenceCases(tools), ...presentingCases(db, tools), ...themeCases(db), ...highlightCases(db, tools)];
}
