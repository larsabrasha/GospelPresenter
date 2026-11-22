// The lists' views (wave 4): the presentations page, templates, items, labels, parts, kept offline, the trash; the
// libraries (pictures, sounds, videos, slideshows, overlays); the songs, their search and the song's pages; the
// Bibles, the themes, the CCLI report; Inställningar's lists, freshNameView, libraryPageView, rulesView and
// coreInfoView. On the demo data with every id it has, and on made databases: names that order differently (å ä ö,
// case, accents, digits, emoji), columns holding what SQLite lets them hold beside their type, slideshows' pages and
// themes' definitions that read and that do not, every way, and arguments that are not what they should be.
import { emptyDb, rust } from './harness.mjs';

const LOCALES = ['sv', 'en', 'en-US', 'sv-SE', 'fr', '', 'EN', 5, null, undefined];
const GARBAGE = [undefined, null, [], 'x', 5, true];
const ROLES = ['user', 'admin', 'superAdmin', '', 'Admin', 'constructor', '__proto__', 5, null, undefined];
const HOSTS = [true, false, undefined, 'yes', 1];
const HASH = 'a'.repeat(64);

/** The views that read no arguments but their object. */
const PLAIN = ['presentationListView', 'labelsView', 'pinnedView', 'trashEntriesView', 'imagesView', 'audiosView', 'videosView', 'customSlidesView',
  'overlaysView', 'ownThemesView', 'defaultThemeIdView'];
const BY_LOCALE = ['templatesView', 'songsView', 'biblesView', 'ccliReportView'];

/** Arguments that are no id: too long (101 code points; 100 that are 200 UTF-16 units is one), empty, not a text. */
const BAD_IDS = ['', 'x'.repeat(100), 'x'.repeat(101), '😀'.repeat(100), '😀'.repeat(101), 5, null, undefined, ['a'], { id: 'a' }];

const opt = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const ids = (db, sql) => db.prepare(sql).all().map((r) => Object.values(r)[0]);

/** Every view on `db`, every way its arguments go: what each database is compared on. */
function everyView(db, random, extraIds = []) {
  const out = [];
  const on = (name, args, pure = false) => out.push({ name, args, db, ...(pure ? { pure } : {}) });
  for (const name of PLAIN) for (const args of [{}, { locale: 'en', id: 'x' }]) on(name, args);
  for (const name of BY_LOCALE) for (const locale of LOCALES) on(name, opt({ locale }));
  const byId = [
    ['itemsView', 'presentationId', 'SELECT id FROM presentations'],
    ['customSlideView', 'id', 'SELECT id FROM custom_slides'],
    ['overlayRowView', 'id', 'SELECT id FROM overlays'],
    ['songView', 'id', 'SELECT id FROM songs'],
    ['songPageView', 'id', 'SELECT id FROM songs'],
    ['songHistoryView', 'id', 'SELECT id FROM songs'],
    ['songPresentationsView', 'songId', 'SELECT id FROM songs'],
    ['ownThemeView', 'id', 'SELECT id FROM themes'],
  ];
  for (const [name, key, sql] of byId) for (const id of [...ids(db, sql), 'no-such', 'classic', ...extraIds]) on(name, { [key]: id });
  const songIds = ids(db, 'SELECT id FROM songs');
  for (const name of ['songPartsView', 'songMaterialsView']) {
    for (const id of songIds) on(name, { songIds: [id] });
    on(name, { songIds: [] });
    on(name, { songIds: songIds });
    on(name, { songIds: [...songIds, ...songIds, 'no-such'] });
    for (let k = 0; k < 5; k++) on(name, { songIds: songIds.filter(() => random() < 0.4).toReversed() });
  }
  for (const role of ROLES) on('themesPageView', opt({ role }));
  return out;
}

