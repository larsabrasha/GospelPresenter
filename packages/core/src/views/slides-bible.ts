// The Bible tab's views (ADR 0008; ported back from crates/gp-core/src/bible.rs, bible_books.rs and bible_view.rs): a
// passage's preview as adding it freezes it, a reference read as a plan of verses, the books' names, and a stored
// text's books, chapters, verses and passages.
import { canonIndex, englishBookName, isOldTestament, resolveBook, swedishBookName } from '../bible-books.ts';
import { bibleLabel, bibleTitle, splitBibleSlides, type Verse } from '../bible.ts';
import { bibleItemSlides, type ItemShown } from './slides-items.ts';
import type { RunSql } from './sql.ts';
import { argsObj, asI64, asStr, byCodePoint, charsAtMost, hasFraction, intIn, invalidArgs, isObj, parseJson, RUST_SPACE_RUN, rustTrim } from './serde.ts';

// ------------------------------------------------------------------ a passage's preview (BIBLE-R12, R13)

/** `verseArg`: book code, chapter and verse 0–999, the text at most 10 000. */
function verse(v: unknown): Verse {
  if (!isObj(v) || typeof v.b !== 'string' || !/^[0-9A-Z]{3}$/.test(v.b) || typeof v.t !== 'string' || !charsAtMost(v.t, 10_000)) throw invalidArgs();
  return { b: v.b, c: intIn(v, 'c', 0, 999), v: intIn(v, 'v', 0, 999), t: v.t };
}

/**
 * `bibleSlidesView` {translation, verses}: what an item of these verses would show, as `addBibleToPresentation` freezes
 * it (title and content, read back as an item's), for the Bible tab's preview: its title, label and slides.
 */
export function bibleSlidesView(args: unknown): ItemShown & { title: string; label: string } {
  const a = argsObj(args);
  const translation = asStr(a.translation) ?? '';
  if (!Array.isArray(a.verses)) throw invalidArgs();
  const verses = (a.verses as unknown[]).map(verse);
  const title = bibleTitle(verses).slice(0, 200);
  const content = JSON.stringify({ translation, slides: splitBibleSlides(verses) });
  return { ...bibleItemSlides({ kind: 'bible', title, sourceId: '', arrangementId: null, content }), title, label: bibleLabel(verses) };
}

// ------------------------------------------------------------------ references (BIBLE-R11)

/** The end of a chapter or a book. */
const END = Number.MAX_SAFE_INTEGER;

/** `resolveBook` after Rust's trim: a name with U+FEFF in it matches no alias there. */
function resolve(input: string): string | null {
  const q = rustTrim(input.normalize('NFC'));
  return q.includes(String.fromCharCode(0xfeff)) ? null : resolveBook(q);
}

/** `normaliseReference`: NFC, one space between words, no spaces around ":" and "-" (BIBLE-R11 step 1). */
function normalise(query: string): string {
  const words = query.normalize('NFC').split(RUST_SPACE_RUN).filter(Boolean);
  let out = '';
  for (const c of words.join(' ')) {
    if ((c === ':' || c === '-') && out.endsWith(' ')) out = out.slice(0, -1);
    out += c;
  }
  return out.replaceAll(': ', ':').replaceAll('- ', '-');
}

/** A run of ASCII digits at the start of `s` as an i64, and its length; none where there is none or it overflows. */
function digits(s: string): [number, number] | null {
  const n = /^[0-9]*/.exec(s)![0];
  return n && BigInt(n) < 2n ** 63n ? [Number(n), n.length] : null;
}

/** `B C[:V][-N[:M]][-|:]` after the book's space: the numbers, or none where the rest does not read so. */
function numbers(rest: string): [c: number, v: number | null, to: number | null, toV: number | null] | null {
  const first = digits(rest);
  if (!first) return null;
  let i = first[1];
  let [v, to, toV]: [number | null, number | null, number | null] = [null, null, null];
  const after = (mark: string): [number, number] | null => (rest.startsWith(mark, i) ? digits(rest.slice(i + 1)) : null);
  const atVerse = after(':');
  if (atVerse) [v, i] = [atVerse[0], i + 1 + atVerse[1]];
  const end = after('-');
  if (end) {
    [to, i] = [end[0], i + 1 + end[1]];
    const endVerse = after(':');
    if (endVerse) [toV, i] = [endVerse[0], i + 1 + endVerse[1]];
  }
  const tail = rest.slice(i);
  return tail === '' || tail === '-' || tail === ':' ? [first[0], v, to, toV] : null;
}

/**
 * `planVerseSearch`: what a reference selects among the books `available` (BIBLE-R11): the books' codes and the first
 * and last chapter and verse, or null. A book that resolves but is not there selects nothing; one that does not
 * resolve looks in every book whose code starts with it.
 */
