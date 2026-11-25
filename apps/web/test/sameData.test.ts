// A data hook keeps its value when a reload gives the same data (db/react.tsx `sameData`): a page draws nothing again
// for a change that did not touch what it shows.
import { describe, expect, it } from 'vitest';
import { sameData } from '../src/db/react.tsx';

describe('sameData', () => {
  it('takes two loads of the same rows as the same', () => {
    const load = () => ({ items: [{ id: 'i1', title: 'Psalm', sort: 0, note: null }], theme: { name: 'Mörkt' } });

    expect(sameData(load(), load())).toBe(true);
  });

  it('tells a changed field apart', () => {
    const before = { items: [{ id: 'i1', title: 'Psalm' }] };

    expect(sameData(before, { items: [{ id: 'i1', title: 'Psalm 2' }] })).toBe(false);
  });

  it('tells a row more or less apart', () => {
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
  });

  it('compares maps by their entries', () => {
    const labels = () => new Map([['l1', { text: 'Vers', color: '#00f' }]]);

    expect([sameData(labels(), labels()), sameData(labels(), new Map([['l1', { text: 'Refräng', color: '#00f' }]]))]).toEqual([true, false]);
  });

  it('tells undefined from a first load apart', () => {
    expect(sameData(undefined, [])).toBe(false);
  });
});