/** Garbage arguments to every view that reads any, and its object refused. */
function badArgs(db) {
  const out = [];
  const names = [...PLAIN, ...BY_LOCALE, 'itemsView', 'customSlideView', 'overlayRowView', 'songView', 'songPageView', 'songHistoryView', 'songPresentationsView',
    'ownThemeView', 'songPartsView', 'songMaterialsView', 'songSearchPrepare', 'songSearchView', 'themesPageView'];
  const pureNames = ['settingsListView', 'settingsSearchView', 'freshNameView', 'libraryPageView', 'rulesView', 'coreInfoView'];
  for (const name of names) for (const args of GARBAGE) out.push({ name, args, db });
  for (const name of pureNames) for (const args of GARBAGE) for (const pure of [true, false]) out.push({ name, args, pure, db });
  for (const [name, key] of [['itemsView', 'presentationId'], ['customSlideView', 'id'], ['overlayRowView', 'id'], ['songView', 'id'], ['songPageView', 'id'],
    ['songHistoryView', 'id'], ['songPresentationsView', 'songId'], ['ownThemeView', 'id']])
    for (const id of BAD_IDS) out.push({ name, args: opt({ [key]: id }), db });
  for (const name of ['songPartsView', 'songMaterialsView']) for (const songIds of [undefined, null, 'song-0', 5, { 0: 'song-0' }, [5], [null], [true]]) out.push({ name, args: opt({ songIds }), db });
  for (const order of [undefined, null, 'song-0', ['song-0', 5], [null], { 0: 'a' }]) out.push({ name: 'songSearchPrepare', args: opt({ order }), db });
  return out;
}

// ------------------------------------------------------------------ made-up names and texts

const LETTERS = ['a', 'A', 'å', 'Å', 'ä', 'Ä', 'ö', 'Ö', 'o', 'O', 'e', 'é', 'É', 'è', 'z', 'Z', 'ü', 'y', 'v', 'w', 'W', 'aa', 'ae', 'æ', 'ø', 'ß', 'ss', 'İ', 'ı',
  'Σ', 'ς', 'ﬁ', '1', '2', '10', '9', '0', '😀', '🎵', '👍🏽', '𝔄', ' ', ' ', '\u00a0', '-', "'", '.', '!', '#', '_', 'ŉ', 'ǅ', 'ﾟ', 'の', '中', 'а', 'Я'];
const WORDS = ['nåd', 'Nåd', 'näd', 'kärlek', 'KÄRLEK', 'frid', 'Herre', 'herren', 'straße', 'STRASSE', 'İstanbul', 'ﬁnal', 'café', 'café', '𝔄men', 'då', 'da',
  '12', '7', 'Ångest', 'ångra', 'Ève', 'éva', 'jesus', 'Jesus', 'ljus', 'ljusets', 'tack', 'Ödmjuk', 'öppna', 'Amen', 'amen', 'ÄRA', 'ära', '10 000', 'Ωσαννά'];
const SPACES = [' ', ' ', ' ', '  ', '\n', '\u00a0', '\u0085', '\ufeff', '\t'];

function made(random) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const name = () => (random() < 0.5 ? Array.from({ length: 1 + Math.floor(random() * 6) }, () => pick(LETTERS)).join('') : Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(WORDS)).join(pick(SPACES)));
  const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(pick(SPACES));
  return { pick, name, words };
}

/** A library of `n` songs with names that order differently, in its own database, with templates, Bibles and CCLI entries named so too. */
function namesDb(random, n) {
  const { pick, name, words } = made(random);
  const db = emptyDb();
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  for (let i = 0; i < n; i++) {
    run('INSERT INTO songs (id, name, author, deleted_at) VALUES (?, ?, ?, ?)', `s${i}`, random() < 0.05 ? pick(['', ' ', 'Amen']) : name(), random() < 0.3 ? null : words(2), random() < 0.05 ? 1 : null);
    for (let k = 0; k < Math.floor(random() * 4); k++) run('INSERT INTO song_parts (id, song_id, sort, content) VALUES (?, ?, ?, ?)', `s${i}p${k}`, `s${i}`, k, `${words(6)}\n${words(5)}`);
  }
  for (let i = 0; i < 60; i++)
    run('INSERT INTO presentations (id, name, is_template, updated_at, event_date, deleted_at) VALUES (?, ?, ?, ?, ?, ?)', pick(['t', 'T', 'å', 'x']) + i, name(), random() < 0.7 ? 1 : 0,
      pick([null, 10, 20, 20, 30, 1.5, 'later', '20']), pick([null, '2026-11-01', '2026-11-02', '2026-11-01']), random() < 0.1 ? 5 : null);
  for (let i = 0; i < 40; i++) run('INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) VALUES (?, ?, ?, ?, ?, ?)', pick(['b', 'B', 'ä']) + i, name(), name(), pick([null, 'sv']), i, `h${i % 5}`);
  for (let i = 0; i < 80; i++)
    run('INSERT INTO ccli_entries (id, song_id, song_name, ccli, presentation_id, presentation_name, date, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', `c${i}`, `s${i % 7}`, name(), '1',
      pick(['p1', 'P1', 'p2', 'å']), pick(['Gudstjänst', 'gudstjänst', 'Ära', 'ära', 'Öppet', 'Zebra', '']), pick(['2026-11-01', '2026-11-02', '2026-10-30', '2026-11-01 ', 'idag']), random() < 0.5 ? null : 3);
  run("INSERT INTO bible_blobs (hash, verse_count) VALUES ('h1', 1)");
  run("INSERT INTO kept_bibles (id, kept_at) VALUES ('b1', 1), ('ä2', 2)");
  return db;
}

