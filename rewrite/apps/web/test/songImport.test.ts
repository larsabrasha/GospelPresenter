import { describe, expect, it } from 'vitest';
import type { ImportedSong } from '@gp/core';
import { choicesFor, defaultChoice, importResult, importResultText, namesakes, planImport, sameText, songsToSend } from '../src/pages/songImport.ts';

const song = (name: string, verse = 'Ett'): ImportedSong => ({
  name,
  author: null,
  publisher: null,
  ccli: null,
  parts: [
    { labelText: 'Verse', content: verse },
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
    const plan = planImport([song('Äran'), song('ny'), song('NY')], [{ id: 'S1', name: 'äran', text: 'x' }], counter());

    expect(plan.duplicates.map((d) => [d.name, d.other.id])).toEqual([
      ['Äran', 'S1'],
      ['NY', null],
    ]);
  });

  it('marks a duplicate whose text is the same, and one whose text differs', () => {
    const plan = planImport([song('A'), song('B', 'Annan')], [{ id: 'SA', name: 'A', text: 'Ett\n\nTvå' }, { id: 'SB', name: 'B', text: 'Ett\n\nTvå' }], counter());

    expect(plan.duplicates.map((d) => d.same)).toEqual([true, false]);
  });

  it('compares with the library song of the same text when several have the name', () => {
    const plan = planImport([song('A')], [{ id: 'S1', name: 'A', text: 'Gammal' }, { id: 'S2', name: 'A', text: 'Ett Två' }], counter());

    expect(plan.duplicates[0]!.other.id).toBe('S2');
  });

  it('takes only the library songs whose name a read song has', () => {
    expect(namesakes([song('Äran')], [{ name: 'ÄRAN' }, { name: 'Annan' }])).toEqual([{ name: 'ÄRAN' }]);
  });
});

describe('comparing song text', () => {
  it('does not count spaces, line breaks or blank lines', () => {
    expect(sameText('Ett  två\n\n\ntre ', 'Ett två\ntre')).toBe(true);
  });

  it('counts a changed word', () => {
    expect(sameText('Ett två', 'Ett tre')).toBe(false);
  });
});

describe('choosing for a duplicate', () => {
  it('skips one with the same text and keeps one with other text beside the other, by default', () => {
    const plan = planImport([song('A'), song('B', 'Annan')], [{ id: 'SA', name: 'A', text: 'Ett\n\nTvå' }, { id: 'SB', name: 'B', text: 'x' }], counter());

    expect(plan.duplicates.map(defaultChoice)).toEqual(['skip', 'keep']);
  });

  it('offers replacing only a library song, not one met earlier in the import', () => {
    const plan = planImport([song('A'), song('a')], [{ id: 'SA', name: 'A', text: 'x' }], counter());

    expect(plan.duplicates.map(choicesFor)).toEqual([
      ['skip', 'replace', 'keep'],
      ['skip', 'keep'],
    ]);
  });

  it('sends a kept song as new, a replacing one naming the library song, and leaves a skipped one out', () => {
    const plan = planImport([song('A'), song('B'), song('C'), song('D')], [{ id: 'SA', name: 'A', text: 'x' }, { id: 'SB', name: 'B', text: 'x' }, { id: 'SC', name: 'C', text: 'x' }], counter());

    const sent = songsToSend(plan, ['skip', 'replace', 'keep']);

    expect(sent.map((s) => [s.name, s.replaces])).toEqual([
      ['B', 'SB'],
      ['C', null],
      ['D', null],
    ]);
  });
});

describe('the result line', () => {
  it('names each kind with its count, in singular or plural', () => {
    expect(importResultText({ created: 3, replaced: 1, skipped: 2, failed: 1 })).toBe('3 nya, 1 ersatt, 2 överhoppade (fanns redan), 1 fil saknade sångtext.');
  });

  it('says that nothing came in when nothing did', () => {
    expect(importResultText({ created: 0, replaced: 0, skipped: 0, failed: 0 })).toBe('Inga sånger kunde importeras.');
  });

  it('counts the duplicates by their choices, a kept one as new', () => {
    const plan = planImport([song('A'), song('B'), song('C'), song('D')], [{ id: 'SA', name: 'A', text: 'x' }, { id: 'SB', name: 'B', text: 'x' }, { id: 'SC', name: 'C', text: 'x' }], counter());

    expect(importResult(plan, ['skip', 'replace', 'keep'], 2)).toEqual({ created: 2, replaced: 1, skipped: 1, failed: 2 });
  });
});
