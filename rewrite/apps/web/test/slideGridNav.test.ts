import { describe, expect, it } from 'vitest';
import { slideAcross, type PlacedSlide } from '../src/pages/presentation-editor/slideGridNav.ts';

/** Three tiles to a row, 100 wide and 60 high with gaps of 10, as a song's slides stand; `n` of them from row `row0`. */
function grid(item: string, n: number, row0 = 0): PlacedSlide[] {
  return Array.from({ length: n }, (_, i) => {
    const left = (i % 3) * 110;
    const top = (row0 + Math.floor(i / 3)) * 70;
    return { key: `${item}/${i}`, left, top, right: left + 100, bottom: top + 60 };
  });
}

describe('the arrows up and down through the slides as they stand', () => {
  it('goes to the slide under it on the next row', () => {
    expect(slideAcross(grid('A', 6), 'A/1', 1)).toBe('A/4');
  });

  it('goes to the slide over it on the row before', () => {
    expect(slideAcross(grid('A', 6), 'A/5', -1)).toBe('A/2');
  });

  it('goes to the nearest one across on a shorter row', () => {
    expect(slideAcross(grid('A', 4), 'A/2', 1)).toBe('A/3');
  });

  it('goes on into the next item’s first row', () => {
    const tiles = [...grid('A', 3), ...grid('B', 3, 2)];

    expect(slideAcross(tiles, 'A/0', 1)).toBe('B/0');
  });

  it('stays at the last row going down', () => {
    expect(slideAcross(grid('A', 6), 'A/4', 1)).toBeNull();
  });

  it('starts at the first slide going down, the last going up, from nowhere', () => {
    expect(slideAcross(grid('A', 6), null, 1)).toBe('A/0');
    expect(slideAcross(grid('A', 6), null, -1)).toBe('A/5');
  });
});
