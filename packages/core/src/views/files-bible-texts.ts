// What a device does with Bible texts (docs/bibles-and-themes.md, "Bibles"; ADR 0008, ported back from
// crates/gp-core/src/bible_texts.rs): which texts to fetch and drop, a fetched text checked against its hash and the
// statements that keep it, a kept text's JSON as hashed, and the texts to upload before a push. A text is a
// translation's verses as one immutable JSON named by its SHA-256, kept a book a row (`bible_texts`) with a marker that
// it is whole (`bible_blobs`); only the `bibles` row syncs. The shell moves the bytes; the core says which texts.
import { BIBLE_LIMITS, bookChunk, joinBibleText, LOAD_BIBLE_TEXT_SQL, storeBibleTextSql, type BibleBookText } from '../bible.ts';
import { sha256HexSync } from '../platform.ts';
import type { RunSql } from './sql.ts';
import { strOrEmpty } from './serde.ts';
import { charsAtMost } from '../chars.ts';
import { readStoredJson } from '../stored-json.ts';
import { jsonArgs, numberOf, field, intOf, mediaPlanString, strOf } from './files-json.ts';

/** The translations whose texts this device keeps: every one on a desktop host, else those chosen (`kept_bibles`). */
const kept = (a: Record<string, unknown>) =>
  a.keeping === 'chosen' ? 'SELECT content_hash FROM bibles WHERE id IN (SELECT id FROM kept_bibles)' : 'SELECT content_hash FROM bibles';

/** The queued imports, each with its place in the queue, its id, its arguments and the text it names. */
async function imports(sql: RunSql) {
  const rows = await sql('SELECT id, name, args FROM _mutation ORDER BY id', []);
  return rows.flatMap((r, index) => {
    if (strOrEmpty(r[1]) !== 'importBible') return [];
    const args = readStoredJson(strOrEmpty(r[2])) ?? null;
    return [{ index, id: Number(intOf(r[0])), args, hash: mediaPlanString(field(args, 'contentHash')) }];
  });
}

/**
 * `bibleTextPlanView` {keeping}: the texts to fetch (a kept translation names them and they are not here) and to drop
 * (here and no kept translation names them, never one a queued import names).
 */
export async function bibleTextPlanView(args: unknown, sql: RunSql) {
  const a = jsonArgs(args);
  const fetch = (await sql(`SELECT DISTINCT content_hash AS hash FROM (${kept(a)}) WHERE content_hash NOT IN (SELECT hash FROM bible_blobs)`, [])).map((r) => strOrEmpty(r[0]));
  const queued = new Set((await imports(sql)).map((i) => i.hash));
  const drop = (await sql(`SELECT hash FROM bible_blobs WHERE hash NOT IN (${kept(a)})`, [])).map((r) => strOrEmpty(r[0])).filter((h) => !queued.has(h));
  return { fetch, drop };
}

/** A whole number from 0 to 999. */
const small = (v: unknown) => {
  const f = numberOf(v);
  return f !== undefined && Number.isInteger(f) && f >= 0 && f <= 999 ? f + 0 : null;
};

/** `bibleBookTextSchema` of a book: its code and its verses (a verse's length in code points). */
function book(b: unknown): BibleBookText | null {
  const code = field(b, 'code');
  if (typeof code !== 'string' || !/^[0-9A-Z]{3}$/.test(code)) return null;
  const verses = field(b, 'verses');
  if (!Array.isArray(verses) || !verses.length || verses.length > BIBLE_LIMITS.verses) return null;
  const out: [number, number, string][] = [];
  for (const v of verses) {
    if (!Array.isArray(v) || v.length !== 3) return null;
    const [c, n, t] = [small(v[0]), small(v[1]), v[2]];
    if (typeof t !== 'string' || !charsAtMost(t, BIBLE_LIMITS.verseLength) || c === null || n === null) return null;
    out.push([c, n, t]);
  }
  return { code, verses: out };
}

/** A text's books, if `json` reads as a text whose canonical JSON is what `hash` names. */
function readText(json: string, hash: string): BibleBookText[] | null {
  const text = readStoredJson(json);
  if (numberOf(field(text, 'v')) !== 1) return null;
  const books = field(text, 'books');
  if (!Array.isArray(books) || !books.length || books.length > BIBLE_LIMITS.books) return null;
  const out: BibleBookText[] = [];
  let verses = 0;
  for (const b of books) {
    const read = book(b);
    if (!read || out.some((o) => o.code === read.code)) return null;
    verses += read.verses.length;
    out.push(read);
  }
  return verses > BIBLE_LIMITS.verses || sha256HexSync(joinBibleText(out.map((o) => ({ code: o.code, chunk: bookChunk(o) })))) !== hash ? null : out;
}

/**
 * `bibleTextStoreView` {hash, json}: the statements that keep a text fetched from the server (a row a book, then its
 * marker, `storeBibleTextSql`), or null when it does not read as a text or is not what `hash` names.
 */
export function bibleTextStoreView(args: unknown) {
  const a = jsonArgs(args);
  const hash = strOf(a.hash) ?? '';
  const books = readText(strOf(a.json) ?? '', hash);
  return { store: books && storeBibleTextSql(hash, books) };
}

/** `bibleTextJsonView` {hash}: a kept text's canonical JSON, exactly as hashed, or null if this device does not have it. */
export async function bibleTextJsonView(args: unknown, sql: RunSql) {
  const hash = strOf(jsonArgs(args).hash) ?? '';
  if (!(await sql('SELECT 1 FROM bible_blobs WHERE hash = ?', [hash])).length) return { json: null };
  const books = (await sql(LOAD_BIBLE_TEXT_SQL, [hash])).map((r) => ({ code: strOrEmpty(r[0]), chunk: strOrEmpty(r[1]) }));
  return { json: joinBibleText(books) };
}

/**
 * `bibleUploadsView` {uploaded: [hash]}: the texts to upload before a push, each queued import with its place in the
 * queue, its id and arguments (a refused one is queued again from them) and the text it names, and whether it is
 * uploaded already.
 */
export async function bibleUploadsView(args: unknown, sql: RunSql) {
  const a = jsonArgs(args);
  const uploaded = new Set(Array.isArray(a.uploaded) ? a.uploaded.map(mediaPlanString) : []);
  const uploads = (await imports(sql)).map((i) => ({ index: i.index, id: i.id, args: i.args, hash: i.hash, uploaded: uploaded.has(i.hash) }));
  return { uploads };
}
