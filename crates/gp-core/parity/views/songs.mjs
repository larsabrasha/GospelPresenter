// The songs list and its search against 2.0's (listSongs, and packages/sync's SongSearch over rankSongs and
// prepareSong at 238d481b): the library as rows, and random queries over a library of made-up songs with every kind
// of text search reads differently if it is not careful — accents composed and not, ß, İ, ligatures, letters past
// the BMP, marks that are letters, digits, and white space JavaScript and Rust count differently (NBSP, U+0085, U+FEFF).
import { DatabaseSync } from 'node:sqlite';
import { listSongs, prepareSong, rankSongs } from '../.out/web-queries.mjs';
import { migrateOrgSchemaSync } from '../.out/ts-core.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

let seed = 5;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const WORDS = ['nåd', 'Nåd', 'näd', 'kärlek', 'KÄRLEK', 'frid', 'Herre', 'herren', 'straße', 'STRASSE', 'İstanbul', 'ﬁnal', 'café', 'café',
  '𝔄men', 'då', 'da', '12', '7', 'Oͅ', 'नि', 'Ångest', 'ångra', 'Ève', 'éva', 'jesus', 'Jesus', 'Kristus', 'ljus', 'ljusets', 'tack'];
const SPACE = [' ', ' ', ' ', '  ', '\n', ' ', '\u0085', '﻿', '\t'];
const PUNCT = ['', '', ',', '.', '!', '-', '’', '('];
const words = (n) => Array.from({ length: n }, () => pick(PUNCT) + pick(WORDS) + pick(PUNCT)).map((w, k) => (k ? pick(SPACE) : '') + w).join('');

/** A library of `n` made-up songs, in its own database. */
function library(n) {
  const db = new DatabaseSync(':memory:');
  migrateOrgSchemaSync((s) => db.prepare(s).all(), (fn) => fn());
  for (let i = 0; i < n; i++) {
    db.prepare('INSERT INTO songs (id, name, author, deleted_at) VALUES (?, ?, ?, ?)').run(`s${i}`, words(1 + Math.floor(rand() * 3)), rand() < 0.3 ? null : words(2), rand() < 0.05 ? 1 : null);
    for (let k = 0; k < Math.floor(rand() * 4); k++) db.prepare('INSERT INTO song_parts (id, song_id, sort, content) VALUES (?, ?, ?, ?)').run(`s${i}p${k}`, `s${i}`, k, words(6) + '\n' + words(5));
  }
  return db;
}

/** 2.0's search (SongSearch.load and search): the library in `order`, ranked. */
function reference(db, order) {
  const songs = db.prepare('SELECT id, name, author FROM songs WHERE deleted_at IS NULL').all();
  const parts = db.prepare('SELECT p.song_id, p.content FROM song_parts p JOIN songs s ON s.id = p.song_id WHERE s.deleted_at IS NULL ORDER BY p.song_id, p.sort, p.id').all();
  const lyrics = new Map();
  for (const p of parts) (lyrics.get(p.song_id) ?? lyrics.set(p.song_id, []).get(p.song_id)).push(p.content);
  const texts = new Map(songs.map((s) => {
    const own = lyrics.get(s.id) ?? [];
    return [s.id, prepareSong({ name: s.name, author: s.author, firstPart: own[0] ?? '', lyrics: own.join('\n') })];
  }));
  return (query) => rankSongs(order, (id) => texts.get(id), query);
}

export default async function check(_, file) {
  const differ = [];
  let compared = 0;
  // The list: the library's rows, as listSongs read them (its order by name is the page's).
  const demo = fixture(file);
  const byId = (xs) => xs.toSorted((a, b) => a.id.localeCompare(b.id));
  compared++;
  // Ordered by name by the core since 2026-11-18 (collation.rs); the rows compared by id here, the order in collation.mjs.
  const [want, got] = [canon(byId(await listSongs(readDb(demo)))), canon(byId(await viewRust(demo, 'songsView', {})))];
  if (want !== got) differ.push(`songsView: TS ${want.slice(0, 300)} Rust ${got.slice(0, 300)}`);
  // The search, on a library of 400 made-up songs, in an order of the shell's.
  const db = library(400);
  const collator = new Intl.Collator('sv-SE', { sensitivity: 'base' });
  const order = db.prepare('SELECT id, name FROM songs WHERE deleted_at IS NULL').all().toSorted((a, b) => collator.compare(a.name, b.name)).map((s) => s.id);
  const search = reference(db, order);
  await viewRust(db, 'songSearchPrepare', { order });
  const texts = db.prepare('SELECT content FROM song_parts').all().map((r) => r.content);
  const queries = ['', '   ', 'zzz'];
  for (let n = 0; n < 3000; n++) {
    // Whole code points: a lone half of a surrogate pair is no text anyone types, and JSON cannot carry it to Rust.
    const text = Array.from(pick(texts));
    const at = Math.floor(rand() * text.length);
    const piece = text.slice(at, at + 1 + Math.floor(rand() * 18)).join('');
    queries.push(rand() < 0.5 ? piece : rand() < 0.5 ? words(1 + Math.floor(rand() * 2)) : Array.from(pick(WORDS)).slice(0, 1 + Math.floor(rand() * 4)).join(''));
  }
  for (const query of queries) {
    compared++;
    const [w, g] = [search(query), await viewRust(db, 'songSearchView', { query })];
    if (canon(w) !== canon(g)) differ.push(`search ${JSON.stringify(query)}: TS ${w.length} ${canon(w.slice(0, 8))} Rust ${g.length} ${canon(g.slice?.(0, 8))}`);
  }
  // The native app's add sheet (searchSongsView): the web's search over the library in the page's language's order,
  // its first 50, the order the core's own (collation.rs), the web's Intl.Collator here.
  const native = queries.filter((query, k) => k % 10 === 0);
  for (const locale of ['sv', 'en']) {
    const named = new Intl.Collator(locale, { sensitivity: 'base' });
    const inOrder = db.prepare('SELECT id, name FROM songs WHERE deleted_at IS NULL').all().toSorted((a, b) => named.compare(a.name, b.name)).map((s) => s.id);
    const web = reference(db, inOrder);
    for (const query of native) {
      compared++;
      const [w, g] = [web(query).slice(0, 50), (await viewRust(db, 'searchSongsView', { query, locale })).map((s) => s.id)];
      if (canon(w) !== canon(g)) differ.push(`searchSongsView ${locale} ${JSON.stringify(query)}: TS ${canon(w.slice(0, 8))} Rust ${canon(g.slice(0, 8))}`);
    }
  }
  return { compared, differ, notes: ['the library as rows', `${queries.length} queries over 400 made-up songs`, `${native.length} of them in the native add sheet, in Swedish and English`] };
}
