import { describe, expect, it } from 'vitest';
import { bibleId, bibleTextHash, bibleTextSchema, compareBooks, joinBibleText, bookChunk, serializeBibleText, type BibleBookText } from '../src/index.ts';
import { bibleItemContent } from '../src/core.ts';

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
// Book names, references, titles and slides are the Rust core's, tested in packages/rust-core/test/bible.test.ts; the
// import of a translation's zip is the core's too (packages/rust-core/test/bible-import.test.ts).

describe('book order (BIBLE-R9)', () => {
  it('canonical order, unknown codes last', () => {
    expect(['REV', 'TOB', 'GEN', 'MAT', 'MAL'].toSorted(compareBooks)).toEqual(['GEN', 'MAL', 'MAT', 'REV', 'TOB']);
  });
});

describe('a Bible item’s content', () => {
  it('reads as data, never markup; one that does not read is none', () => {
    const content = { translation: 'X', slides: [[{ n: 1, t: '<script>alert(1)</script>' }]] };

    expect([bibleItemContent(JSON.stringify(content)), bibleItemContent('{"slides":"<b>"}'), bibleItemContent('not json')]).toEqual([content, null, null]);
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
