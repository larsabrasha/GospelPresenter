// The rules the older TS modules and the views ported back from Rust had each their own copy of, one now (step 5,
// round 6, docs/core-back-to-typescript.md): a text's length in characters, the app's JSON read strictly
// (stored-json.ts), the order of a song's arrangements and where a word starts.
import { describe, expect, it } from 'vitest';
import { customPageSchema, imageItemIds, parseCustomPage, parseCustomPages, parsePartIds, prepareSong, rankSongs, sortedArrangements, type SongArrangement } from '../src/index.ts';
import { searchMarks } from '../src/core.ts';

describe("a text's length", () => {
  const withText = (text: string) => ({ background: null, backgroundPicture: null, backgroundPage: null, elements: [{ id: 't', kind: 'text', x: 0, y: 0, w: 10, h: 10, text, size: 40, bold: false, italic: false, align: 'left', color: null }] });

  it("counts a page's text in characters, so 2 000 emoji are taken", () => {
    const read = customPageSchema.safeParse(withText('😀'.repeat(2000)));

    expect(read.success).toBe(true);
  });
});

describe('the JSON the app keeps', () => {
  it("reads an arrangement's part ids with half a surrogate pair as none", () => {
    const ids = parsePartIds('["a", "\\ud800"]');

    expect(ids).toEqual([]);
  });

  it("takes an image item's picture id of 64 emoji, 64 characters", () => {
    const id = '😀'.repeat(64);

    const ids = imageItemIds({ sourceId: 'first', content: JSON.stringify({ images: [id] }) });

    expect(ids).toEqual([id]);
  });

  it('reads an overlay page with half a surrogate pair in a key as a blank page', () => {
    const stored = '{"background": "#ff0000", "backgroundPicture": null, "backgroundPage": null, "elements": [], "\\udc00": 1}';

    const page = parseCustomPage(stored);

    expect(page.background).toBeNull();
  });

  it('reads an overlay page with an element of a kind it does not know without that element, the rest kept', () => {
    const text = { id: 't', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'Swish', size: 40, bold: false, italic: false, align: 'left', color: null };
    const stored = JSON.stringify({ background: '#ff0000', backgroundPicture: null, backgroundPage: null, elements: [{ id: 's', kind: 'star', x: 0, y: 0, w: 10, h: 10 }, text] });

    const page = parseCustomPage(stored);

    expect([page.background, page.elements.map((e) => e.id)]).toEqual(['#ff0000', ['t']]);
  });

  it("reads a slideshow's pages with an element that does not read without that element, every page kept", () => {
    const blank = { background: null, backgroundPicture: null, backgroundPage: null };
    const stored = JSON.stringify([
      { ...blank, elements: [{ id: 'bad', kind: 'text', x: 0, y: 0, w: 10, h: 10 }] },
      { ...blank, background: '#000000', elements: [] },
    ]);

    const pages = parseCustomPages(stored);

    expect(pages.map((p) => [p.background, p.elements.length])).toEqual([
      [null, 0],
      ['#000000', 0],
    ]);
  });

  it('reads an overlay page nested 128 levels deep as a blank page', () => {
    const deep = `${'['.repeat(127)}${']'.repeat(127)}`;
    const stored = `{"background": "#ff0000", "backgroundPicture": null, "backgroundPage": null, "elements": [], "x": ${deep}}`;

    const page = parseCustomPage(stored);

    expect(page.background).toBeNull();
  });
});

describe("a song's arrangements (SONG-R19)", () => {
  const arrangement = (id: string, sort: number): SongArrangement => ({ id, songId: 's', name: null, partIds: '[]', sort });

  it('orders arrangements of the same sort by id code point by code point, capitals first', () => {
    const sorted = sortedArrangements([arrangement('b', 0), arrangement('B', 0)], 's');

    expect(sorted.map((a) => a.id)).toEqual(['B', 'b']);
  });

  it('puts an arrangement whose sort is not a whole number first', () => {
    const sorted = sortedArrangements([arrangement('a', 0), arrangement('b', 0.5)], 's');

    expect(sorted.map((a) => a.id)).toEqual(['b', 'a']);
  });
});

describe('where a word starts (SONG-R31, SONG-A20)', () => {
  it('finds and marks a term right after a letter past the BMP alike', () => {
    const song = { name: '𝐱abc', author: null, firstPart: '', lyrics: '' };

    const [found, marks] = [rankSongs([song], prepareSong, 'abc'), searchMarks('𝐱abc', 'abc')];

    expect([found, marks]).toEqual([[song], [{ text: '𝐱', hit: false }, { text: 'abc', hit: true }]]);
  });
});
