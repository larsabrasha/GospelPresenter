// A ProPresenter 7 file as a song (`proPresenterSongView`, spec 02 SONG-R35–R43): the tests of 2.0's TS
// parseProPresenter and rtfToPlainText, moved here with it; the RTF read through a file holding one slide.
import { describe, expect, it } from 'vitest';
import { nodeRustCore } from '../src/node.ts';
import { pro, type Spec } from './pro-fixture.ts';

interface Song {
  name: string;
  author: string | null;
  publisher: string | null;
  ccli: string | null;
  parts: { labelText: string | null; content: string }[];
  arrangements: { name: string | null; partIndexes: number[] }[];
}

const read = (data: Uint8Array, fileName: string | null) =>
  nodeRustCore().pure<Song | null>('proPresenterSongView', { data: Buffer.from(data).toString('base64'), fileName });
const oneSlide = (name?: string, ccli?: Spec['ccli']) => pro({ name, ccli, groups: [{ id: 'g1', name: 'Verse 1', slides: ['Text'] }] });
/** A slide's text after RTF, as a file of one slide holding these lines reads. */
const plain = (lines: string[]) => read(pro({ name: 'x', groups: [{ id: 'g', name: 'Verse', slides: [lines.join('\n')] }] }), 'x')?.parts[0]?.content;

describe('a ProPresenter file as a song', () => {
  it('takes the title, author, publisher and CCLI number from the file', () => {
    const song = read(oneSlide('Hos Dig', { author: 'R. Gunnargard', publisher: 'Förlaget', number: 1234567 }), 'Hos Dig');

    expect(song).toMatchObject({ name: 'Hos Dig', author: 'R. Gunnargard', publisher: 'Förlaget', ccli: '1234567' });
  });

  it.each(['Untitled', 'untitled', 'Untitled 2', 'Untitled-1', '   ', ''])('takes the file name when the file names itself %j', (placeholder) => {
    const song = read(oneSlide(placeholder), 'Hos Dig');

    expect(song?.name).toBe('Hos Dig');
  });

  it('takes the CCLI title when neither the file nor its name has a real title', () => {
    const song = read(oneSlide('Untitled', { title: 'Pappa' }), 'Untitled 3');

    expect(song?.name).toBe('Pappa');
  });

  it('is called Untitled when no title is anywhere', () => {
    expect(read(oneSlide('Untitled'), null)?.name).toBe('Untitled');
  });

  it('makes one part per slide with text, labelled by its group, in file order, leaving out slides without text', () => {
    const data = pro({
      name: 'Sång',
      groups: [
        { id: 'v', name: 'Verse 1', slides: ['Ett', null, 'Två'] },
        { id: 'c', name: 'Chorus', slides: ['Tre'] },
      ],
    });

    const song = read(data, 'Sång');

    expect(song?.parts).toEqual([
      { labelText: 'Verse 1', content: 'Ett' },
      { labelText: 'Verse 1', content: 'Två' },
      { labelText: 'Chorus', content: 'Tre' },
    ]);
  });

  it('turns an arrangement of groups into one of all their parts, dropping an empty one', () => {
    const data = pro({
      name: 'Sång',
      groups: [
        { id: 'v', name: 'Verse', slides: ['A', 'B'] },
        { id: 'c', name: 'Chorus', slides: ['C'] },
      ],
      arrangements: [
        { name: 'Kort', groups: ['c', 'v', 'c'] },
        { name: 'Tom', groups: ['nowhere'] },
      ],
    });

    const song = read(data, 'Sång');

    expect(song?.arrangements).toEqual([{ name: 'Kort', partIndexes: [2, 0, 1, 2] }]);
  });

  it('is no song when no slide has text, as a file with only empty text boxes', () => {
    expect(read(pro({ name: 'Bild', groups: [{ id: 'g', name: 'Verse', slides: [''] }] }), 'Bild')).toBeNull();
  });

  it('is no song when the file is not a ProPresenter file', () => {
    expect(read(new Uint8Array([0xff, 0xff, 0xff, 0x0f, 1, 2]), 'x')).toBeNull();
  });

  it('stores decomposed names composed, as macOS writes them', () => {
    const song = read(oneSlide('Äran och makten'.normalize('NFD'), { author: 'Björn'.normalize('NFD') }), 'x');

    expect([song?.name, song?.author]).toEqual(['Äran och makten', 'Björn']);
  });

  it('keeps the first 50 parts of a longer song', () => {
    const slides = Array.from({ length: 60 }, (_, i) => `Rad ${i}`);

    const song = read(pro({ name: 'Lång', groups: [{ id: 'g', name: 'Verse', slides }] }), 'Lång');

    expect([song?.parts.length, song?.parts.at(-1)?.content]).toEqual([50, 'Rad 49']);
  });

  it('writes a CCLI number past 2⁵³ as JavaScript writes it, its shortest digits filled out with zeros', () => {
    const song = read(oneSlide('x', { number: 2 ** 65 }), 'x');

    expect(song?.ccli).toBe(String(2 ** 65));
  });
});

describe("a slide's RTF as plain text", () => {
  it('decodes Windows-1252 escapes', () => {
    expect(plain(["N\\'e5d \\'f6ver n\\'e5d \\'96 \\'93s\\'e5\\'94"])).toBe('Nåd över nåd – “så”');
  });

  it('makes a line separator escape a line break, skipping no fallback under \\uc0', () => {
    expect(plain(['\\uc0 Ett\\u8232 två'])).toBe('Ett\ntvå');
  });

  it('skips the fallback character after a \\u escape by default', () => {
    expect(plain(['Gr\\u252?n'])).toBe('Grün');
  });

  it('keeps one blank line between stanzas, but no more, and no spaces at line ends', () => {
    expect(plain(['Ett  ', '', '', '', 'Två'])).toBe('Ett\n\nTvå');
  });

  it('leaves out the font and colour tables', () => {
    expect(plain(['Text'])).toBe('Text');
  });
});
