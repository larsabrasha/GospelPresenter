import { z } from 'zod';
import { swedishBookName } from './bible-books.ts';
import { FIELD_RULES } from './mutation.ts';
import { sha256Hex } from './platform.ts';

// Bible text (spec 05 "Bibles"): references, the verses they select, and how
// a passage becomes slides and a title. Pure functions, used by the add-item
// picker, the mutators and the tests.

/** 50 MiB, as the current app (BIBLE-R2): a larger zip is not read. */
export const BIBLE_ZIP_MAX_BYTES = 52_428_800;

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

/** An item's title of these verses (`addBibleToPresentation`): `bibleTitle`, cut to an item's 200. */
export const bibleItemTitle = (verses: Pick<Verse, 'b' | 'c' | 'v'>[]): string => bibleTitle(verses).slice(0, FIELD_RULES.name.max);

/** The add button's label (spec 05 "Bibeltexter"): like the title, with spaces around a dash between chapters. */
export function bibleLabel(verses: Pick<Verse, 'b' | 'c' | 'v'>[]): string {
  const first = verses[0];
  const last = verses.at(-1);
  if (first && last && first.b === last.b && first.c !== last.c) return `${swedishBookName(first.b)} ${first.c}:${first.v} - ${last.c}:${last.v}`;
  return bibleTitle(verses);
}

// ------------------------------------------------------------------ slides (BIBLE-R12)

/** A run of words on a slide; `n` is the verse number when the run starts that verse. */
export interface BibleSegment {
  n: number | null;
  t: string;
}
export type BibleSlide = BibleSegment[];

/** About this many characters fit one slide at the themes' 75px (ADR 0001 (8)). */
const BIBLE_CHARS_PER_SLIDE = 250;

interface Word {
  n: number | null;
  t: string;
}

/** What a break costs (crates/gp-core/src/bible.rs, BREAK_*): before a verse, within a run, after , ; and . */
const BREAK = { verse: 0, within: 6, comma: 3, clause: 2, sentence: 1, fragment: 4 } as const;
/** How much a slide's length off the target costs, squared. */
const UNEVEN = 20;
/** No slide longer than this times the target, unless it is one word. */
const LONGEST = 1.4;

/** A word's last mark before closing quotes and brackets: 3 ends a sentence, 2 a clause, 1 a comma's, 0 none. */
function mark(t: string): 0 | 1 | 2 | 3 {
  const last = [...t.replace(/["'”’»)\]]+$/u, '')].at(-1);
  if (last && '.!?…'.includes(last)) return 3;
  if (last && ';:'.includes(last)) return 2;
  if (last && ',–—'.includes(last)) return 1;
  return 0;
}

const plainLength = (w: Word) => w.t.length + (w.n === null ? 0 : String(w.n).length + 1);

/**
 * Splits a passage into slides, once, when it is added (BIBLE-R12, BIBLE-A18; Lars 2026-11-19): as many as the plain
 * text (verse numbers included) over `maxChars` rounds up to, broken where reading pauses (before a verse, after a
 * sentence, a clause, a comma) and as even as that allows: the cheapest breaks, found word by word. A break that
 * leaves a fragment of one or two words of a sentence costs more. An empty verse still shows its number.
 */
export function splitBibleSlides(verses: Pick<Verse, 'v' | 't'>[], maxChars = BIBLE_CHARS_PER_SLIDE): BibleSlide[] {
  const words: Word[] = verses.flatMap((verse) => {
    const parts = verse.t.split(' ').filter(Boolean);
    return parts.length ? parts.map((t, i) => ({ n: i === 0 ? verse.v : null, t })) : [{ n: verse.v, t: '' }];
  });
  const count = words.length;
  if (!count) return [];
  const lengths = words.map(plainLength);
  const total = lengths.reduce((a, b) => a + b, 0) + count - 1;
  const target = total / Math.max(1, Math.ceil(total / maxChars));
  const marks = words.map((w) => mark(w.t));
  // The words back to the sentence's start and on to its end, each counting itself.
  const back: number[] = [];
  for (let i = 0; i < count; i++) back[i] = i > 0 && marks[i - 1]! < 3 ? back[i - 1]! + 1 : 1;
  const ahead: number[] = [];
  for (let i = count - 1; i >= 0; i--) ahead[i] = marks[i]! < 3 && i + 1 < count ? ahead[i + 1]! + 1 : 1;
  const breakAfter = (k: number) => {
    if (k + 1 === count) return 0;
    const at = words[k + 1]!.n !== null ? BREAK.verse : [BREAK.within, BREAK.comma, BREAK.clause, BREAK.sentence][marks[k]!]!;
    return at + (marks[k]! < 3 && (back[k]! <= 2 || ahead[k + 1]! <= 2) ? BREAK.fragment : 0);
  };
  const best: number[] = Array.from({ length: count + 1 }, () => Infinity);
  const from: number[] = Array.from({ length: count + 1 }, () => 0);
  best[0] = 0;
  for (let j = 0; j < count; j++) {
    let length = 0;
    for (let i = j; i >= 0; i--) {
      length += lengths[i]! + (i < j ? 1 : 0);
      if (i < j && length > target * LONGEST) break;
      const apart = (length - target) / target;
      const cost = best[i]! + UNEVEN * apart * apart + breakAfter(j);
      if (cost < best[j + 1]!) {
        best[j + 1] = cost;
        from[j + 1] = i;
      }
    }
  }
  const ends: number[] = [];
  for (let j = count; j > 0; j = from[j]!) ends.unshift(j);
  let start = 0;
  return ends.map((end) => {
    const segments: BibleSegment[] = [];
    for (const w of words.slice(start, end)) {
      const last = segments.at(-1);
      if (last && w.n === null) last.t = last.t ? `${last.t} ${w.t}` : w.t;
      else segments.push({ n: w.n, t: w.t });
    }
    start = end;
    return segments;
  });
}

// ------------------------------------------------------------------ stored on an item

/** The most a Bible item's content holds: its translation's length, its slides, a slide's runs (a run's text: `BIBLE_LIMITS.verseLength`). */
export const BIBLE_ITEM_LIMITS = { translation: 50, slides: 1000, runs: 500 } as const;

/** What a Bible item keeps (D12, D25): its translation and its frozen slides, as data, never HTML. */
export interface BibleItemContent {
  translation: string;
  slides: BibleSlide[];
}

// ------------------------------------------------------------------ a translation's text

/**
 * A translation's verses travel and are stored as one immutable text, named
 * by the SHA-256 of its canonical JSON (see docs/bibles-and-themes.md, "Bibles"). Books are
 * stored one per row, so no row comes near the 2 MB a Durable Object allows.
 */
export const BIBLE_LIMITS = { bibles: 10, books: 200, verses: 60_000, verseLength: 10_000, bookBytes: 1_800_000, textBytes: 32 * 1024 * 1024 } as const;

const bookCode = z.string().regex(/^[0-9A-Z]{3}$/);
export const bibleBookTextSchema = z.object({
  code: bookCode,
  verses: z
    .array(z.tuple([z.number().int().min(0).max(999), z.number().int().min(0).max(999), z.string().max(BIBLE_LIMITS.verseLength)]))
    .min(1)
    .max(BIBLE_LIMITS.verses),
});
export const bibleTextSchema = z
  .object({ v: z.literal(1), books: z.array(bibleBookTextSchema).min(1).max(BIBLE_LIMITS.books) })
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