function plan(query: string, available: string[]): { codes: string[]; from: number[]; to: number[] } | null {
  const q = normalise(query);
  // The book is all before the last space whose rest reads as numbers (the regex's greedy `(.+)\s+`).
  let split: [string, NonNullable<ReturnType<typeof numbers>>] | null = null;
  for (let i = q.lastIndexOf(' '); i >= 0 && !split; i = i ? q.lastIndexOf(' ', i - 1) : -1) {
    const n = numbers(q.slice(i + 1));
    if (n) split = [q.slice(0, i), n];
  }
  if (!split || !split[0]) {
    if (!q || !/^[a-zA-Z0-9åäöÅÄÖ: ]+$/.test(q)) return null;
    const code = resolve(q);
    return code !== null && available.includes(code) ? { codes: [code], from: [0, 0], to: [END, END] } : null;
  }
  const name = rustTrim(split[0]);
  const [c, v, to, toV] = split[1];
  const code = resolve(name);
  const codes = code !== null ? available.filter((x) => x === code) : available.filter((x) => x.toUpperCase().startsWith(name.toUpperCase()));
  if (!codes.length) return null;
  const end =
    to === null ? (v !== null && !q.endsWith('-') ? [c, v] : [c, END]) : toV !== null ? [to, toV] : v !== null && to >= v ? [c, to] : [to, END];
  return { codes, from: [c, v ?? 0], to: end };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** `verseSearchPlanView` {query, available}: the plan of a reference, or null (reads no database). */
export function verseSearchPlanView(args: unknown): ReturnType<typeof plan> {
  const a = argsObj(args);
  return plan(asStr(a.query) ?? '', strings(a.available));
}

/**
 * `bibleBookNamesView` {codes}: each book's Swedish and English name and its testament, in canonical order (BIBLE-R9,
 * R10), codes outside the 66 after, by code (reads no database).
 */
export function bibleBookNamesView(args: unknown): { code: string; sv: string; en: string; oldTestament: boolean }[] {
  const order = (c: string) => canonIndex(c) ?? Infinity;
  return strings(argsObj(args).codes)
    .toSorted((x, y) => (order(x) === order(y) ? byCodePoint(x, y) : order(x) - order(y)))
    .map((code) => ({ code, sv: swedishBookName(code), en: englishBookName(code), oldTestament: isOldTestament(code) }));
}

// ------------------------------------------------------------------ a stored text (`bible_texts`, a row a book)

type StoredVerse = [c: number, v: number, t: string];

/** A book's verses as stored, `[[chapter, verse, text], …]`, read as serde reads them; none where they do not read. */
async function versesOf(sql: RunSql, hash: string, book: string): Promise<StoredVerse[]> {
  const chunk = asStr((await sql('SELECT chunk FROM bible_texts WHERE hash = ? AND book = ?', [hash, book]))[0]?.[0]);
  const read = chunk === null ? undefined : parseJson(chunk);
  const ok = (x: unknown) => Array.isArray(x) && x.length === 3 && asI64(x[0]) !== null && asI64(x[1]) !== null && typeof x[2] === 'string';
  return Array.isArray(read) && read.every(ok) && !hasFraction(chunk!) ? (read as StoredVerse[]) : [];
}

/** A `[chapter, verse]` of a passage's bounds. */
function point(v: unknown): [number, number] {
  const [c, n] = Array.isArray(v) && v.length === 2 ? [asI64(v[0]), asI64(v[1])] : [null, null];
  if (c === null || n === null) throw invalidArgs();
  return [c, n];
}

const notBefore = (c: number, v: number, p: [number, number]) => c > p[0] || (c === p[0] && v >= p[1]);
const notAfter = (c: number, v: number, p: [number, number]) => c < p[0] || (c === p[0] && v <= p[1]);

/**
 * `bibleView` {hash, book?, chapter?, passage?: {books, from, to}}: null when this database does not have the text;
 * else its books' codes in stored order, with `book` its chapters, with `chapter` that chapter's verses
 * (`[chapter, verse, text]`), and with `passage` the verses from `from` to `to` inclusive (`[chapter, verse]`) in each
 * of `books`, in stored order, as `{b, c, v, t}`.
 */
export async function bibleView(args: unknown, sql: RunSql): Promise<Record<string, unknown> | null> {
  const a = argsObj(args);
  const hash = asStr(a.hash);
  if (hash === null) throw invalidArgs();
  const books = (await sql('SELECT book FROM bible_texts WHERE hash = ? ORDER BY sort', [hash])).map((r) => asStr(r[0]) ?? '');
  if (!books.length) return null;
  const out: Record<string, unknown> = { books };
  const book = asStr(a.book);
  if (book !== null) {
    const verses = await versesOf(sql, hash, book);
    out.chapters = [...new Set(verses.map(([c]) => c))];
    const chapter = asI64(a.chapter);
    if (chapter !== null) out.verses = verses.filter(([c]) => c === chapter);
  }
  const p = a.passage;
  if (p !== undefined && p !== null) {
    const wanted = isObj(p) && Array.isArray(p.books) ? strings(p.books) : null;
    if (wanted === null) throw invalidArgs();
    const [from, to] = [point(isObj(p) ? p.from : null), point(isObj(p) ? p.to : null)];
    const passage: Verse[] = [];
    for (const b of books.filter((x) => wanted.includes(x)))
      for (const [c, v, t] of await versesOf(sql, hash, b)) if (notBefore(c, v, from) && notAfter(c, v, to)) passage.push({ b, c, v, t });
    out.passage = passage;
  }
  return out;
}
