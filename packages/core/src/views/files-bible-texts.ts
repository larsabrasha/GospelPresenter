// What a device does with Bible texts (docs/bibles-and-themes.md, "Bibles"; ADR 0008, ported back from
// crates/gp-core/src/bible_texts.rs): which texts to fetch and drop, a fetched text checked against its hash and the
// statements that keep it, a kept text's JSON as hashed, and the texts to upload before a push. A text is a
// translation's verses as one immutable JSON named by its SHA-256, kept a book a row (`bible_texts`) with a marker that
// it is whole (`bible_blobs`); only the `bibles` row syncs. The shell moves the bytes; the core says which texts.
import { utf8Encode } from '../platform.ts';
import { sha256 } from '../sha256.ts';
import type { RunSql } from './sql.ts';
import { argsOf, asF64, field, intOf, jsString, plain, s, serdeParse, str } from './files-json.ts';

/** `BIBLE_LIMITS`: verses in a text (and a book), a verse's length in code points, books in a text. */
const MAX_VERSES = 60_000;
const MAX_VERSE_LENGTH = 10_000;
const MAX_BOOKS = 200;

/** The translations whose texts this device keeps: every one on a desktop host, else those chosen (`kept_bibles`). */
const kept = (a: Record<string, unknown>) =>
  a.keeping === 'chosen' ? 'SELECT content_hash FROM bibles WHERE id IN (SELECT id FROM kept_bibles)' : 'SELECT content_hash FROM bibles';

/** The queued imports, each with its place in the queue, its id, its arguments and the text it names. */
async function imports(sql: RunSql) {
  const rows = await sql('SELECT id, name, args FROM _mutation ORDER BY id', []);
  return rows.flatMap((r, index) => {
    if (s(r[1]) !== 'importBible') return [];
    const args = serdeParse(s(r[2]));
    return [{ index, id: Number(intOf(r[0])), args, hash: jsString(field(args, 'contentHash')) }];
  });
}

/**
 * `bibleTextPlanView` {keeping}: the texts to fetch (a kept translation names them and they are not here) and to drop
 * (here and no kept translation names them, never one a queued import names).
 */
export async function bibleTextPlanView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const fetch = (await sql(`SELECT DISTINCT content_hash AS hash FROM (${kept(a)}) WHERE content_hash NOT IN (SELECT hash FROM bible_blobs)`, [])).map((r) => s(r[0]));
  const queued = new Set((await imports(sql)).map((i) => i.hash));
  const drop = (await sql(`SELECT hash FROM bible_blobs WHERE hash NOT IN (${kept(a)})`, [])).map((r) => s(r[0])).filter((h) => !queued.has(h));
  return { fetch, drop };
}

/** A whole number from 0 to 999. */
const small = (v: unknown) => {
  const f = asF64(v);
  return f !== undefined && Number.isInteger(f) && f >= 0 && f <= 999 ? f + 0 : null;
};

/** `bibleBookTextSchema` of a book: its code and its verses' chunk, the JSON `bookChunk` writes, and how many. */
function book(b: unknown): { code: string; chunk: string; n: number } | null {
  const code = field(b, 'code');
  if (typeof code !== 'string' || !/^[0-9A-Z]{3}$/.test(code)) return null;
  const verses = field(b, 'verses');
  if (!Array.isArray(verses) || !verses.length || verses.length > MAX_VERSES) return null;
  const out: [number, number, string][] = [];
  for (const v of verses) {
    if (!Array.isArray(v) || v.length !== 3) return null;
    const [c, n, t] = [small(v[0]), small(v[1]), v[2]];
    if (typeof t !== 'string' || [...t].length > MAX_VERSE_LENGTH || c === null || n === null) return null;
    out.push([c, n, t]);
  }
  return { code, chunk: JSON.stringify(out), n: verses.length };
}

/** `joinBibleText`: the canonical JSON of a text from its books' chunks. */
const join = (books: { code: string; chunk: string }[]) => `{"v":1,"books":[${books.map((b) => `{"code":${JSON.stringify(b.code)},"verses":${b.chunk}}`).join(',')}]}`;

const sha256Hex = (text: string) => [...sha256(utf8Encode(text))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A text's books as stored and its verses, if `json` reads as a text whose canonical JSON is what `hash` names. */
function readText(json: string, hash: string) {
  const text = serdeParse(json);
  if (asF64(field(text, 'v')) !== 1) return null;
  const books = field(text, 'books');
  if (!Array.isArray(books) || !books.length || books.length > MAX_BOOKS) return null;
  const out: { code: string; chunk: string }[] = [];
  let verses = 0;
  for (const b of books) {
    const read = book(b);
    if (!read || out.some((o) => o.code === read.code)) return null;
    verses += read.n;
    out.push({ code: read.code, chunk: read.chunk });
  }
  return verses > MAX_VERSES || sha256Hex(join(out)) !== hash ? null : { books: out, verses };
}

/**
 * `bibleTextStoreView` {hash, json}: the statements that keep a text fetched from the server (a row a book, then its
 * marker), or null when it does not read as a text or is not what `hash` names.
 */
export function bibleTextStoreView(args: unknown) {
  const a = argsOf(args);
  const hash = str(a.hash) ?? '';
  const read = readText(str(a.json) ?? '', hash);
  if (!read) return { store: null };
  const store: { sql: string; params: unknown[] }[] = read.books.map((b, i) => ({ sql: 'INSERT OR REPLACE INTO bible_texts (hash, book, sort, chunk) VALUES (?, ?, ?, ?)', params: [hash, b.code, i, b.chunk] }));
  store.push({ sql: 'INSERT OR REPLACE INTO bible_blobs (hash, verse_count) VALUES (?, ?)', params: [hash, read.verses] });
  return { store };
}

/** `bibleTextJsonView` {hash}: a kept text's canonical JSON, exactly as hashed, or null if this device does not have it. */
export async function bibleTextJsonView(args: unknown, sql: RunSql) {
  const hash = str(argsOf(args).hash) ?? '';
  if (!(await sql('SELECT 1 FROM bible_blobs WHERE hash = ?', [hash])).length) return { json: null };
  const books = (await sql('SELECT book, chunk FROM bible_texts WHERE hash = ? ORDER BY sort', [hash])).map((r) => ({ code: s(r[0]), chunk: s(r[1]) }));
  return { json: join(books) };
}

/**
 * `bibleUploadsView` {uploaded: [hash]}: the texts to upload before a push, each queued import with its place in the
 * queue, its id and arguments (a refused one is queued again from them) and the text it names, and whether it is
 * uploaded already.
 */
export async function bibleUploadsView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const uploaded = new Set(Array.isArray(a.uploaded) ? a.uploaded.map(jsString) : []);
  const uploads = (await imports(sql)).map((i) => ({ index: i.index, id: i.id, args: plain(i.args), hash: i.hash, uploaded: uploaded.has(i.hash) }));
  return { uploads };
}
