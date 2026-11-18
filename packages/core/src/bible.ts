import { z } from 'zod';
import { compareBooks } from './bible-books.ts';
import { sha256Hex } from './platform.ts';

// Bible text (spec 05 "Bibles"): a translation's text as stored, sent and imported, and what an item keeps. A
// translation's zip is read by the Rust core (`bibleImportView`, crates/gp-core/src/bible_import.rs).

/** 50 MiB, as the current app (BIBLE-R2): a larger zip is not sent to the core. */
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

// A reference read as verses (BIBLE-R11), a passage's title and label (BIBLE-R13) and its slides (BIBLE-R12) are the
// Rust core's (crates/gp-core/src/bible_books.rs and bible.rs: verseSearchPlanView, bibleSlidesView,
// addBibleToPresentation), one place for every app.

/** A run of words on a slide; `n` is the verse number when the run starts that verse. */
export interface BibleSegment {
  n: number | null;
  t: string;
}
export type BibleSlide = BibleSegment[];

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
