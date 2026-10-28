import { describe, expect, it } from 'vitest';
import { dropIndex } from '../src/ui/sortable.ts';

// Four rows 40 px high with centres at 20, 60, 100 and 140.
const mids = [20, 60, 100, 140];

describe('where a dragged row lands', () => {
  it('stays in its place until its centre crosses the next row’s centre', () => {
    expect(dropIndex(mids, 1, 99)).toBe(1);
  });

  it('passes every row whose centre it has crossed going down', () => {
    expect(dropIndex(mids, 0, 101)).toBe(2);
  });

  it('passes every row whose centre it has crossed going up', () => {
    expect(dropIndex(mids, 3, 59)).toBe(1);
  });

  it('stops at the first and the last place when dragged past the ends', () => {
    expect(dropIndex(mids, 2, -500)).toBe(0);
    expect(dropIndex(mids, 1, 5000)).toBe(3);
  });
});