/** Searches on `db`'s library: prepared in the shell's order (by name in a language), part of it, again, and queries from its texts. */
function searches(db, random) {
  const { pick, words } = made(random);
  const out = [];
  const live = db.prepare('SELECT id, name FROM songs WHERE deleted_at IS NULL').all();
  const texts = db.prepare('SELECT content FROM song_parts').all().map((r) => r.content);
  const queries = () => {
    const qs = ['', '   ', 'zzz', '\u0085', '\ufeff'];
    for (let k = 0; k < 120; k++) {
      const text = Array.from(texts.length ? pick(texts) : 'x');
      const at = Math.floor(random() * text.length);
      qs.push(random() < 0.4 ? text.slice(at, at + 1 + Math.floor(random() * 18)).join('') : random() < 0.5 ? words(1 + Math.floor(random() * 2)) : Array.from(pick(WORDS)).slice(0, 1 + Math.floor(random() * 4)).join(''));
    }
    return qs;
  };
  for (const locale of ['sv', 'en']) {
    const named = new Intl.Collator(locale, { sensitivity: 'base' });
    const order = live.toSorted((a, b) => named.compare(a.name, b.name)).map((s) => s.id);
    out.push({ name: 'songSearchPrepare', args: { order }, db });
    for (const query of queries()) out.push({ name: 'songSearchView', args: { query }, db });
  }
  // Part of the library, with ids it does not have, twice over, and a deleted song's.
  const deleted = ids(db, 'SELECT id FROM songs WHERE deleted_at IS NOT NULL');
  out.push({ name: 'songSearchPrepare', args: { order: [...live.filter(() => random() < 0.5).map((s) => s.id), 'no-such', ...deleted, ...live.slice(0, 5).map((s) => s.id)] }, db });
  for (const query of queries().slice(0, 40)) out.push({ name: 'songSearchView', args: { query }, db });
  for (const query of [5, null, undefined, ['a']]) out.push({ name: 'songSearchView', args: opt({ query }), db });
  out.push({ name: 'songSearchPrepare', args: { order: [] }, db }, { name: 'songSearchView', args: { query: '' }, db }, { name: 'songSearchView', args: { query: 'a' }, db });
  return out;
}

// ------------------------------------------------------------------ columns holding what their type does not say

