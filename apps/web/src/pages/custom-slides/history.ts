// Ångra and Gör om in the custom slide editor (docs/custom-slides.md), as Keynote's: every change can be undone, and
// a run of quick changes (a slider pulled, a word typed) is one step.

/** Changes this close together are one step to undo. */
const SAME_STEP_MS = 600;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** When the last change was made, and what it changed: another kind of change starts a new step. */
  last: { at: number; key: string };
}

/** The most steps kept to undo. */
const DEPTH = 100;

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], last: { at: 0, key: '' } };
}

/**
 * `next` as the present; a step of its own unless it follows a change of the same `key` within SAME_STEP_MS. An empty
 * `key` is always a step of its own (an element added or removed, a page).
 */
export function record<T>(h: History<T>, next: T, key: string, now: number): History<T> {
  const joins = key !== '' && key === h.last.key && now - h.last.at < SAME_STEP_MS;
  return { past: joins ? h.past : [...h.past, h.present].slice(-DEPTH), present: next, future: [], last: { at: now, key } };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future], last: { at: 0, key: '' } };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1), last: { at: 0, key: '' } };
}
