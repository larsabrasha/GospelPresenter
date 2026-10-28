import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

// Drag to reorder a vertical list, as the current app's SortableJS lists (utils.js
// initSortableList): by mouse at once, by touch after holding still for 150 ms
// (so a swipe still scrolls), the other rows making room as the row passes. It is
// plain pointer events: the rows stay React's, and a drop only reports `from` and
// `to` for the caller to save through its mutator, as a click on ↑ or ↓ would.

/** How long a finger holds still before a drag starts, and how far it may move meanwhile (SortableJS's delay, touchStartThreshold). */
const TOUCH_DELAY = 150;
const TOUCH_SLOP = 5;
/** How near the edge of the scrolling box the pointer scrolls it, and how fast (SortableJS's scrollSensitivity, scrollSpeed). */
const EDGE = 30;
const SPEED = 10;

/**
 * Where a row dragged from `from` lands: `mids` are the rows' vertical centres
 * when the drag started, `y` the dragged row's centre now, in the same frame.
 * It passes a row once its centre crosses that row's centre.
 */
export function dropIndex(mids: readonly number[], from: number, y: number): number {
  let to = from;
  while (to + 1 < mids.length && mids[to + 1]! < y) to++;
  while (to - 1 >= 0 && mids[to - 1]! > y) to--;
  return to;
}

interface Drag {
  from: number;
  to: number;
  /** How far the dragged row is drawn from its place. */
  dy: number;
  /** How far the rows it passes move to make room: its height and the gap. */
  step: number;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Drag to reorder the rows of `listRef`'s element: its direct children marked
 * `data-sort-row`, in order. A row's handle gets `handle(i)`; the row gets
 * `rowStyle(i)`. A pointer down on a button or link inside the handle is left
 * to it. Escape cancels a drag.
 */
export function useSortable<T extends HTMLElement>(onMove: (from: number, to: number) => void) {
  const listEl = useRef<T | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const active = useRef(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const listRef = useCallback((el: T | null) => {
    listEl.current = el;
    if (!el) return;
    // A finger that drags must not scroll the page. This listener is there before
    // the touch starts (and not passive), or the browser would already be panning.
    const onTouchMove = (e: TouchEvent) => {
      if (active.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchmove', onTouchMove);
      listEl.current = null;
    };
  }, []);

  const start = (e: ReactPointerEvent<HTMLElement>, from: number) => {
    const list = listEl.current;
    if (!list || stop.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const control = (e.target as Element).closest('button, a, input, textarea, select');
    if (control && e.currentTarget.contains(control)) return;
    const rows = [...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.sortRow !== undefined);
    const rects = rows.map((r) => r.getBoundingClientRect());
    const own = rects[from];
    if (!own) return;
    if (e.pointerType === 'mouse') e.preventDefault(); // no text selection while dragging

    const mids = rects.map((r) => r.top + r.height / 2);
    const gap = rects.length > 1 ? rects[1]!.top - rects[0]!.bottom : 0;
    const step = own.height + gap;
    const listTop = list.getBoundingClientRect().top;
    const startY = e.clientY;
    const startX = e.clientX;
    const pointerId = e.pointerId;
    const scroller = scrollParent(list);
    let y = startY;
    let to = from;
    let frame = 0;

    const update = () => {
      // The list may have scrolled since the start; the row follows the pointer, not the list.
      const dy = y - startY - (list.getBoundingClientRect().top - listTop);
      to = dropIndex(mids, from, mids[from]! + dy);
      setDrag({ from, to, dy, step });
    };
    const scroll = () => {
      frame = requestAnimationFrame(scroll);
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const by = y < box.top + EDGE ? -SPEED : y > box.bottom - EDGE ? SPEED : 0;
      if (!by) return;
      const before = scroller.scrollTop;
      scroller.scrollTop += by;
      if (scroller.scrollTop !== before) update();
    };
    const begin = () => {
      active.current = true;
      update();
      frame = requestAnimationFrame(scroll);
    };

    const timer = e.pointerType === 'touch' ? setTimeout(begin, TOUCH_DELAY) : 0;
    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      y = ev.clientY;
      if (active.current) update();
      else if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > TOUCH_SLOP) end(false); // a swipe: let it scroll
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(active.current && to !== from);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    const onContextMenu = (ev: Event) => {
      if (active.current) ev.preventDefault(); // a long press on a tablet
    };
    const end = (moved: boolean) => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      removeEventListener('pointermove', onPointerMove);
      removeEventListener('pointerup', onPointerUp);
      removeEventListener('pointercancel', onCancel);
      removeEventListener('keydown', onKey, true);
      removeEventListener('contextmenu', onContextMenu, true);
      active.current = false;
      stop.current = null;
      setDrag(null);
      if (moved) onMove(from, to);
    };
    stop.current = () => end(false);
    addEventListener('pointermove', onPointerMove);
    addEventListener('pointerup', onPointerUp);
    addEventListener('pointercancel', onCancel);
    addEventListener('keydown', onKey, true);
    addEventListener('contextmenu', onContextMenu, true);
    if (e.pointerType !== 'touch') begin();
  };

  /** The style that draws row `i` while a drag is on: the dragged row under the pointer, the rows it passed moved aside. */
  const rowStyle = (i: number): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, position: 'relative', zIndex: 10 };
    const shift = drag.from < i && i <= drag.to ? -drag.step : drag.to <= i && i < drag.from ? drag.step : 0;
    return { transform: shift ? `translateY(${shift}px)` : undefined, transition: 'transform 150ms' };
  };

  return {
    listRef,
    /** The list's element, once it is there. */
    list: listEl,
    /** The index of the row being dragged, or null. */
    dragging: drag?.from ?? null,
    rowStyle,
    handle: (i: number) => ({ onPointerDown: (e: ReactPointerEvent<HTMLElement>) => start(e, i) }),
  };
}
