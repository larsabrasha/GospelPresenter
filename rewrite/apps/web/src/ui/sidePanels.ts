import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

// A presentation's side columns on a computer or an iPad lying down, folded away and out again as iPadOS's and macOS's
// sidebars: the running order at the left, the live column at the right (Lars, 2026-11-03). Each slides off its edge and
// back, by transform only as the live column's coming does (liveMotion.ts), the middle taking the room at once as it
// goes in and giving it back once it is out. Whether each is out is kept on this device.

const KEY = 'gp.sidePanels';
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const MS = 300;
/** The id of a fold's animation, so a fold cancels only its own. */
const FOLD = 'fold';

type Side = 'left' | 'right';
type Open = Record<Side, boolean>;

function stored(): Open {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Open>;
    return { left: v.left !== false, right: v.right !== false };
  } catch {
    return { left: true, right: true };
  }
}

/** Whether each column is out, a toggle for each, and a way to bring one out; kept on this device. */
export function useSidePanels() {
  const [open, setOpen] = useState(stored);
  const set = useCallback((side: Side, out: (was: boolean) => boolean) => {
    setOpen((o) => {
      const next = { ...o, [side]: out(o[side]) };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Not kept: it holds until the page closes.
      }
      return next;
    });
  }, []);
  const toggle = useCallback((side: Side) => set(side, (was) => !was), [set]);
  const show = useCallback((side: Side) => set(side, () => true), [set]);
  return { open, toggle, show };
}

/**
 * Folds `el` off its `side` edge, or brings it back. It leaves the layout (display: none) rather than the page, so its
 * scroll and state stay for when it comes back. `animate` false at once.
 */
function fold(el: HTMLElement, side: Side, open: boolean, animate: boolean) {
  // Only its own: the live column's coming in on a start (liveMotion.ts) runs on the same element.
  el.getAnimations().forEach((a) => a.id === FOLD && a.cancel());
  if (!animate) {
    el.style.display = open ? '' : 'none';
    return;
  }
  const away: Keyframe = { transform: `translateX(${side === 'left' ? '-100%' : '100%'})` };
  const home: Keyframe = { transform: 'translateX(0)' };
  // Its row clipped meanwhile, so the page never scrolls sideways.
  const row = el.parentElement;
  if (row) row.style.overflowX = 'clip';
  // Coming out it takes its room in this same frame; going in it keeps it until it is off the edge, and stays there
  // (`forwards`) until it is out of the layout.
  if (open) el.style.display = '';
  const slide = el.animate(open ? [away, home] : [home, away], { id: FOLD, duration: MS, easing: EASE, fill: open ? 'none' : 'forwards' });
  void slide.finished
    .then(
      () => {
        if (!open) el.style.display = 'none';
      },
      () => undefined,
    )
    .finally(() => {
      if (row) row.style.overflowX = '';
    });
}

/** Folds `panel` off its `side` while `open` is false, and back; at once on its first render and where less motion is wished. */
export function useFold(panel: RefObject<HTMLElement | null>, side: Side, open: boolean) {
  const was = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || was.current === open) return;
    const first = was.current === null;
    was.current = open;
    fold(el, side, open, !first && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, [panel, side, open]);
}
