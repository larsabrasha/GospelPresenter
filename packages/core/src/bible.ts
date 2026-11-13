import { z } from 'zod';
import { compareBooks, resolveBook, swedishBookName } from './bible-books.ts';
import { sha256Hex } from './platform.ts';

// Bible text (spec 05 "Bibles"): references, the verses they select, and how
// a passage becomes slides and a title. Pure functions, used by the add-item
// picker, the mutators and the tests.

/** One verse: book code (USX), chapter, verse and text. */
export interface Verse {
  b: string;
  c: number;
  v: number;
  t: string;
}

/** A book of a translation: its verses as [chapter, verse, text], in order. */
export interface BibleBookText {
  code: string;
  verses: [number, number, string][];
}

// ------------------------------------------------------------------ references (BIBLE-R11)

type Point = [chapter: number, verse: number];

export interface VerseSearchPlan {
  /** The books to look in, among the translation's. */
  codes: string[];
  from: Point;
  to: Point;
}

const REFERENCE = /^(.+)\s+(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?[-:]?$/;
const BOOK_ONLY = /^[a-zA-ZåäöÅÄÖ0-9: ]+$/;
const END = Number.MAX_SAFE_INTEGER;

/** Trim, one space between words, and no spaces around ":" and "-" (BIBLE-R11 step 1). */
export function normaliseReference(query: string): string {
  return query.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/\s*([:-])\s*/g, '$1');
}

/**
 * What a reference query selects in a translation with the books `available`
 * (BIBLE-R11), or null when it selects nothing. A book that resolves but is
 * not in the translation selects nothing; a reference whose book does not
 * resolve looks in every book whose code starts with it.
 */
export function planVerseSearch(query: string, available: string[]): VerseSearchPlan | null {
  const q = normaliseReference(query);
  const m = REFERENCE.exec(q);
  if (!m) {
    if (!BOOK_ONLY.test(q)) return null;
    const code = resolveBook(q);
    return code && available.includes(code) ? { codes: [code], from: [0, 0], to: [END, END] } : null;
  }
  const book = m[1]!.trim();
  const fromChapter = Number(m[2]);
  const fromVerse = m[3] === undefined ? null : Number(m[3]);
  const toNum = m[4] === undefined ? null : Number(m[4]);
  const toVerse = m[5] === undefined ? null : Number(m[5]);

  const code = resolveBook(book);
  const codes = code ? available.filter((c) => c === code) : available.filter((c) => c.toUpperCase().startsWith(book.toUpperCase()));
  if (!codes.length) return null;

  const from: Point = [fromChapter, fromVerse ?? 0];
  let to: Point;
  if (toNum === null) {
    // "B C:V-" runs to the end of the chapter; "B C", "B C:" and "B C-" are the whole chapter.
    to = fromVerse !== null && !q.endsWith('-') ? [fromChapter, fromVerse] : [fromChapter, END];
  } else if (toVerse !== null) to = [toNum, toVerse];
  else if (fromVerse !== null && toNum >= fromVerse) to = [fromChapter, toNum]; // "3:15-17": verses of chapter 3
  else to = [toNum, END]; // "3:15-4" and "3-4": through the whole of chapter 4
  return { codes, from, to };
}

const atOrAfter = (c: number, v: number, p: Point) => c > p[0] || (c === p[0] && v >= p[1]);
const atOrBefore = (c: number, v: number, p: Point) => c < p[0] || (c === p[0] && v <= p[1]);

/** The verses of `book` from `from` to `to`, inclusive, in stored order. */
export function versesInRange(book: BibleBookText, from: Point, to: Point): Verse[] {
  return book.verses.filter(([c, v]) => atOrAfter(c, v, from) && atOrBefore(c, v, to)).map(([c, v, t]) => ({ b: book.code, c, v, t }));
}

/** Every verse a query selects among `books`, in the books' order; nothing for an invalid query. */
export function searchVerses(query: string, books: BibleBookText[]): Verse[] {
  const plan = planVerseSearch(
    query,
    books.map((b) => b.code),
  );
  if (!plan) return [];
  return books.filter((b) => plan.codes.includes(b.code)).flatMap((b) => versesInRange(b, plan.from, plan.to));
}

// ------------------------------------------------------------------ titles (BIBLE-R13)

