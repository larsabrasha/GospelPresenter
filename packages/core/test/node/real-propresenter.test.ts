// Real ProPresenter files, opt in: set GP_REAL_PRO_DIR to a folder of `.pro` files to read them as
// the import does and check what comes out. Real songs are under copyright, so none is in the
// repository and this test asserts only counts and shape, never the text itself. Skipped when the
// variable is not set.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isProPresenterFile, parseProPresenter, type ImportedSong } from '../../src/index.ts';

const dir = process.env.GP_REAL_PRO_DIR;

describe.skipIf(!dir)('real ProPresenter files (GP_REAL_PRO_DIR)', () => {
  const read = () =>
    readdirSync(dir!)
      .filter(isProPresenterFile)
      .map((f) => ({ file: f, song: parseProPresenter(readFileSync(join(dir!, f)), f.replace(/\.pro$/i, '')) }));
  const songs = () => read().flatMap((r) => (r.song ? [r.song] : []));
  const texts = (all: ImportedSong[]) => all.flatMap((s) => s.parts.map((p) => p.content));

  it('reads nearly every file as a song', () => {
    const all = read();

    expect(songs().length / all.length).toBeGreaterThan(0.95);
  });

  it('gives no song the placeholder title when its file has a real name', () => {
    expect(songs().filter((s) => s.name === 'Untitled')).toHaveLength(0);
  });

  it('leaves no RTF in the text', () => {
    expect(texts(songs()).filter((t) => /[\\{}]/.test(t))).toHaveLength(0);
  });

  it('keeps at most one blank line between lines, and no spaces at a line end', () => {
    expect(texts(songs()).filter((t) => /\n{3,}|[ \t]+\n/.test(t))).toHaveLength(0);
  });
});
