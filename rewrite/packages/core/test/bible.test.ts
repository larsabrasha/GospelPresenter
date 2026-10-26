import { describe, expect, it } from 'vitest';
import {
  BibleImportError,
  bibleCredits,
  bibleId,
  bibleItemSlides,
  bibleLabel,
  bibleSlideText,
  bibleTextHash,
  bibleTextSchema,
  bibleTitle,
  compareBooks,
  importBibleZip,
  isOldTestament,
  joinBibleText,
  bookChunk,
  makeZip,
  mutators,
  parseBibleContent,
  parseUsfm,
  parseUsx,
  parseXml,
  planVerseSearch,
  readZip,
  resolveBook,
  searchVerses,
  serializeBibleText,
  splitBibleSlides,
  swedishBookName,
  utf8Decode,
  utf8Encode,
  type BibleBookText,
  type Verse,
} from '../src/index.ts';
import { sampleDblZip, sampleUsfm, sampleUsfmZip, sampleUsx, WEB_SAMPLE } from './bible-fixtures.ts';

/** The current app's test translation (VerseSearchTests): Genesis 1:1 and eight verses of Matthew. */
const books: BibleBookText[] = [
  { code: 'GEN', verses: [[1, 1, 'I begynnelsen']] },
  {
    code: 'MAT',
    verses: [
      [3, 14, 'a'],
      [3, 15, 'b'],
      [3, 16, 'c'],
      [3, 17, 'd'],
      [4, 1, 'e'],
      [4, 2, 'f'],
      [4, 3, 'g'],
      [5, 1, 'h'],
    ],
  },
];
const refs = (q: string) => searchVerses(q, books).map((v) => `${v.b} ${v.c}:${v.v}`);

describe('book names (BIBLE-R9–R11, D12)', () => {
  it('resolves Swedish names, abbreviations and ordinal variants, case-insensitively', () => {
    for (const q of ['1 mos', '1:a mos', 'första mos', 'första moseboken', '1 Mosebok', 'genesis', 'gen', 'GE']) expect(resolveBook(q), q).toBe('GEN');
    for (const q of ['mat', 'matt', 'matteus', 'matteusevangeliet', 'MATT']) expect(resolveBook(q), q).toBe('MAT');
    expect(resolveBook('ps')).toBe('PSA');
    expect(resolveBook('apg')).toBe('ACT');
    expect(resolveBook('upb')).toBe('REV');
  });

  it('an ambiguous prefix takes the longest alias (spec 05 edge cases)', () => {
    expect(resolveBook('jo')).toBe('JHN'); // johannesevangeliet
    expect(resolveBook('ma')).toBe('MAT');
    expect(resolveBook('mar')).toBe('MRK');
    expect(resolveBook('1 jo')).toBe('1JN');
  });

  it('English names resolve too (D12), so the English examples find something', () => {
    expect(resolveBook('John')).toBe('JHN');
    expect(resolveBook('Psalm')).toBe('PSA');
    expect(resolveBook('1 John')).toBe('1JN');
    expect(resolveBook('Revelation')).toBe('REV');
    expect(resolveBook('nonsense')).toBeNull();
    expect(resolveBook('  ')).toBeNull();
  });

  it('canonical order, unknown codes last; the 39 Old Testament books, everything else New (BIBLE-R9, R10)', () => {
    expect(['REV', 'TOB', 'GEN', 'MAT', 'MAL'].toSorted(compareBooks)).toEqual(['GEN', 'MAL', 'MAT', 'REV', 'TOB']);
    expect(isOldTestament('MAL')).toBe(true);
    expect(isOldTestament('MAT')).toBe(false);
    expect(isOldTestament('TOB')).toBe(false);
    expect(swedishBookName('JHN')).toBe('Johannes');
    expect(swedishBookName('TOB')).toBe('TOB');
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
    expect(refs('')).toEqual([]);
    expect(refs('MAT abc')).toEqual([]);
    expect(refs('MAT')).toHaveLength(8);
  });

  it('trailing colon or dash, and a bare second number that is a chapter (spec 05 edge cases)', () => {
    expect(refs('MAT 3:')).toHaveLength(4);
    expect(refs('MAT 3-')).toHaveLength(4);
    expect(refs('MAT 3:16-')).toEqual(['MAT 3:16', 'MAT 3:17']);
    expect(refs('Matt 3:15-16')).toEqual(['MAT 3:15', 'MAT 3:16']); // verses of chapter 3
    expect(refs('Matt 3:17-4')).toEqual(['MAT 3:17', 'MAT 4:1', 'MAT 4:2', 'MAT 4:3']); // through chapter 4
  });

  it('"Joh 3 16" is not a reference; a book the translation lacks finds nothing; an unknown book matches codes by prefix', () => {
    expect(refs('Mat 3 15')).toEqual([]);
    expect(refs('Joh 3:16')).toEqual([]);
    expect(planVerseSearch('MA 3', ['MAT'])?.codes).toEqual(['MAT']);
    expect(planVerseSearch('M 3', ['MAT', 'MRK'])?.codes).toEqual(['MAT']); // "m" resolves to Matteus (longest alias)
    expect(planVerseSearch('MR 1', ['MRK'])?.codes).toEqual(['MRK']);
    expect(planVerseSearch('XY 1', ['XYZ'])?.codes).toEqual(['XYZ']);
    expect(planVerseSearch('XY', ['XYZ'])).toBeNull(); // a book on its own must resolve
  });
});

