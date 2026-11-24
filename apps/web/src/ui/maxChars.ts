import { charCount, cutChars } from '@gp/core';
import type { ChangeEvent } from 'react';

// A field's most characters, counted as the core counts them (chars.ts): in code points, so a name of emoji takes as
// many as its limit says. The browser's own limit counts UTF-16 units, an emoji as two, and is never used (pnpm lint).

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * `value` with at most `max` characters, and where the caret goes: what was typed or pasted last, just before the
 * caret, is what goes, as the browser's own limit drops it; the text after the caret stays.
 */
export function keepChars(value: string, caret: number, max: number): { value: string; caret: number } {
  if (value.length <= max) return { value, caret };
  const after = value.slice(caret);
  const before = cutChars(value.slice(0, caret), Math.max(0, max - charCount(after)));
  const kept = cutChars(before + after, max);
  return { value: kept, caret: Math.min(before.length, kept.length) };
}

/** Cuts the field's text in place to `max` characters, before a change handler reads it; not while an IME composes. */
function cutField(e: ChangeEvent<Field>, max: number) {
  if ((e.nativeEvent as InputEvent).isComposing) return;
  const el = e.target;
  // An e-mail field has no caret position (null): the text is then cut at its end.
  const caret = el.selectionStart ?? el.value.length;
  const kept = keepChars(el.value, caret, max);
  if (kept.value === el.value) return;
  el.value = kept.value;
  if (el.selectionStart !== null) el.setSelectionRange(kept.caret, kept.caret);
}

/** A change handler that cuts the field's text to `max` characters (none: no limit), then calls `onChange`. */
export function withMaxChars<E extends Field>(max: number | undefined, onChange?: (e: ChangeEvent<E>) => void): (e: ChangeEvent<E>) => void {
  return (e) => {
    if (max !== undefined) cutField(e, max);
    onChange?.(e);
  };
}
