import { pageCore } from '../../db/pageCore.ts';

/** A slide's tile as it stands on the page: its name (`itemId/part`) and its box. */
export interface PlacedSlide {
  key: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The slide above (`dir` -1) or below (1) `from`, as the tiles stand on the page (Lars, 2026-11-07, as Finder's icons):
 * the core's rule (`slideAcrossView`), the same in every shell; past the first or last row, none.
 */
export function slideAcross(tiles: readonly PlacedSlide[], from: string | null, dir: 1 | -1): string | null {
  return pageCore().pure<{ key: string | null }>('slideAcrossView', { tiles, from, dir }).key;
}

/** The slides' tiles on the page now, in order. */
export function placedSlides(): PlacedSlide[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slide]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { key: el.dataset.slide!, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}