describe('titles (BIBLE-R13)', () => {
  const v = (b: string, c: number, n: number): Verse => ({ b, c, v: n, t: '' });
  it('one verse, one chapter, one book, two books', () => {
    expect(bibleTitle([v('JHN', 3, 16)])).toBe('Johannes 3:16');
    expect(bibleTitle([v('JHN', 3, 16), v('JHN', 3, 18)])).toBe('Johannes 3:16-18');
    expect(bibleTitle([v('JHN', 3, 16), v('JHN', 4, 2)])).toBe('Johannes 3:16-4:2');
    expect(bibleTitle([v('JHN', 21, 25), v('ACT', 1, 2)])).toBe('Johannes 21:25 - Apostlagärningarna 1:2');
    expect(bibleTitle([])).toBe('');
  });
  it('the add button puts spaces around a dash between chapters', () => {
    expect(bibleLabel([v('ROM', 8, 28), v('ROM', 8, 30)])).toBe('Romarbrevet 8:28-30');
    expect(bibleLabel([v('JHN', 3, 16), v('JHN', 4, 2)])).toBe('Johannes 3:16 - 4:2');
  });
  it('credits name the passage and the translation (D12)', () => {
    expect(bibleCredits('Johannes 3:16', 'SFB')).toBe('Johannes 3:16 · SFB');
  });
});

describe('slides (BIBLE-R12)', () => {
  const words = (n: number, word = 'ord') => Array.from({ length: n }, () => word).join(' ');

  it('a short passage is one slide, verse numbers at the start of each verse', () => {
    const slides = splitBibleSlides([
      { v: 16, t: 'Ty så älskade Gud världen' },
      { v: 17, t: 'Gud sände inte' },
    ]);
    expect(slides).toEqual([
      [
        { n: 16, t: 'Ty så älskade Gud världen' },
        { n: 17, t: 'Gud sände inte' },
      ],
    ]);
    expect(bibleSlideText(slides[0]!)).toBe('16 Ty så älskade Gud världen 17 Gud sände inte');
  });

  it('BIBLE-A13: ~600 characters become 3 balanced slides; no word is lost or doubled, each verse number once', () => {
    // 6 verses of 24 four-letter words: 6 × (2+1 + 24×4 + 23) = 6 × 122 = 732 characters plus 5 spaces.
    const verses = Array.from({ length: 6 }, (_, i) => ({ v: i + 1, t: Array.from({ length: 24 }, (_word, k) => `w${i}${String(k).padStart(2, '0')}`).join(' ') }));
    const slides = splitBibleSlides(verses);
    expect(slides).toHaveLength(3);
    const lengths = slides.map((s) => bibleSlideText(s).length);
    for (const l of lengths) expect(l).toBeLessThanOrEqual(250);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(40);
    const all = slides.flatMap((s) => bibleSlideText(s).split(' '));
    expect(all.filter((w) => /^\d+$/.test(w))).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(all.filter((w) => !/^\d+$/.test(w))).toEqual(verses.flatMap((v) => v.t.split(' ')));
  });

  it('a verse split across slides carries its number only on the first', () => {
    const slides = splitBibleSlides([{ v: 1, t: words(100) }]);
    expect(slides.length).toBe(2);
    expect(slides[0]![0]!.n).toBe(1);
    expect(slides[1]![0]!.n).toBeNull();
  });

  it('an empty verse still shows its number; no verses, no slides', () => {
    expect(splitBibleSlides([{ v: 5, t: '' }])).toEqual([[{ n: 5, t: '' }]]);
    expect(bibleSlideText([{ n: 5, t: '' }])).toBe('5');
    expect(splitBibleSlides([])).toEqual([]);
  });

  it('BIBLE-A14: text is data, so "<script>" stays text', () => {
    const content = { translation: 'X', slides: splitBibleSlides([{ v: 1, t: '<script>alert(1)</script>' }]) };
    const back = parseBibleContent(JSON.stringify(content))!;
    expect(bibleItemSlides('Johannes 3:16', back)[0]).toMatchObject({ kind: 'bible', text: '1 <script>alert(1)</script>', credits: 'Johannes 3:16 · X' });
    expect(parseBibleContent('{"slides":"<b>"}')).toBeNull();
    expect(parseBibleContent('not json')).toBeNull();
  });
});

