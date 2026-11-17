// A real translation, opt in: set GP_REAL_BIBLE_ZIP to the path of a Bible zip (USX or USFM) to import it as the app
// does and check its shape, then read references and slides of it through the core's views (verseSearchPlanView,
// bibleSlidesView). Real translations are mostly under copyright, so none is in the repository and this test asserts
// only counts, lengths and shape, never the text itself. Skipped when the variable is not set.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BIBLE_LIMITS, bibleTextHash, bibleTextSchema, bookChunk, importBibleZip, serializeBibleText, type BibleBookText, type ImportedBible, type Verse } from '@gp/core';
import { nodeRustCore } from '../src/node.ts';

const zipPath = process.env.GP_REAL_BIBLE_ZIP;
const core = nodeRustCore();

/** The 66 books of the Protestant canon (a translation may have more). */
const CANON = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');

/** The verses a reference selects, as the core's bibleView reads its plan. */
function searchVerses(query: string, books: BibleBookText[]): Verse[] {
  const p = core.pure<{ codes: string[]; from: [number, number]; to: [number, number] } | null>('verseSearchPlanView', { query, available: books.map((b) => b.code) });
  if (!p) return [];
  const within = (c: number, v: number) => (c > p.from[0] || (c === p.from[0] && v >= p.from[1])) && (c < p.to[0] || (c === p.to[0] && v <= p.to[1]));
  return books.filter((b) => p.codes.includes(b.code)).flatMap((b) => b.verses.filter(([c, v]) => within(c, v)).map(([c, v, t]) => ({ b: b.code, c, v, t })));
}
const shown = (verses: Verse[]) => core.pure<{ title: string; slides: { text: string; verses: { n: number | null }[] }[] }>('bibleSlidesView', { translation: '', verses });

describe.skipIf(!zipPath)('a real Bible (GP_REAL_BIBLE_ZIP)', () => {
  let bible: ImportedBible;
  const all = () => bible.books.flatMap((b) => b.verses.map(([c, v, t]) => ({ ref: `${b.code} ${c}:${v}`, t })));

  it('imports, with the whole canon and a sane number of verses', async () => {
    bible = await importBibleZip(new Uint8Array(readFileSync(zipPath!)));
    const codes = bible.books.map((b) => b.code);

    expect(CANON.filter((c) => !codes.includes(c))).toEqual([]);
    expect(all().length).toBeGreaterThan(29_000);
    expect(all().length).toBeLessThan(BIBLE_LIMITS.verses);
    expect([bible.name.length > 0, bible.abbreviation.length > 0]).toEqual([true, true]);
    expect(await bibleTextHash(serializeBibleText(bible.books))).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it('has no empty verses, no markup left over, and no space before punctuation', () => {
    const bad = (test: (t: string) => boolean) => all().filter((v) => test(v.t)).map((v) => v.ref);

    expect(bad((t) => !t.trim())).toEqual([]);
    expect(bad((t) => t !== t.trim() || /\s{2}/.test(t))).toEqual([]);
    // XML tags or entities, USFM markers (\w, \f …) or word attributes (word|strong="…").
    expect(bad((t) => /<\/?[a-z]|&[a-z#0-9]+;|\\[a-z]|\|/i.test(t))).toEqual([]);
    expect(bad((t) => /\p{Cc}/u.test(t))).toEqual([]);
    // Swedish » and ” open as well as close a quote, so only these are checked.
    expect(bad((t) => /\s[.,;:!?)]/.test(t))).toEqual([]);
  });

  it('fits what the server accepts', () => {
    expect(bibleTextSchema.safeParse({ v: 1, books: bible.books }).success).toBe(true);
    for (const book of bible.books) expect(new TextEncoder().encode(bookChunk(book)).length, book.code).toBeLessThan(BIBLE_LIMITS.bookBytes);
    expect(serializeBibleText(bible.books).length).toBeLessThan(BIBLE_LIMITS.textBytes);
  });

  it('finds known references and splits them into slides', () => {
    const cases: [query: string, verses: number, title: string][] = [
      ['1 Mos 1:1-5', 5, '1 Moseboken 1:1-5'],
      ['Ps 23', 6, 'Psaltaren 23:1-6'],
      ['Joh 3:16', 1, 'Johannes 3:16'],
      ['Rom 8:28-30', 3, 'Romarbrevet 8:28-30'],
      ['Upp 22:21', 1, 'Uppenbarelseboken 22:21'],
    ];
    for (const [query, count, title] of cases) {
      const verses = searchVerses(query, bible.books);
      const { title: got, slides } = shown(verses);

      expect([verses.length, got], query).toEqual([count, title]);
      expect(slides.flatMap((s) => s.verses).filter((s) => s.n !== null).map((s) => s.n), query).toEqual(verses.map((v) => v.v));
    }
  });

  it('splits every chapter into slides, every word kept in order', () => {
    let chapters = 0;
    for (const book of bible.books) {
      for (const c of new Set(book.verses.map(([chapter]) => chapter))) {
        const verses = book.verses.filter(([chapter]) => chapter === c).map(([chapter, v, t]) => ({ b: book.code, c: chapter, v, t }));

        expect(shown(verses).slides.map((s) => s.text).join(' '), `${book.code} ${c}`).toBe(verses.map((v) => `${v.v} ${v.t}`).join(' '));
        chapters++;
      }
    }
    expect(chapters).toBeGreaterThan(1_100);
  });
});
