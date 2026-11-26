import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { followsShown } from '../../live/liveList.ts';

/**
 * How a list of slides scrolls while presenting, the same on a computer and a phone: to the slide shown (it carries
 * `data-current="true"`; before presenting the one picked, `data-picked="true"`), once for each slide shown, there at once on opening and glided to after (Lars,
 * 2026-11-02), unless it was tapped where it already shows (liveList.ts `followsShown`); and at once to an item's
 * section (`data-item`) each time a new `toItem` is given, the same item chosen again too. `margin` is the room kept above the
 * slide under its section's sticky heading. With `hold` (a phone's user looking at another item, Lars 2026-11-26) a
 * new slide shown is not followed. Returns what to call when a tap shows a slide.
 */
export function useFollowShown(box: RefObject<HTMLElement | null>, shownKey: string, margin: number, toItem: { id: string } | null, hold = false) {
  const tapped = useRef(false);
  const followed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (followed.current === shownKey) return;
    const opening = followed.current === null;
    followed.current = shownKey;
    const el = box.current;
    // The outlined slide when it is the one followed: while presenting the shown one is there too, outlined in red.
    const slide = el?.querySelector<HTMLElement>(shownKey.startsWith('picked:') ? '[data-picked="true"]' : '[data-current="true"], [data-picked="true"]');
    const byTap = tapped.current;
    tapped.current = false;
    if (!el || !slide || (hold && !opening)) return;
    const top = slide.getBoundingClientRect().top - el.getBoundingClientRect().top;
    // The sticky heading as it is drawn (an item's … makes it taller), so the slide's ring is never under it.
    const heading = slide.closest('section')?.querySelector<HTMLElement>('[data-heading]')?.offsetHeight ?? 0;
    if (followsShown({ byTap, top, bottom: top + slide.offsetHeight, viewHeight: el.clientHeight, headingHeight: heading }))
      el.scrollTo({ top: el.scrollTop + top - heading - margin, behavior: opening ? 'instant' : 'smooth' });
  }, [box, shownKey, margin, hold]);

  useEffect(() => {
    const el = box.current;
    const section = toItem ? el?.querySelector<HTMLElement>(`[data-item="${toItem.id}"]`) : null;
    // There at once, not glided: an item chosen in the running order jumps to its slides (Lars, 2026-11-24).
    if (el && section) el.scrollTo({ top: section.offsetTop, behavior: 'instant' });
  }, [box, toItem]);

  return () => {
    tapped.current = true;
  };
}
