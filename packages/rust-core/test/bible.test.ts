// The Bible tab's rules, read through the core's pure views (crates/gp-core/src/bible_books.rs and bible.rs): book
// names, references, titles and slides (spec 05). They were packages/core's TS tests until the core took them over.
import { describe, expect, it } from 'vitest';
import type { BibleBookText, Verse } from '@gp/core';
import { nodeRustCore } from '../src/node.ts';

const core = nodeRustCore();
type Plan = { codes: string[]; from: [number, number]; to: [number, number] } | null;
const plan = (query: string, available: string[]) => core.pure<Plan>('verseSearchPlanView', { query, available });
const ALL = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
/** The book a name resolves to: a reference of it planned among every book. */
const resolve = (name: string) => plan(`${name} 1`, ALL)?.codes[0] ?? null;
const names = (code: string) => core.pure<{ sv: string; en: string; oldTestament: boolean }[]>('bibleBookNamesView', { codes: [code] })[0]!;
type Shown = { title: string; label: string; slides: { text: string; credits: string; verses: { n: number | null; t: string }[] }[] };
const shown = (verses: Verse[], translation = 'SFB') => core.pure<Shown>('bibleSlidesView', { translation, verses });

/** The current app's test translation (VerseSearchTests): Genesis 1:1 and eight verses of Matthew. */
const books: BibleBookText[] = [
  { code: 'GEN', verses: [[1, 1, 'I begynnelsen']] },
  { code: 'MAT', verses: [[3, 14, 'a'], [3, 15, 'b'], [3, 16, 'c'], [3, 17, 'd'], [4, 1, 'e'], [4, 2, 'f'], [4, 3, 'g'], [5, 1, 'h']] },
];

/** The verses a reference selects, as the core's bibleView reads a plan. */
function searchVerses(query: string, among: BibleBookText[]): Verse[] {
  const p = plan(query, among.map((b) => b.code));
  if (!p) return [];
  const within = (c: number, v: number) => (c > p.from[0] || (c === p.from[0] && v >= p.from[1])) && (c < p.to[0] || (c === p.to[0] && v <= p.to[1]));
  return among.filter((b) => p.codes.includes(b.code)).flatMap((b) => b.verses.filter(([c, v]) => within(c, v)).map(([c, v, t]) => ({ b: b.code, c, v, t })));
}
const refs = (q: string) => searchVerses(q, books).map((v) => `${v.b} ${v.c}:${v.v}`);

describe('book names (BIBLE-R9–R11, D12)', () => {
  it('resolves Swedish names, abbreviations and ordinal variants, case-insensitively', () => {
    for (const q of ['1 mos', '1:a mos', 'första mos', 'första moseboken', '1 Mosebok', 'genesis', 'gen', 'GE']) expect(resolve(q), q).toBe('GEN');
    for (const q of ['mat', 'matt', 'matteus', 'matteusevangeliet', 'MATT']) expect(resolve(q), q).toBe('MAT');
    expect([resolve('ps'), resolve('apg'), resolve('upb')]).toEqual(['PSA', 'ACT', 'REV']);
  });

  it('an ambiguous prefix takes the longest alias (spec 05 edge cases)', () => {
    expect([resolve('jo'), resolve('ma'), resolve('mar'), resolve('1 jo')]).toEqual(['JHN', 'MAT', 'MRK', '1JN']);
  });

  it('English names resolve too (D12); nonsense resolves to nothing', () => {
    expect([resolve('John'), resolve('Psalm'), resolve('1 John'), resolve('Revelation'), resolve('nonsense')]).toEqual(['JHN', 'PSA', '1JN', 'REV', null]);
  });

  it('the 39 Old Testament books, everything else New; an unknown code shows as itself (BIBLE-R10)', () => {
    expect([names('MAL').oldTestament, names('MAT').oldTestament, names('TOB').oldTestament]).toEqual([true, false, false]);
    expect([names('JHN').sv, names('JHN').en, names('TOB').sv]).toEqual(['Johannes', 'John', 'TOB']);
  });
});

