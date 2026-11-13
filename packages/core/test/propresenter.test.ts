import { describe, expect, it } from 'vitest';
import { isProPresenterFile, parseProPresenter, rtfToPlainText, songNameKey } from '../src/index.ts';
import { pro, rtf, type Spec } from './pro-fixture.ts';

const oneSlide = (name?: string, ccli?: Spec['ccli']) => pro({ name, ccli, groups: [{ id: 'g1', name: 'Verse 1', slides: ['Text'] }] });

describe('a ProPresenter file as a song', () => {
  it('takes the title, author, publisher and CCLI number from the file', () => {
    const song = parseProPresenter(oneSlide('Hos Dig', { author: 'R. Gunnargard', publisher: 'Förlaget', number: 1234567 }), 'Hos Dig');

    expect(song).toMatchObject({ name: 'Hos Dig', author: 'R. Gunnargard', publisher: 'Förlaget', ccli: '1234567' });
  });

  it.each(['Untitled', 'untitled', 'Untitled 2', 'Untitled-1', '   ', ''])('takes the file name when the file names itself %j', (placeholder) => {
    const song = parseProPresenter(oneSlide(placeholder), 'Hos Dig');

    expect(song?.name).toBe('Hos Dig');
  });

  it('takes the CCLI title when neither the file nor its name has a real title', () => {
    const song = parseProPresenter(oneSlide('Untitled', { title: 'Pappa' }), 'Untitled 3');

    expect(song?.name).toBe('Pappa');
  });

  it('is called Untitled when no title is anywhere', () => {
    expect(parseProPresenter(oneSlide('Untitled'), null)?.name).toBe('Untitled');
  });

  it('makes one part per slide with text, labelled by its group, in file order, leaving out slides without text', () => {
    const data = pro({
      name: 'Sång',
      groups: [
        { id: 'v', name: 'Verse 1', slides: ['Ett', null, 'Två'] },
        { id: 'c', name: 'Chorus', slides: ['Tre'] },
      ],
    });

    const song = parseProPresenter(data, 'Sång');

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

    const song = parseProPresenter(data, 'Sång');

    expect(song?.arrangements).toEqual([{ name: 'Kort', partIndexes: [2, 0, 1, 2] }]);
  });

  it('is no song when no slide has text, as a file with only empty text boxes', () => {
    expect(parseProPresenter(pro({ name: 'Bild', groups: [{ id: 'g', name: 'Verse', slides: [''] }] }), 'Bild')).toBeNull();
  });

  it('is no song when the file is not a ProPresenter file', () => {
    expect(parseProPresenter(new Uint8Array([0xff, 0xff, 0xff, 0x0f, 1, 2]), 'x')).toBeNull();
  });

  it('stores decomposed names composed, as macOS writes them', () => {
    const song = parseProPresenter(oneSlide('Äran och makten'.normalize('NFD'), { author: 'Björn'.normalize('NFD') }), 'x');

    expect([song?.name, song?.author]).toEqual(['Äran och makten', 'Björn']);
  });

  it('keeps the first 50 parts of a longer song', () => {
    const slides = Array.from({ length: 60 }, (_, i) => `Rad ${i}`);

    const song = parseProPresenter(pro({ name: 'Lång', groups: [{ id: 'g', name: 'Verse', slides }] }), 'Lång');

    expect([song?.parts.length, song?.parts.at(-1)?.content]).toEqual([50, 'Rad 49']);
  });
});

describe("a slide's RTF as plain text", () => {
  it('decodes Windows-1252 escapes', () => {
    expect(rtfToPlainText(rtf(["N\\'e5d \\'f6ver n\\'e5d \\'96 \\'93s\\'e5\\'94"]))).toBe('Nåd över nåd – “så”');
  });

  it('makes a line separator escape a line break, skipping no fallback under \\uc0', () => {
    expect(rtfToPlainText(rtf(['\\uc0 Ett\\u8232 två']))).toBe('Ett\ntvå');
  });

  it('skips the fallback character after a \\u escape by default', () => {
    expect(rtfToPlainText(rtf(['Gr\\u252?n']))).toBe('Grün');
  });

  it('keeps one blank line between stanzas, but no more, and no spaces at line ends', () => {
    expect(rtfToPlainText(rtf(['Ett  ', '', '', '', 'Två']))).toBe('Ett\n\nTvå');
  });

  it('leaves out the font and colour tables', () => {
    expect(rtfToPlainText(rtf(['Text']))).toBe('Text');
  });
});

describe('importing', () => {
  it('considers only files whose name ends in .pro, in any case', () => {
    expect(['a.pro', 'B.PRO', 'c.pro6', 'd.txt'].map(isProPresenterFile)).toEqual([true, true, false, false]);
  });

  it('compares song names without regard to case or Unicode composition', () => {
    expect(songNameKey(' Äran Och Makten ')).toBe(songNameKey('äran och makten'.normalize('NFD')));
  });
});
