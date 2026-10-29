import { useState, type KeyboardEvent } from 'react';

/**
 * Which arrows move a list: ↑ ↓ for a column, ← → for a row, all four for a
 * grid that flows (each arrow one step) (Utils/ListNavigation.cs).
 */
export type ListOrientation = 'vertical' | 'horizontal' | 'grid';

/**
 * Where an arrow, Home or End moves a list of `count` from `current` (-1 for
 * none yet), or null when the key does not move it. A modified key is someone
 * else's (the browser's word jump, a shortcut), so only the bare key moves.
 */
export function listMove(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, current: number, count: number, orientation: ListOrientation = 'vertical'): number | null {
  if (count <= 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  const forward = (e.key === 'ArrowDown' && orientation !== 'horizontal') || (e.key === 'ArrowRight' && orientation !== 'vertical');
  const backward = (e.key === 'ArrowUp' && orientation !== 'horizontal') || (e.key === 'ArrowLeft' && orientation !== 'vertical');
  let next: number;
  // From nothing, the first press lands on the first item (or the last, going back).
  if (forward) next = current < 0 ? 0 : Math.min(current + 1, count - 1);
  else if (backward) next = current < 0 ? count - 1 : Math.max(current - 1, 0);
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = count - 1;
  else return null;
  return next === current ? null : next;
}

/** Focuses the item with `data-nav-index` `index` in `container`, scrolling it just into view. */
export function focusNavItem(container: HTMLElement, index: number): void {
  const item = container.querySelector<HTMLElement>(`[data-nav-index="${index}"]`);
  if (!item) return;
  // focus() alone jumps the item to the middle of the viewport, which makes a long list lurch on every press.
  item.focus({ preventScroll: true });
  item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * A list Tab reaches as one stop, the arrows moving within it (a roving
 * tabindex, as the current app's lists): put `onKeyDown` on the container and
 * `item(i)` on each row. Focus by click or Tab moves the stop too.
 */
export function useRovingList(count: number, orientation: ListOrientation = 'vertical') {
  const [index, setIndex] = useState(-1);
  // A list that shrank (a sync removed rows) keeps its stop on a row that is still there.
  const stop = count <= 0 ? -1 : Math.min(Math.max(index, 0), count - 1);
  return {
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const next = listMove(e, index < 0 ? -1 : stop, count, orientation);
      if (next === null) return;
      e.preventDefault();
      setIndex(next);
      focusNavItem(e.currentTarget, next);
    },
    item: (i: number) => ({ 'data-nav-index': i, tabIndex: i === stop ? 0 : -1, onFocus: () => setIndex(i) }),
  };
}