describe('verse references (BIBLE-R11, BIBLE-A9)', () => {
  it('the current app’s test queries', () => {
    expect(refs('MAT 3')).toHaveLength(4);
    expect(refs('MAT 3:15')).toEqual(['MAT 3:15']);
    expect(refs('MAT 3:15-17')).toHaveLength(3);
    expect(refs('MAT 3:15-4')).toEqual(['MAT 3:15', 'MAT 3:16', 'MAT 3:17', 'MAT 4:1', 'MAT 4:2', 'MAT 4:3']);
    expect(refs('MAT 3-4')).toHaveLength(7);
    expect(refs('MAT 3:16-4:2')).toEqual(['MAT 3:16', 'MAT 3:17', 'MAT 4:1', 'MAT 4:2']);
    for (const q of ['mat 3:15', 'matt 3:15', 'matteus 3:15', 'matteusevangeliet 3:15', 'MATT 3:15']) expect(refs(q), q).toEqual(['MAT 3:15']);
    for (const q of ['GE 1:1', '1 mos 1:1', '1:a mos 1:1', 'första mos 1:1', 'första moseboken 1:1', 'genesis 1:1', 'gen 1:1']) expect(refs(q), q).toEqual(['GEN 1:1']);
    for (const q of ['MAT  3:15', 'MAT 3 :15', 'MAT 3: 15', 'MAT 3 : 15', '  MAT   3:15  ']) expect(refs(q), q).toEqual(['MAT 3:15']);
    expect(refs('MAT 3 : 15 - 17')).toHaveLength(3);
    expect([refs(''), refs('MAT abc')]).toEqual([[], []]);
    expect(refs('MAT')).toHaveLength(8);
  });

  it('trailing colon or dash, and a bare second number that is a chapter (spec 05 edge cases)', () => {
    expect(refs('MAT 3:')).toHaveLength(4);
    expect(refs('MAT 3-')).toHaveLength(4);
    expect(refs('MAT 3:16-')).toEqual(['MAT 3:16', 'MAT 3:17']);
    expect(refs('Matt 3:15-16')).toEqual(['MAT 3:15', 'MAT 3:16']);
    expect(refs('Matt 3:17-4')).toEqual(['MAT 3:17', 'MAT 4:1', 'MAT 4:2', 'MAT 4:3']);
  });

  it('"Joh 3 16" is not a reference; a book the translation lacks finds nothing; an unknown book matches codes by prefix', () => {
    expect([refs('Mat 3 15'), refs('Joh 3:16')]).toEqual([[], []]);
    expect(plan('MA 3', ['MAT'])?.codes).toEqual(['MAT']);
    expect(plan('M 3', ['MAT', 'MRK'])?.codes).toEqual(['MAT']);
    expect(plan('MR 1', ['MRK'])?.codes).toEqual(['MRK']);
    expect(plan('XY 1', ['XYZ'])?.codes).toEqual(['XYZ']);
    expect(plan('XY', ['XYZ'])).toBeNull();
  });
});

describe('titles (BIBLE-R13)', () => {
  const v = (b: string, c: number, n: number): Verse => ({ b, c, v: n, t: '' });

  it('one verse, one chapter, one book, two books', () => {
    expect(shown([v('JHN', 3, 16)]).title).toBe('Johannes 3:16');
    expect(shown([v('JHN', 3, 16), v('JHN', 3, 18)]).title).toBe('Johannes 3:16-18');
    expect(shown([v('JHN', 3, 16), v('JHN', 4, 2)]).title).toBe('Johannes 3:16-4:2');
    expect(shown([v('JHN', 21, 25), v('ACT', 1, 2)]).title).toBe('Johannes 21:25 - Apostlagärningarna 1:2');
  });

  it('the add button puts spaces around a dash between chapters', () => {
    expect([shown([v('ROM', 8, 28), v('ROM', 8, 30)]).label, shown([v('JHN', 3, 16), v('JHN', 4, 2)]).label]).toEqual(['Romarbrevet 8:28-30', 'Johannes 3:16 - 4:2']);
  });

  it('credits name the passage and the translation (D12)', () => {
    expect(shown([v('JHN', 3, 16)]).slides[0]!.credits).toBe('Johannes 3:16 · SFB');
  });
});

describe('slides (BIBLE-R12)', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'ord').join(' ');
  const verse = (n: number, t: string): Verse => ({ b: 'JHN', c: 3, v: n, t });

  it('a short passage is one slide, verse numbers at the start of each verse', () => {
    const { slides } = shown([verse(16, 'Ty så älskade Gud världen'), verse(17, 'Gud sände inte')]);

    expect(slides.map((s) => s.text)).toEqual(['16 Ty så älskade Gud världen 17 Gud sände inte']);
  });

  it('BIBLE-A13: ~600 characters become 3 balanced slides; no word is lost or doubled, each verse number once', () => {
    const verses = Array.from({ length: 6 }, (_, i) => verse(i + 1, Array.from({ length: 24 }, (_w, k) => `w${i}${String(k).padStart(2, '0')}`).join(' ')));
    const lengths = shown(verses).slides.map((s) => s.text.length);
    const all = shown(verses).slides.flatMap((s) => s.text.split(' '));

    expect(lengths).toHaveLength(3);
    for (const l of lengths) expect(l).toBeLessThanOrEqual(250);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(40);
    expect(all.filter((w) => /^\d+$/.test(w))).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(all.filter((w) => !/^\d+$/.test(w))).toEqual(verses.flatMap((x) => x.t.split(' ')));
  });

  it('a verse split across slides carries its number only on the first', () => {
    const { slides } = shown([verse(1, words(100))]);

    expect([slides.length, slides[0]!.verses[0]!.n, slides[1]!.verses[0]!.n]).toEqual([2, 1, null]);
  });

  it('an empty verse still shows its number; no verses, no slides', () => {
    expect(shown([verse(5, '')]).slides.map((s) => s.text)).toEqual(['5']);
    expect(shown([]).slides).toEqual([]);
  });

  it('BIBLE-A14: text is data, so "<script>" stays text', () => {
    expect(shown([verse(1, '<script>alert(1)</script>')], 'X').slides[0]).toMatchObject({ text: '1 <script>alert(1)</script>', credits: 'Johannes 3:1 · X' });
  });
});