describe('the stored text', () => {
  it('is canonical JSON, the same whether serialised whole or joined from its book chunks', async () => {
    const json = serializeBibleText(books);
    expect(JSON.parse(json)).toEqual({ v: 1, books });
    expect(joinBibleText(books.map((b) => ({ code: b.code, chunk: bookChunk(b) })))).toBe(json);
    expect(bibleTextSchema.safeParse(JSON.parse(json)).success).toBe(true);
    expect(await bibleTextHash(json)).toMatch(/^[0-9a-f]{64}$/);
    expect(await bibleTextHash(json)).not.toBe(await bibleTextHash(serializeBibleText(books.slice(1))));
  });

  it('refuses a book twice, a bad book code and an empty book', () => {
    expect(bibleTextSchema.safeParse({ v: 1, books: [books[0], books[0]] }).success).toBe(false);
    expect(bibleTextSchema.safeParse({ v: 1, books: [{ code: 'gen', verses: [[1, 1, 'x']] }] }).success).toBe(false);
    expect(bibleTextSchema.safeParse({ v: 1, books: [{ code: 'GEN', verses: [] }] }).success).toBe(false);
  });

  it('the id comes from the abbreviation, so two imports of one translation are one row (BIBLE-R5)', () => {
    expect(bibleId(' SFB ')).toBe(bibleId('sfb'));
  });
});

describe('import (BIBLE-R3–R6)', () => {
  it('BIBLE-A2: a DBL zip with metadata.xml and USX_1/ gives its local name, abbreviation, language and every verse', async () => {
    const bible = await importBibleZip(sampleDblZip('Svenska Folkbibeln', 'SFB'));
    expect(bible).toMatchObject({ name: 'Svenska Folkbibeln', abbreviation: 'SFB', language: 'eng' });
    expect(bible.books.map((b) => b.code)).toEqual(['GEN', 'PSA', 'JHN', 'ROM']);
    const verses = bible.books.flatMap((b) => b.verses.map(([c, v, t]) => [b.code, c, v, t]));
    expect(verses).toEqual(WEB_SAMPLE);
  });

  it('BIBLE-A4: an eBible USFM zip takes its name from copr.htm and initials as abbreviation', async () => {
    const bible = await importBibleZip(sampleUsfmZip());
    expect(bible).toMatchObject({ name: 'World English Bible', abbreviation: 'WEB', language: null });
    expect(bible.books.flatMap((b) => b.verses.map(([c, v, t]) => [b.code, c, v, t]))).toEqual(WEB_SAMPLE);
  });

  it('BIBLE-A5: a zip without USX or USFM, and a file that is not a zip, are refused', async () => {
    await expect(importBibleZip(makeZip([{ name: 'readme.txt', data: utf8Encode('hej') }]))).rejects.toThrow('Hittade inga USX- eller USFM-filer i zip-filen.');
    await expect(importBibleZip(utf8Encode('not a zip'))).rejects.toBeInstanceOf(BibleImportError);
  });

  it('reads DEFLATE entries, as real zips have', async () => {
    const stored = makeZip([{ name: 'GEN.usfm', data: utf8Encode(sampleUsfm('GEN')) }]);
    const deflated = await deflateEntries(stored);
    const [entry] = readZip(deflated);
    expect(utf8Decode(await entry!.read())).toBe(sampleUsfm('GEN'));
    expect((await importBibleZip(deflated)).books[0]!.verses).toHaveLength(3);
  });

  it('USX: headings, notes and text before the first chapter are left out; a range is its first verse; lines join with a space', () => {
    const book = parseUsx(`<usx version="2.0"><book code="PSA" style="id">Psalms</book><para style="mt1">Psalms</para>
      <chapter number="23" style="c"/><para style="d">A Psalm by David.</para>
      <para style="q1"><verse number="1" style="v"/>Yahweh is my <char style="nd">shepherd</char>;</para>
      <para style="q2">I shall lack nothing.<note style="x" caller="-"><char style="xt">Phil 4:19</char></note></para>
      <para style="q1"><verse number="2-3" style="v"/>Two &amp; three</para></usx>`);
    expect(book).toEqual({
      code: 'PSA',
      verses: [
        [23, 1, 'Yahweh is my shepherd; I shall lack nothing.'],
        [23, 2, 'Two & three'],
      ],
    });
    expect(parseUsx(sampleUsx('JHN'))!.verses[0]).toEqual([3, 16, WEB_SAMPLE[9]![3]]);
  });

  it('USFM: footnotes, cross references, headings and word attributes are left out', () => {
    const book = parseUsfm(`\\id MAT\n\\c 5\n\\s1 The Sermon\n\\p\n\\v 3 \\w Blessed|strong="G3107"\\w* are the poor\\x - \\xo 5:3 \\xt Luke 6:20\\x* in spirit,\n\\q2 for theirs is \\nd the Kingdom\\nd*.\n\\v 4-5 Blessed`);
    expect(book).toEqual({
      code: 'MAT',
      verses: [
        [5, 3, 'Blessed are the poor in spirit, for theirs is the Kingdom.'],
        [5, 4, 'Blessed'],
      ],
    });
  });

  it('XML: entities, CDATA, comments and quoted ">" in attributes', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- a > comment --><a x="1 > 0">&lt;b&gt; &#229;&#xe4;<![CDATA[<raw>]]></a>');
    expect(doc.children).toEqual([{ name: 'a', attrs: { x: '1 > 0' }, children: ['<b> åä', '<raw>'] }]);
  });
});

