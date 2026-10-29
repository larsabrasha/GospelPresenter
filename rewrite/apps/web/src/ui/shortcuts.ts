import { useEffect, useEffectEvent } from 'react';

/** True on a Mac, so shortcuts can be written the way that machine writes them. */
export const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || '');

/** "Ctrl+1" or "⌘1": how a shortcut with Ctrl (⌘ on a Mac) is written in a tooltip. */
export function ctrlLabel(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * A field the user types into: a letter shortcut must not fire there. Checkboxes,
 * radios and buttons are inputs nobody types into (utils.js _isTextEntry).
 */
export function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type);
}

/**
 * Whether a page's shortcut may act on this key press (utils.js installShortcuts):
 * not mid-word in an IME, not a held key repeating, not while a dialog is open,
 * and in a text field only Ctrl/⌘ combinations and Escape.
 */
export function shortcutAllowed(e: KeyboardEvent): boolean {
  if (e.isComposing || e.keyCode === 229 || e.repeat) return false;
  if (document.querySelector('[aria-modal="true"]')) return false;
  if (isTextEntry(e.target) && !(e.ctrlKey || e.metaKey || e.key === 'Escape')) return false;
  return true;
}

/** A page's own keys: `handler` sees only the presses `shortcutAllowed` lets through. */
export function usePageKeys(handler: (e: KeyboardEvent) => void): void {
  const on = useEffectEvent((e: KeyboardEvent) => {
    if (shortcutAllowed(e)) handler(e);
  });
  useEffect(() => {
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);
}
