// A translation's zip read by the core (`importBibleZip`, spec 05 BIBLE-R3–R6): the tests of 2.0's TS importBibleZip,
// parseUsx, parseUsfm and parseXml, moved here with it; a book's text read through a zip holding that one file.
import { deflateRawSync } from 'node:zlib';
import { makeZip, MutationError, utf8Encode } from '@gp/core';
import { describe, expect, it } from 'vitest';
import { importBibleZip } from '../../src/core.ts';
import { sampleDblZip, sampleUsfm, sampleUsfmZip, sampleUsx, WEB_SAMPLE } from './bible-fixtures.ts';

type Bible = ReturnType<typeof importBibleZip>;

const read = (zip: Uint8Array) => importBibleZip(zip);
const refusal = (zip: Uint8Array) => {
  try {
    read(zip);
    return null;
  } catch (e) {
    return e instanceof MutationError ? e.code : String(e);
  }
};
/** The one book of a zip holding `text` as `name`. */
const book = (name: string, text: string) => read(makeZip([{ name, data: utf8Encode(text) }])).books[0];
const verses = (bible: Bible) => bible.books.flatMap((b) => b.verses.map(([c, v, t]) => [b.code, c, v, t]));

/** A zip of one DEFLATE entry, as real zips have. */
function deflated(name: string, text: string): Uint8Array {
  const stored = makeZip([{ name, data: utf8Encode(text) }]);
  const data = deflateRawSync(utf8Encode(text));
  const n = utf8Encode(name).length;
  const local = Buffer.from(stored.subarray(0, 30));
  const dir = Buffer.from(stored.subarray(30 + n + utf8Encode(text).length, 30 + n + utf8Encode(text).length + 46));
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  dir.writeUInt16LE(8, 10);
  dir.writeUInt32LE(data.length, 20);
  const end = Buffer.from(stored.subarray(stored.length - 22));
  end.writeUInt32LE(30 + n + data.length, 16);
  return new Uint8Array(Buffer.concat([local, utf8Encode(name), data, dir, utf8Encode(name), end]));
}

describe('a translation from a zip (BIBLE-R3–R6)', () => {
  it('BIBLE-A2: a DBL zip with metadata.xml and USX_1/ gives its local name, abbreviation, language and every verse', () => {
    const bible = read(sampleDblZip('Svenska Folkbibeln', 'SFB'));

    expect(bible).toMatchObject({ name: 'Svenska Folkbibeln', abbreviation: 'SFB', language: 'eng' });
    expect([bible.books.map((b) => b.code), verses(bible)]).toEqual([['GEN', 'PSA', 'JHN', 'ROM'], WEB_SAMPLE]);
  });

  it('BIBLE-A4: an eBible USFM zip takes its name from copr.htm and initials as abbreviation', () => {
    const bible = read(sampleUsfmZip());

    expect(bible).toMatchObject({ name: 'World English Bible', abbreviation: 'WEB', language: null });
    expect(verses(bible)).toEqual(WEB_SAMPLE);
  });

  it('BIBLE-A5: refuses a zip without USX or USFM, and a file that is not a zip', () => {
    expect([refusal(makeZip([{ name: 'readme.txt', data: utf8Encode('hej') }])), refusal(utf8Encode('not a zip'))]).toEqual(['no-files', 'not-zip']);
  });

  it('reads DEFLATE entries, as real zips have', () => {
    expect(book('GEN.usfm', sampleUsfm('GEN'))).toEqual(read(deflated('GEN.usfm', sampleUsfm('GEN'))).books[0]);
  });

  it('refuses a damaged DEFLATE stream as compression', () => {
    const zip = deflated('GEN.usfm', sampleUsfm('GEN'));
    zip.fill(0xff, 40, 60);

    expect(refusal(zip)).toBe('compression');
  });
});

describe('a USX book', () => {
  it('leaves out headings, notes and text before the first chapter; a range is its first verse; lines join with a space', () => {
    const text = `<usx version="2.0"><book code="PSA" style="id">Psalms</book><para style="mt1">Psalms</para>
      <chapter number="23" style="c"/><para style="d">A Psalm by David.</para>
      <para style="q1"><verse number="1" style="v"/>Yahweh is my <char style="nd">shepherd</char>;</para>
      <para style="q2">I shall lack nothing.<note style="x" caller="-"><char style="xt">Phil 4:19</char></note></para>
      <para style="q1"><verse number="2-3" style="v"/>Two &amp; three</para></usx>`;

    expect(book('PSA.usx', text)).toEqual({ code: 'PSA', verses: [[23, 1, 'Yahweh is my shepherd; I shall lack nothing.'], [23, 2, 'Two & three']] });
  });

  it('reads the sample as it is written', () => {
    expect(book('JHN.usx', sampleUsx('JHN'))?.verses[0]).toEqual([3, 16, WEB_SAMPLE[9]![3]]);
  });

  it('reads entities, CDATA and comments, and a quoted ">" in an attribute', () => {
    const text = `<?xml version="1.0"?><!-- a > comment --><usx><book code="GEN" x="1 > 0"/><chapter number="1"/><para style="p"><verse number="1"/>&lt;b&gt; &#229;&#xe4;<![CDATA[<raw>]]></para></usx>`;

    expect(book('GEN.usx', text)?.verses).toEqual([[1, 1, '<b> åä<raw>']]);
  });
});

describe('a USFM book', () => {
  it('leaves out footnotes, cross references, headings and word attributes', () => {
    const text = `\\id MAT\n\\c 5\n\\s1 The Sermon\n\\p\n\\v 3 \\w Blessed|strong="G3107"\\w* are the poor\\x - \\xo 5:3 \\xt Luke 6:20\\x* in spirit,\n\\q2 for theirs is \\nd the Kingdom\\nd*.\n\\v 4-5 Blessed`;

    expect(book('MAT.usfm', text)).toEqual({ code: 'MAT', verses: [[5, 3, 'Blessed are the poor in spirit, for theirs is the Kingdom.'], [5, 4, 'Blessed']] });
  });
});
