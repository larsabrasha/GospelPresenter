import { useLayoutEffect, useState, type RefObject } from 'react';

// A long list of rows of one height drawn only where it is seen (Lars, 2026-11-25: Lägg till sång's 900 songs took
// long on an iPhone before it would scroll, while they were drawn 300 at a time): the rows in view and a few on either
// side, with room kept above and below for the rest, so the list is as tall as it is and its scrollbar true. The box
// that scrolls is found, not named: the list itself on a computer, the column round it on a phone.

/** Whether `el` is a box that scrolls up and down. */
const scrolls = (el: HTMLElement) => /auto|scroll/.test(getComputedStyle(el).overflowY);

/** The box `list` scrolls in: itself, or the nearest one round it. */
function scrollerOf(list: HTMLElement): HTMLElement | null {
  for (let el: HTMLElement | null = list; el; el = el.parentElement) if (scrolls(el)) return el;
  return null;
}

/** Where the list's first row stands in its scroller's content. */
function listTop(list: HTMLElement, scroller: HTMLElement): number {
  return scroller === list ? 0 : list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

/**
 * The rows of `list` to draw, `start` to `end`, of `count` rows `rowHeight` high, `overscan` more on either side; and
 * `scrollTo`, which brings a row into view, drawn or not, and `toTop`.
 */
export function useWindowed(list: RefObject<HTMLElement | null>, count: number, rowHeight: number, overscan = 10) {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });
  useLayoutEffect(() => {
    const el = list.current;
    const scroller = el && scrollerOf(el);
    // No box scrolls it (not drawn yet): the first rows, as it starts, until it is.
    if (!el || !scroller) return;
    // At every scroll, not at the next frame: a window not in front (a hidden test window) draws no frames, and the
    // reckoning is a few numbers; the list is drawn again only when the rows to draw change.
    const measure = () => {
      const top = scroller.scrollTop - listTop(el, scroller);
      const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
      const end = Math.min(count, Math.ceil((top + scroller.clientHeight) / rowHeight) + overscan);
      setRange((was) => (was.start === start && was.end === end ? was : { start, end }));
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    const resized = new ResizeObserver(measure);
    resized.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', measure);
      resized.disconnect();
    };
  }, [list, count, rowHeight, overscan]);
  /** Row `index` brought just into view, as `scrollIntoView({ block: 'nearest' })` would, drawn or not. */
  const scrollTo = (index: number) => {
    const el = list.current;
    const scroller = el && scrollerOf(el);
    if (!el || !scroller) return;
    const top = listTop(el, scroller) + index * rowHeight;
    if (top < scroller.scrollTop) scroller.scrollTo({ top });
    else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTo({ top: top + rowHeight - scroller.clientHeight });
  };
  const toTop = () => {
    const el = list.current;
    const scroller = el && scrollerOf(el);
    scroller?.scrollTo({ top: 0 });
  };
  return { start: Math.min(range.start, count), end: Math.min(range.end, count), scrollTo, toTop };
}