/** A database whose numbers are texts, texts look like numbers, and types are unknown. */
function oddDb() {
  const db = emptyDb();
  const values = [null, 0, -1, 1.5, 9007199254740991, 1e300, 'abc', ' 12 ', '0x10', '', ' ', '1e3', '+5', '.5', '5.', 'inf', 'NaN', '\u00a012', '\u008512', '\ufeff12', '1e400', '-0'];
  const run = (sql, ...p) => {
    try {
      db.prepare(sql).run(...p);
    } catch {
      // A value the column's NOT NULL refuses: not one a database can hold.
    }
  };
  values.forEach((v, i) => {
    run('INSERT INTO songs (id, name, author, year, deleted_at) VALUES (?, ?, ?, ?, ?)', `s${i}`, `Sång ${i}`, `a${i}`, v, i % 5 === 0 ? v : null);
    run('INSERT INTO song_parts (id, song_id, sort, content) VALUES (?, ?, ?, ?)', `p${i}`, `s${i % 3}`, v, `text ${i}`);
    run('INSERT INTO labels (id, text, color, sort) VALUES (?, ?, ?, ?)', `l${i}`, `L${i % 4}`, '#fff', v);
    run('INSERT INTO presentations (id, name, is_template, updated_at, deleted_at, weekday) VALUES (?, ?, ?, ?, ?, ?)', `t${i}`, `Mall ${i % 3}`, v, v, i % 4 === 0 ? v : null, v);
    run('INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES (?, ?, ?, ?, ?, ?)', `i${i}`, 't1', ['song', 'bible', 'image', 'audio', 'video', 'custom', 'header', 'other', '', 'Song'][i % 10], `x${i}`, 's1', v);
    run('INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', `img${i}`, `f${i}`, ['image/jpeg', 'image/png', 'IMAGE/JPEG'][i % 3], 'h', 'h', v, v, v, i % 3 ? null : v);
    run('INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', `v${i}`, `f${i}`,
      ['video/quicktime', 'video/mp4', 'x'][i % 3], ['hevc', 'h264', 'HEVC'][i % 3], 'h', v, v, v, v, 'h', 'h', v, i % 3 ? null : v);
    run('INSERT INTO audios (id, file_name, content_type, hash, size, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)', `a${i}`, `f${i}`, 'audio/mpeg', 'h', v, v, i % 3 ? null : v);
    run('INSERT INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)', `cs${i}`, ['b', 'B', 'å', 'a'][i % 4], '[]', v, v, i % 3 ? null : v);
    run('INSERT INTO overlays (id, title, content, sort, updated_at) VALUES (?, ?, ?, ?, ?)', `o${i}`, `O${i}`, null, v, v);
    run('INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, ?, ?)', `th${i}`, `Tema ${i}`, '{}', v, v);
    run('INSERT INTO song_materials (id, song_id, kind, title, size, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', `m${i}`, `s${i % 3}`, 'link', 't', v, v, v);
    run('INSERT INTO song_versions (id, song_id, user_id, created_at, name, data) VALUES (?, ?, ?, ?, ?, ?)', `ver${i}`, `s${i % 3}`, 'u', v, 'n', '{}');
    run('INSERT INTO bibles (id, name, abbreviation, verse_count, content_hash) VALUES (?, ?, ?, ?, ?)', `b${i}`, `B${i % 3}`, 'x', v, 'h');
    run('INSERT INTO ccli_entries (id, song_id, song_name, ccli, presentation_id, presentation_name, date, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', `c${i}`, 's', 'n', '1', 'p', 'P', '2026', v);
    run('INSERT INTO pinned_presentations (id, pinned_at) VALUES (?, ?)', `t${i}`, 1);
  });
  run("INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', 'th3'), ('ccliCollection', 'True')");
  return db;
}

// ------------------------------------------------------------------ slideshows' pages and themes' definitions

