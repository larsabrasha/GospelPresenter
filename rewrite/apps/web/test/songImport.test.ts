import { describe, expect, it } from 'vitest';
import type { ImportedSong } from '@gp/core';
import { importResult, importResultText, planImport } from '../src/pages/songImport.ts';

const song = (name: string): ImportedSong => ({
  name,
  author: null,
  publisher: null,
  ccli: null,
  parts: [
    { labelText: 'Verse', content: 'Ett' },
    { labelText: 'Chorus', content: 'Två' },
  ],
  arrangements: [{ name: 'Baklänges', partIndexes: [1, 0, 1] }],
});

const counter = () => {
  let n = 0;
  return () => `id${n++}`;
};

describe('planning a ProPresenter import', () => {
  it("names an arrangement's parts by the ids the parts get", () => {
    const plan = planImport([song('Ny')], [], counter());

    const [s] = plan.songs;
    expect(s!.arrangements[0]!.partIds).toEqual([s!.parts[1]!.id, s!.parts[0]!.id, s!.parts[1]!.id]);
  });

  it('counts as duplicates the names the library has, whatever their case, and a name met earlier in the import', () => {
    const plan = planImport([song('Äran'), song('ny'), song('NY')], ['äran'], counter());

    expect(plan.duplicates).toEqual(['Äran', 'NY']);
  });
});

describe('the result line', () => {
  it('names each kind with its count, in singular or plural', () => {
    expect(importResultText({ created: 3, replaced: 1, skipped: 2, failed: 1 })).toBe('3 nya, 1 ersatt, 2 överhoppade (fanns redan), 1 fil saknade sångtext.');
  });

  it('says that nothing came in when nothing did', () => {
    expect(importResultText({ created: 0, replaced: 0, skipped: 0, failed: 0 })).toBe('Inga sånger kunde importeras.');
  });

  it('counts the duplicates as replaced or skipped by the answer', () => {
    const plan = planImport([song('A'), song('B')], ['a'], counter());

    expect([importResult(plan, true, 0), importResult(plan, false, 2)]).toEqual([
      { created: 1, replaced: 1, skipped: 0, failed: 0 },
      { created: 1, replaced: 0, skipped: 1, failed: 2 },
    ]);
  });
});
