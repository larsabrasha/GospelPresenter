// Scenläge's keys (spec 04 §3). Foot pedals and clickers are HID keyboards,
// so every mode they ship with counts (utils.js installStageKeys).

export type StageKey = 'escape' | 'next' | 'previous' | 'black';

/** The parts of a keydown that decide what it does. */
export interface StageKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** The focused element; `tabbedTo` when Tab, not a click or tap, last moved focus. */
  target: { tagName: string; isContentEditable: boolean; role: string | null; tabbedTo: boolean } | null;
}

const PRESSABLE_TAGS = ['BUTTON', 'A', 'SELECT', 'SUMMARY'];
const PRESSABLE_ROLES = ['button', 'link', 'checkbox', 'switch', 'radio', 'tab', 'option', 'menuitem', 'combobox'];

/**
 * What a key does in stage mode, or null when it is left to the page: typing
 * in a field, Enter or Space on a button tabbed to (Lämna, Rensa, a tile), and
 * any key held with Cmd, Ctrl or Alt, which belongs to the browser. A button
 * focused by a click keeps Enter and Space as next, so a pedal still steps
 * after a tile was clicked. Shift counts as no modifier, so "B" blanks too.
 */
export function stageKey(e: StageKeyEvent): StageKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const target = e.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return null;
  const pressable = !!target && target.tabbedTo && (PRESSABLE_TAGS.includes(target.tagName) || PRESSABLE_ROLES.includes(target.role ?? ''));
  if (pressable && (e.key === 'Enter' || e.key === ' ')) return null;
  if (e.key === 'Escape') return 'escape';
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) return 'next';
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) return 'previous';
  if (['.', 'b', 'B'].includes(e.key)) return 'black';
  return null;
}
