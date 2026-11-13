// A real translation, opt in: set GP_REAL_BIBLE_ZIP to the path of a Bible
// zip (USX or USFM) to import it as the app does and check its shape. Real
// translations are mostly under copyright, so none is in the repository and
// this test asserts only counts, lengths and shape, never the text itself.
// Skipped when the variable is not set.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BIBLE_LIMITS,
  bibleSlideText,
  bibleTextHash,
  bibleTextSchema,
  bibleTitle,
  bookChunk,
  importBibleZip,
  searchVerses,
  serializeBibleText,
  splitBibleSlides,
  type ImportedBible,
} from '../../src/index.ts';

const zipPath = process.env.GP_REAL_BIBLE_ZIP;

/** The 66 books of the Protestant canon (a translation may have more). */
const CANON =
  'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(
    ' ',
  );

describe.skipIf(!zipPath)('a real Bible (GP_REAL_BIBLE_ZIP)', () => {
  let bible: ImportedBible;
  let importMs = 0;
  const all = () => bible.books.flatMap((b) => b.verses.map(([c, v, t]) => ({ ref: `${b.code} ${c}:${v}`, t })));

  it('imports, with the whole canon and a sane number of verses', async () => {
    const data = new Uint8Array(readFileSync(zipPath!));
    const start = performance.now();
    bible = await importBibleZip(data);
    importMs = performance.now() - start;

    const codes = bible.books.map((b) => b.code);
    expect(CANON.filter((c) => !codes.includes(c))).toEqual([]);
    const verses = all().length;
    expect(verses).toBeGreaterThan(29_000);
    expect(verses).toBeLessThan(BIBLE_LIMITS.verses);
    expect(bible.name.length).toBeGreaterThan(0);
    expect(bible.abbreviation.length).toBeGreaterThan(0);

    const json = serializeBibleText(bible.books);
    console.log(
      `[real Bible] ${codes.length} books, ${verses} verses, ${(json.length / 1e6).toFixed(2)} MB JSON, ` +
        `import ${Math.round(importMs)} ms, hash ${(await bibleTextHash(json)).slice(0, 12)}…`,
    );
  }, 60_000);

  it('has no empty verses, no markup left over, and no space before punctuation', () => {
    const verses = all();
    const bad = (test: (t: string) => boolean) => verses.filter((v) => test(v.t)).map((v) => v.ref);
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
      expect(verses, query).toHaveLength(count);
      expect(bibleTitle(verses), query).toBe(title);
      const slides = splitBibleSlides(verses);
      expect(slides.length, query).toBeGreaterThan(0);
      expect(slides.flat().filter((s) => s.n !== null).map((s) => s.n), query).toEqual(verses.map((v) => v.v));
    }
  });

  it('splits every chapter into slides', () => {
    let chapters = 0;
    let slides = 0;
    for (const book of bible.books) {
      for (const c of new Set(book.verses.map(([chapter]) => chapter))) {
        const verses = book.verses.filter(([chapter]) => chapter === c).map(([, v, t]) => ({ v, t }));
        const split = splitBibleSlides(verses);
        // Every word is kept, in order.
        expect(split.map(bibleSlideText).join(' '), `${book.code} ${c}`).toBe(verses.map((v) => `${v.v} ${v.t}`).join(' '));
        chapters++;
        slides += split.length;
      }
    }
    console.log(`[real Bible] ${chapters} chapters, ${slides} slides`);
    expect(chapters).toBeGreaterThan(1_100);
  });
});
