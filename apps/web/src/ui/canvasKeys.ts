// The keys of an editor's slide with focus on it (the slideshows' and the themes' editors), as Keynote's: Tab picks
// the next thing on it, an arrow moves the picked one.

/** Points an arrow with Shift moves the picked one, as Keynote's ten. */
const NUDGE_LONG = 10;

/** How far an arrow moves the picked one (one point; Shift: ten), or null for another key. */
export function arrowNudge(e: { key: string; shiftKey: boolean }): [number, number] | null {
  const step = e.shiftKey ? NUDGE_LONG : 1;
  return ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key] ?? null;
}

/** What Tab picks next in `order` (Shift: the one before); undefined past either end, where Tab leaves the slide. */
export function nextInTurn<T>(order: readonly T[], picked: T | null, back: boolean): T | undefined {
  const now = picked !== null && order.includes(picked) ? order.indexOf(picked) : back ? order.length : -1;
  return order[now + (back ? -1 : 1)];
}

/** The slide's class: focusable, its ring drawn outside the rounded slide. */
export const CANVAS_FOCUS = 'rounded-xl focus:outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-sky-500 focus-visible:outline-offset-4';
