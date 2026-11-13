import { useLayoutEffect, type RefObject } from 'react';

// The live picture coming and going when this window starts or ends a presentation (Lars, 2026-11-03: "Mjuk", of the
// variants tried): its area takes its room first (on a phone what follows the picture's block slides down, on a
// computer the live column slides in from the right as a macOS sidebar), then the picture fades in out of a slight
// blur; ending, the picture fades out first, then the area gives its room back, and only then does the presentation
// end. Only transform and opacity move, so the graphics card draws it (Lars, 2026-11-03). Opening a presentation that
// is already live shows it at once, and so does a wish for less motion.

/** Ease in and out, slow at both ends (Lars, 2026-11-03), for the area and the picture alike. */
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const OPEN_MS = 340;
const IN_MS = 380;
const OUT_MS = 320;
const CLOSE_MS = 300;

const HIDDEN: Keyframe = { opacity: 0, transform: 'scale(0.94)', filter: 'blur(8px)' };
const SHOWN: Keyframe = { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' };

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Set by Starta presentation, taken by the area that then appears: only a start moves it in. */
let starting = false;
/** The leaving of the area on screen, while there is one. */
let leaving: (() => Promise<void>) | null = null;

export function markLiveStarting() {
  starting = true;
}

/** Plays the leaving of the picture and its area, if they are on screen; resolves once they are gone. */
export async function playLiveLeaving() {
  await leaving?.();
}

/** What moves with a phone's block: what follows it in its column, not what floats over it (the +). */
function followers(area: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let n = area.nextElementSibling; n; n = n.nextElementSibling) {
    if (n instanceof HTMLElement && !['absolute', 'fixed'].includes(getComputedStyle(n).position)) found.push(n);
  }
  return found;
}

/**
 * The area taking its room (`opening`) or giving it back. A phone's block stands in its place at once and what
 * follows it slides down from where it was, the block fading in as they leave it; giving it back, what follows slides
 * up over it. A column at the side (a computer's, or a phone's lying down) slides in from the right edge, and out,
 * its row clipped meanwhile so the page never scrolls sideways.
 */
function move(area: HTMLElement, side: boolean, opening: boolean, ms: number): Animation[] {
  const options: KeyframeAnimationOptions = { duration: ms, easing: EASE, fill: opening ? 'none' : 'forwards' };
  const order = (from: Keyframe, to: Keyframe) => (opening ? [from, to] : [to, from]);
  if (side) {
    const row = area.parentElement;
    if (row) row.style.overflowX = 'clip';
    const slide = area.animate(order({ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }), options);
    void slide.finished
      .catch(() => undefined)
      .finally(() => {
        if (row) row.style.overflowX = '';
      });
    return [slide];
  }
  const lift = { transform: `translateY(-${area.offsetHeight}px)` };
  const rest = { transform: 'translateY(0)' };
  return [
    area.animate(opening ? [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], options),
    ...followers(area).map((f) => f.animate(order(lift, rest), options)),
  ];
}

/**
 * Moves the area in after a start, its picture (`[data-live-picture]`) after it, and lends them their leaving while
 * they show. Called by the area's owner, whose ref is set by the time its layout effects run (a child's run before
 * its parents' refs are). `side` for a computer's column; `shown` where the owner stays while the area comes and goes
 * (a phone's page).
 */
export function useLiveMotion(area: RefObject<HTMLElement | null>, { side = false, shown = true }: { side?: boolean; shown?: boolean } = {}) {
  useLayoutEffect(() => {
    const a = area.current;
    if (!shown || !a) return;
    const p = a.querySelector<HTMLElement>('[data-live-picture]');
    const across = side || matchMedia('(orientation: landscape)').matches;
    let moving: Animation[] = [];
    if (starting && !still()) {
      moving = move(a, across, true, OPEN_MS);
      // Hidden while the area opens (`backwards`: its first frame holds through the delay), then in.
      p?.animate([HIDDEN, SHOWN], { duration: IN_MS, delay: OPEN_MS, easing: EASE, fill: 'backwards' });
    }
    starting = false;
    leaving = async () => {
      if (still()) return;
      p?.getAnimations().forEach((x) => x.cancel());
      if (p) await p.animate([SHOWN, HIDDEN], { duration: OUT_MS, easing: EASE, fill: 'forwards' }).finished;
      moving.forEach((x) => x.cancel());
      moving = move(a, across, false, CLOSE_MS);
      await Promise.all(moving.map((x) => x.finished));
    };
    return () => {
      leaving = null;
      // The area goes in this same frame: what followed it stands where it now rests, without the lift.
      moving.forEach((x) => x.cancel());
    };
  }, [area, side, shown]);
}
