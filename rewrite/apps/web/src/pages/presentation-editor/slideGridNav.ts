/** A slide's tile as it stands on the page: its name (`itemId/part`) and its box. */
export interface PlacedSlide {
  key: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Tiles whose tops are this close are on one row. */
const ROW_SLACK = 4;

/**
 * The slide above (`dir` -1) or below (1) `from`, as the tiles stand on the page (Lars, 2026-11-07, as Finder's icons):
 * the nearest row that way, and in it the one most nearly under or over it; past the first or last row, none. With
 * nothing to start from, the first slide going down, the last going up.
 */
export function slideAcross(tiles: readonly PlacedSlide[], from: string | null, dir: 1 | -1): string | null {
  const start = tiles.find((x) => x.key === from);
  if (!start) return (dir > 0 ? tiles[0] : tiles.at(-1))?.key ?? null;
  const ahead = tiles.filter((x) => (dir > 0 ? x.top >= start.bottom - ROW_SLACK : x.bottom <= start.top + ROW_SLACK));
  if (!ahead.length) return null;
  const rowTop = dir > 0 ? Math.min(...ahead.map((x) => x.top)) : Math.max(...ahead.map((x) => x.top));
  const row = ahead.filter((x) => Math.abs(x.top - rowTop) <= ROW_SLACK);
  const centre = (x: PlacedSlide) => (x.left + x.right) / 2;
  return row.reduce((best, x) => (Math.abs(centre(x) - centre(start)) < Math.abs(centre(best) - centre(start)) ? x : best)).key;
}

/** The slides' tiles on the page now, in order. */
export function placedSlides(): PlacedSlide[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slide]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { key: el.dataset.slide!, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}
