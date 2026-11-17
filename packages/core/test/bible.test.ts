import { describe, expect, it } from 'vitest';
import {
  BibleImportError,
  bibleId,
  bibleTextHash,
  bibleTextSchema,
  compareBooks,
  importBibleZip,
  joinBibleText,
  bookChunk,
  makeZip,
  parseBibleContent,
  parseUsfm,
  parseUsx,
  parseXml,
  readZip,
  serializeBibleText,
  utf8Decode,
  utf8Encode,
  type BibleBookText,
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
// Book names, references, titles and slides are the Rust core's, tested in packages/rust-core/test/bible.test.ts.

describe('book order (BIBLE-R9)', () => {
  it('canonical order, unknown codes last', () => {
    expect(['REV', 'TOB', 'GEN', 'MAT', 'MAL'].toSorted(compareBooks)).toEqual(['GEN', 'MAL', 'MAT', 'REV', 'TOB']);
  });
});

describe('a Bible item’s content', () => {
  it('reads as data, never markup; one that does not read is none', () => {
    const content = { translation: 'X', slides: [[{ n: 1, t: '<script>alert(1)</script>' }]] };

    expect([parseBibleContent(JSON.stringify(content)), parseBibleContent('{"slides":"<b>"}'), parseBibleContent('not json')]).toEqual([content, null, null]);
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
    await expect(importBibleZip(makeZip([{ name: 'readme.txt', data: utf8Encode('hej') }]))).rejects.toThrow('no-files');
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