/** Pages that read, and each way one does not: what customSlideView and customSlidesView show. */
function pagesDb(random, demo) {
  const db = emptyDb();
  const element = {
    text: { id: 'e1', x: 0, y: 0, w: 100, h: 50, kind: 'text', text: 'Hej', size: 40, bold: false, italic: true, align: 'center', color: null },
    image: { id: 'e2', x: -3840, y: 3240, w: 5760, h: -2160, kind: 'image', picture: { full: HASH, thumb: HASH }, fit: 'cover' },
    rect: { id: 'e3', x: 1, y: 2, w: 3, h: 4, kind: 'rect', fill: '#ABCdef', stroke: null, strokeWidth: 0, radius: 540 },
    ellipse: { id: 'e4', x: 1.5, y: 2, w: 3, h: 4, kind: 'ellipse', fill: null, stroke: '#000000', strokeWidth: 100, radius: 0 },
    line: { id: 'e5', x: 1, y: 2, w: -3, h: -4, kind: 'line', stroke: '#123456', strokeWidth: 1 },
  };
  const page = (elements) => ({ background: '#000000', backgroundPicture: null, backgroundPage: { full: HASH, thumb: HASH }, elements });
  const good = Object.values(element);
  const pages = [
    [page(good)],
    [page([]), page(good), { ...page(good), extra: 1, background: null }],
    Array.from({ length: 100 }, () => page([])),
    Array.from({ length: 101 }, () => page([])),
    [],
    [page(Array.from({ length: 100 }, () => element.rect))],
    [page(Array.from({ length: 101 }, () => element.rect))],
    // Lengths in code points (Rust) and UTF-16 units (zod): 1500 emoji are 3000 units.
    [page([{ ...element.text, text: '😀'.repeat(1500) }])],
    [page([{ ...element.text, text: 'x'.repeat(2000) }])],
    [page([{ ...element.text, text: 'x'.repeat(2001) }])],
    [page([{ ...element.text, id: '😀'.repeat(40) }])],
    [page([{ ...element.text, id: '😀'.repeat(41) }])],
    [page([{ ...element.text, id: '' }])],
  ];
  // Each field of each element, and of the page, broken one at a time.
  const breaks = [undefined, null, 'x', 1e9, -1e9, 0.5, true, {}, [], '#12345', '#1234567', 'left', 'contain', 9];
  for (const e of good) for (const k of Object.keys(e)) for (const v of breaks) pages.push([page([{ ...e, [k]: v }])]);
  for (const k of ['background', 'backgroundPicture', 'backgroundPage', 'elements']) for (const v of breaks) pages.push([{ ...page(good), [k]: v }]);
  for (const v of [{ full: HASH }, { full: HASH, thumb: 'A'.repeat(64) }, { full: HASH, thumb: HASH, x: 1 }]) pages.push([{ ...page([]), backgroundPicture: v }]);
  const texts = pages.map((p) => JSON.stringify(p));
  const deep = (n) => '['.repeat(n) + ']'.repeat(n);
  texts.push('not json', '', '{}', 'null', '5', `[${JSON.stringify(page([]))}, ${deep(125)}]`, `[${JSON.stringify(page([]))}, ${deep(126)}]`, `[${JSON.stringify(page([]))}, ${deep(127)}]`,
    `[${JSON.stringify({ ...page([]), x: 0 }).replace('"x":0', '"x":1e400')}]`, `[${JSON.stringify({ ...page([]), x: '\\ud800' }).replace('\\\\ud800', '\\ud800')}]`, `[${JSON.stringify({ ...page([]), x: '😀' })}]`,
    `[${JSON.stringify(page([])).replace('"elements"', '"elements":5,"elements"')}]`);
  for (const r of demo.prepare('SELECT pages FROM custom_slides').all()) texts.push(r.pages);
  texts.forEach((t, i) => db.prepare('INSERT INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)').run(`cs${i}`, `S${Math.floor(random() * 9)}`, t, i, i, i % 7 ? null : 1));
  return db;
}

/** Themes whose definitions read and each way one does not, and every kind of default. */
function themesDbs(demo) {
  const def = JSON.parse(demo.prepare("SELECT definition FROM themes WHERE id = 'own-1'").get().definition);
  const defs = [def, { ...def, extra: 1 }];
  const breaks = [undefined, null, 'x', 1e9, -1, 0.5, true, {}, [], 'rgb(1, 2, 3)', '#ff\u00a0', 'Arial, sans-serif', 'Ärial', 'cover', 'left', 'top', 40, 300];
  for (const kind of ['song', 'bible'])
    for (const part of ['main', 'credits']) for (const k of Object.keys(def[kind][part])) for (const v of breaks) defs.push({ ...def, [kind]: { ...def[kind], [part]: { ...def[kind][part], [k]: v } } });
  for (const k of ['color', 'image', 'fit', 'scrim']) for (const v of [...breaks, { kind: 'builtIn', asset: 'a-1/b2' }, { kind: 'builtIn', asset: 'A/b' }, { kind: 'builtIn', asset: 'a/b/c' }, { kind: 'picture', full: HASH, thumb: HASH }, { kind: 'picture', full: HASH }])
    defs.push({ ...def, media: { ...def.media, [k]: v } });
  for (const k of ['x', 'y', 'w', 'h']) for (const v of [-1, 0, 39, 40, 1040, 1880, 1920, 1080, 2000, 1.5]) defs.push({ ...def, song: { ...def.song, main: { ...def.song.main, area: { ...def.song.main.area, [k]: v } } } });
  const texts = [...defs.map((d) => JSON.stringify(d)), 'not json', '', 'null', JSON.stringify(def).replace('"media"', '"x":1e400,"media"')];
  const dbs = [];
  for (const chosen of [null, 'th0', 'th1', 'light', 'classic', 'gone', '', 'th-last']) {
    const db = emptyDb();
    texts.forEach((t, i) => db.prepare('INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, ?, ?)').run(i === texts.length - 1 ? 'th-last' : `th${i}`, `T${i % 4}`, t, (i * 7) % 5, i));
    db.prepare("INSERT INTO songs (id, name) VALUES ('s1', 'Sång')").run();
    if (chosen !== null) db.prepare("INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', ?)").run(chosen);
    dbs.push(db);
  }
  return dbs;
}