describe('mutator arguments (Bibles and themes)', () => {
  const verse = { b: 'JHN', c: 3, v: 16, t: 'x' };
  it('a passage has 1 to 500 verses with valid book codes', () => {
    const base = { itemId: 'I', presentationId: 'P', bibleId: 'bible:web', translation: 'WEB' };
    expect(mutators.addBibleToPresentation.args.safeParse({ ...base, verses: [verse] }).success).toBe(true);
    expect(mutators.addBibleToPresentation.args.safeParse({ ...base, verses: [] }).success).toBe(false);
    expect(mutators.addBibleToPresentation.args.safeParse({ ...base, verses: Array.from({ length: 501 }, () => verse) }).success).toBe(false);
    expect(mutators.addBibleToPresentation.args.safeParse({ ...base, verses: [{ ...verse, b: 'jhn' }] }).success).toBe(false);
  });
  it('an import names a SHA-256; names and abbreviations are trimmed and limited (BIBLE-R4)', () => {
    const ok = { name: ' Svenska Folkbibeln ', abbreviation: 'SFB', language: null, contentHash: 'a'.repeat(64) };
    expect(mutators.importBible.args.parse(ok).name).toBe('Svenska Folkbibeln');
    expect(mutators.importBible.args.safeParse({ ...ok, contentHash: 'abc' }).success).toBe(false);
    expect(mutators.importBible.args.safeParse({ ...ok, abbreviation: 'x'.repeat(51) }).success).toBe(false);
  });
});

/** Re-packs a stored zip with every entry DEFLATE-compressed, with the platform's compressor. */
async function deflateEntries(zip: Uint8Array): Promise<Uint8Array> {
  const web = globalThis as unknown as {
    CompressionStream: new (f: string) => unknown;
    Blob: new (p: Uint8Array[]) => { stream(): { pipeThrough(t: unknown): unknown } };
    Response: new (b: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
  };
  const entries = await Promise.all(readZip(zip).map(async (e) => ({ name: e.name, data: await e.read() })));
  const out = makeZip(entries);
  // Rebuild by hand: compress each entry and patch method and sizes in both headers.
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const deflated = new Uint8Array(await new web.Response(new web.Blob([e.data]).stream().pipeThrough(new web.CompressionStream('deflate-raw'))).arrayBuffer());
    const one = makeZip([{ name: e.name, data: e.data }]);
    const name = utf8Encode(e.name);
    const local = one.slice(0, 30);
    const dir = one.slice(30 + name.length + e.data.length, 30 + name.length + e.data.length + 46);
    for (const [h, at] of [
      [local, 8],
      [dir, 10],
    ] as const)
      new DataView(h.buffer).setUint16(at, 8, true);
    new DataView(local.buffer).setUint32(18, deflated.length, true);
    new DataView(dir.buffer).setUint32(20, deflated.length, true);
    new DataView(dir.buffer).setUint32(42, offset, true);
    parts.push(local, name, deflated);
    central.push(dir, name);
    offset += local.length + name.length + deflated.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = out.slice(out.length - 22);
  new DataView(end.buffer).setUint32(12, size, true);
  new DataView(end.buffer).setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const result = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of all) {
    result.set(c, o);
    o += c.length;
  }
  return result;
}
