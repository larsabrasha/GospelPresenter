import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { followsShown } from '../../live/liveList.ts';

/**
 * How a list of slides scrolls while presenting, the same on a computer and a phone: to the slide shown (it carries
 * `data-current="true"`; before presenting the one picked, `data-picked="true"`), once for each slide shown, there at once on opening and glided to after (Lars,
 * 2026-11-02), unless it was tapped where it already shows (liveList.ts `followsShown`); and to an item's section
 * (`data-item`) each time a new `toItem` is given, the same item chosen again too. `margin` is the room kept above the
 * slide under its section's sticky heading. Returns what to call when a tap shows a slide.
 */
export function useFollowShown(box: RefObject<HTMLElement | null>, shownKey: string, margin: number, toItem: { id: string } | null) {
  const tapped = useRef(false);
  const followed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (followed.current === shownKey) return;
    const opening = followed.current === null;
    followed.current = shownKey;
    const el = box.current;
    const slide = el?.querySelector<HTMLElement>('[data-current="true"], [data-picked="true"]');
    const byTap = tapped.current;
    tapped.current = false;
    if (!el || !slide) return;
    const top = slide.getBoundingClientRect().top - el.getBoundingClientRect().top;
    // The sticky heading as it is drawn (an item's … makes it taller), so the slide's ring is never under it.
    const heading = slide.closest('section')?.querySelector('h3')?.offsetHeight ?? 0;
    if (followsShown({ byTap, top, bottom: top + slide.offsetHeight, viewHeight: el.clientHeight, headingHeight: heading }))
      el.scrollTo({ top: el.scrollTop + top - heading - margin, behavior: opening ? 'instant' : 'smooth' });
  }, [box, shownKey, margin]);

  useEffect(() => {
    const el = box.current;
    const section = toItem ? el?.querySelector<HTMLElement>(`[data-item="${toItem.id}"]`) : null;
    if (el && section) el.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
  }, [box, toItem]);

  return () => {
    tapped.current = true;
  };
}