/**
 * The item title, with Swedish book names: `Johannes 3:16`, `Johannes 3:16-18`,
 * `Johannes 3:16-4:2`, `Johannes 21:25 - Apostlagärningarna 1:2`.
 */
export function bibleTitle(verses: Pick<Verse, 'b' | 'c' | 'v'>[]): string {
  const first = verses[0];
  const last = verses.at(-1);
  if (!first || !last) return '';
  const name = swedishBookName(first.b);
  if (first.b !== last.b) return `${name} ${first.c}:${first.v} - ${swedishBookName(last.b)} ${last.c}:${last.v}`;
  if (first.c !== last.c) return `${name} ${first.c}:${first.v}-${last.c}:${last.v}`;
  if (first.v !== last.v) return `${name} ${first.c}:${first.v}-${last.v}`;
  return `${name} ${first.c}:${first.v}`;
}

/** The add button's label (spec 05 "Bibeltexter"): like the title, with spaces around a dash between chapters. */
export function bibleLabel(verses: Pick<Verse, 'b' | 'c' | 'v'>[]): string {
  const first = verses[0];
  const last = verses.at(-1);
  if (first && last && first.b === last.b && first.c !== last.c) return `${swedishBookName(first.b)} ${first.c}:${first.v} - ${last.c}:${last.v}`;
  return bibleTitle(verses);
}

/** What a Bible slide shows at the bottom: the passage and its translation (spec 04 credits, D12). */
export function bibleCredits(title: string, translation: string): string {
  return translation ? `${title} · ${translation}` : title;
}

// ------------------------------------------------------------------ slides (BIBLE-R12)

/** A run of words on a slide; `n` is the verse number when the run starts that verse. */
export interface BibleSegment {
  n: number | null;
  t: string;
}
export type BibleSlide = BibleSegment[];

/** About this many characters fit one slide at the themes' 75px (ADR 0001 (8)). */
export const BIBLE_CHARS_PER_SLIDE = 250;

interface Word {
  n: number | null;
  t: string;
}

const plainLength = (w: Word) => w.t.length + (w.n === null ? 0 : String(w.n).length + 1);

/**
 * Splits a passage into balanced slides, once, when it is added (BIBLE-R12):
 * as many slides as `total / 250` rounds up to, each filled with whole words
 * up to `total / slides`, the last taking the rest. Lengths are of the plain
 * text, verse numbers included. An empty verse still shows its number.
 */
export function splitBibleSlides(verses: Pick<Verse, 'v' | 't'>[], maxChars = BIBLE_CHARS_PER_SLIDE): BibleSlide[] {
  const words: Word[] = verses.flatMap((verse) => {
    const parts = verse.t.split(' ').filter(Boolean);
    return parts.length ? parts.map((t, i) => ({ n: i === 0 ? verse.v : null, t })) : [{ n: verse.v, t: '' }];
  });
  if (!words.length) return [];
  const total = words.reduce((sum, w) => sum + plainLength(w), 0) + words.length - 1;
  const slideCount = Math.max(1, Math.ceil(total / maxChars));
  const target = Math.ceil(total / slideCount);

  const slides: Word[][] = [];
  let current: Word[] = [];
  let length = 0;
  for (const w of words) {
    const candidate = current.length ? length + 1 + plainLength(w) : plainLength(w);
    if (candidate > target && current.length && slides.length < slideCount - 1) {
      slides.push(current);
      current = [w];
      length = plainLength(w);
    } else {
      current.push(w);
      length = candidate;
    }
  }
  if (current.length) slides.push(current);

  return slides.map((slide) => {
    const segments: BibleSegment[] = [];
    for (const w of slide) {
      const last = segments.at(-1);
      if (w.n === null && last) last.t = last.t ? `${last.t} ${w.t}` : w.t;
      else segments.push({ n: w.n, t: w.t });
    }
    return segments;
  });
}

/** A slide as plain text: "16 For God so loved…" (for search, labels and tests). */
export function bibleSlideText(slide: BibleSlide): string {
  return slide.map((s) => (s.n === null ? s.t : s.t ? `${s.n} ${s.t}` : String(s.n))).join(' ');
}

// ------------------------------------------------------------------ stored on an item

/** What a Bible item keeps (D12, D25): its translation and its frozen slides, as data, never HTML. */
export interface BibleItemContent {
  translation: string;
  slides: BibleSlide[];
}

