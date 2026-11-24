import { describe, expect, it } from 'vitest';
import { keepChars } from '../src/ui/maxChars.ts';

// A field's most characters as the core counts them (ui/maxChars.ts): an emoji is one, and what goes is what was typed.
describe('keepChars', () => {
  it('takes a text of emoji up to its most in characters', () => {
    const value = '😀'.repeat(5);

    const kept = keepChars(value, value.length, 5);

    expect(kept).toEqual({ value, caret: value.length });
  });

  it('drops what was typed over the most at the caret, keeping the text after it', () => {
    const value = 'abXc';

    const kept = keepChars(value, 3, 3);

    expect(kept).toEqual({ value: 'abc', caret: 2 });
  });

  it('cuts a paste over the most without splitting an emoji', () => {
    const value = 'ab😀😀';

    const kept = keepChars(value, value.length, 3);

    expect(kept).toEqual({ value: 'ab😀', caret: 4 });
  });
});