// ------------------------------------------------------------------ the views that read only their arguments

function pureCases(random, db) {
  const out = [];
  const { pick, name: madeName } = made(random);
  const on = (view, args) => out.push({ name: view, args, pure: true, db });
  for (const role of ROLES) for (const host of HOSTS) on('settingsListView', opt({ role, host }));
  const keys = rust.pure('settingsSearchKeysView', {});
  const VOCAB = ['Sånger', 'sång', 'Bibel', 'bilder', 'Ljud', 'video', 'Bildspel', 'Överlägg', 'Etiketter', 'Teman', 'CCLI', 'Användare', 'Enheter', 'Papperskorg', 'Om', 'språk', 'tema',
    'Lagring', 'Inloggningar', 'Felrapporter', 'Ä', 'ö', 'SONGS', 'İ', 'straße'];
  const texts = Object.fromEntries(keys.map((k) => [k, Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(VOCAB)).join(pick([', ', ' ', ',']))]));
  const queries = ['', ' ', 'sång', 'SÅNG', 'sån ger', 'bild', 'e', 'om', 'ö', 'tema språk', 'x', ' \u0085 ', '\u00a0bild\u00a0', ',', 'i̇', 'ss', ...VOCAB.map((v) => v.slice(0, 3))];
  for (const role of ['user', 'admin', 'superAdmin', 'x']) for (const host of [true, false]) for (const query of queries) on('settingsSearchView', { role, host, query, texts });
  for (const args of [{ role: 'admin', query: 'sång' }, { role: 'admin', query: 'sång', texts: 5 }, { role: 'admin', query: 'sång', texts: { 'nav.songs': 5 } }, { role: 'admin', query: 5, texts }, { query: 'sång', texts }])
    on('settingsSearchView', args);
  const KINDS = ['songs', 'bibles', 'images', 'audios', 'videos', 'customSlides', 'overlays', 'labels', 'themes', 'trash', 'users', 'devices', 'orgs', 'Songs', '', 'x', 5, null, undefined];
  for (const kind of KINDS) for (const role of ROLES) for (const host of HOSTS) on('libraryPageView', opt({ kind, role, host }));
  const bases = ['Ny sång', 'ny sång', 'Namnlös', '', ' ', 'Σ', 'ΑΣ', 'İ', 'x 2'];
  for (const base of bases)
    for (let k = 0; k < 12; k++) {
      const taken = Array.from({ length: Math.floor(random() * 8) }, () =>
        pick([base, base.toUpperCase(), ` ${base} `, `\u0085${base}`, `\ufeff${base}`, `${base} 2`, `${base} 3`, `${base.toLowerCase()} 2 `, madeName(), 5, null]));
      on('freshNameView', { base, taken });
    }
  for (const args of [{ base: 'x' }, { base: 'x', taken: 'x' }, { base: 5, taken: [] }, { taken: [] }, { base: 'ΑΣ', taken: ['ας'] }, { base: 'ΑΣ', taken: ['ασ'] }]) on('freshNameView', args);
  for (const args of [{}, { x: 1 }]) for (const view of ['rulesView', 'coreInfoView']) on(view, args);
  return out;
}

export function cases(db, { random }) {
  const out = [];
  // Before any library is prepared: refused, by both.
  out.push({ name: 'songSearchView', args: { query: '' }, db }, { name: 'songSearchView', args: { query: 'nåd' }, db });
  out.push(...everyView(db, random), ...badArgs(db), ...searches(db, random));
  for (const n of [0, 1, 300]) {
    const named = namesDb(random, n);
    out.push(...everyView(named, random), ...searches(named, random));
  }
  const odd = oddDb();
  out.push(...everyView(odd, random), ...searches(odd, random));
  const pages = pagesDb(random, db);
  out.push(...everyView(pages, random));
  for (const themes of themesDbs(db)) out.push(...everyView(themes, random));
  out.push(...pureCases(random, db));
  return out;
}
