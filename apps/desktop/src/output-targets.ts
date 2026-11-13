// Which outputs lost their display (the review, 2026-11-09): a projector unplugged or gone to standby takes its
// output with it, closed, rather than letting the operating system move a fullscreen window onto the laptop's screen.

/** The output in a window of its own, for a computer with one display. */
export const WINDOW = 'window';

/** The targets in `open` whose display is not among `displays` (their ids); never WINDOW. */
export function goneTargets(open: readonly string[], displays: readonly string[]): string[] {
  const here = new Set(displays);
  return open.filter((t) => t !== WINDOW && !here.has(t));
}