const segmentSchema = z.object({ n: z.number().int().min(0).max(999).nullable(), t: z.string().max(10_000) });
export const bibleItemContentSchema = z.object({
  translation: z.string().max(50),
  slides: z.array(z.array(segmentSchema).max(500)).max(1000),
});

/** The content of a Bible item, or null if it is not one we can read. */
export function parseBibleContent(json: string | null): BibleItemContent | null {
  if (!json) return null;
  try {
    const parsed = bibleItemContentSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ a translation's text

/**
 * A translation's verses travel and are stored as one immutable text, named
 * by the SHA-256 of its canonical JSON (see docs/bibles-and-themes.md, "Bibles"). Books are
 * stored one per row, so no row comes near the 2 MB a Durable Object allows.
 */
export const BIBLE_LIMITS = { bibles: 10, verses: 60_000, verseLength: 10_000, bookBytes: 1_800_000, textBytes: 32 * 1024 * 1024 } as const;

const bookCode = z.string().regex(/^[0-9A-Z]{3}$/);
export const bibleBookTextSchema = z.object({
  code: bookCode,
  verses: z
    .array(z.tuple([z.number().int().min(0).max(999), z.number().int().min(0).max(999), z.string().max(BIBLE_LIMITS.verseLength)]))
    .min(1)
    .max(BIBLE_LIMITS.verses),
});
export const bibleTextSchema = z
  .object({ v: z.literal(1), books: z.array(bibleBookTextSchema).min(1).max(200) })
  .refine((t) => new Set(t.books.map((b) => b.code)).size === t.books.length, 'a book appears twice')
  .refine((t) => t.books.reduce((n, b) => n + b.verses.length, 0) <= BIBLE_LIMITS.verses, 'too many verses');

/** One book as it is stored: its verses as JSON. */
export function bookChunk(book: BibleBookText): string {
  return JSON.stringify(book.verses);
}

/**
 * The canonical JSON of a translation's text: `{"v":1,"books":[{"code":…,"verses":…},…]}`,
 * built from the stored chunks, so the server can hand back exactly what it hashed.
 */
export function joinBibleText(books: { code: string; chunk: string }[]): string {
  return `{"v":1,"books":[${books.map((b) => `{"code":${JSON.stringify(b.code)},"verses":${b.chunk}}`).join(',')}]}`;
}

export function serializeBibleText(books: BibleBookText[]): string {
  return joinBibleText(books.map((b) => ({ code: b.code, chunk: bookChunk(b) })));
}

export function bibleTextHash(json: string): Promise<string> {
  return sha256Hex(json);
}

/** Books in canonical order and each book's verses by chapter and verse (BIBLE-R9). */
export function sortBibleBooks(books: BibleBookText[]): BibleBookText[] {
  return books
    .toSorted((a, b) => compareBooks(a.code, b.code))
    .map((book) => ({ code: book.code, verses: book.verses.toSorted((x, y) => x[0] - y[0] || x[1] - y[1]) }));
}

export function verseCount(books: BibleBookText[]): number {
  return books.reduce((n, b) => n + b.verses.length, 0);
}

/** A translation's id: its abbreviation, which is unique per organisation (BIBLE-R5), so two imports of it converge. */
export function bibleId(abbreviation: string): string {
  return 'bible:' + abbreviation.normalize('NFC').trim().toLowerCase();
}

/**
 * The statements that store a text where it is kept (the server's
 * organisation database and every client's): one row per book, then the
 * marker that says the text is complete. Idempotent.
 */
export function storeBibleTextSql(hash: string, books: BibleBookText[]): { sql: string; params: unknown[] }[] {
  return [
    ...books.map((b, i) => ({
      sql: 'INSERT OR REPLACE INTO bible_texts (hash, book, sort, chunk) VALUES (?, ?, ?, ?)',
      params: [hash, b.code, i, bookChunk(b)],
    })),
    { sql: 'INSERT OR REPLACE INTO bible_blobs (hash, verse_count) VALUES (?, ?)', params: [hash, verseCount(books)] },
  ];
}

/** Reads a stored text's books back, in order. */
export const LOAD_BIBLE_TEXT_SQL = 'SELECT book AS code, chunk FROM bible_texts WHERE hash = ? ORDER BY sort';
