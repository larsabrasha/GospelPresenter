import { describe, expect, it } from 'vitest';
import { charCount, charsAtMost, cutChars, cutUnits } from '@gp/core';

// A text's length in characters, code points, as every limit counts it (chars.ts): an emoji is one, not two units.
describe('characters', () => {
  it('counts an emoji as one character', () => {
    const text = 'a😀b';

    const n = charCount(text);

    expect(n).toBe(3);
  });

  it('counts a half of a pair alone as one character', () => {
    const text = 'a\ud83d';

    const n = charCount(text);

    expect(n).toBe(2);
  });

  it('takes a text of emoji at its most in characters, though its UTF-16 units are twice as many', () => {
    const text = '😀'.repeat(200);

    const fits = charsAtMost(text, 200);

    expect(fits).toBe(true);
  });

  it('refuses a text one character over its most', () => {
    const text = '😀'.repeat(201);

    const fits = charsAtMost(text, 200);

    expect(fits).toBe(false);
  });

  it('cuts to the first characters without splitting a pair', () => {
    const text = 'ab😀😀c';

    const cut = cutChars(text, 3);

    expect(cut).toBe('ab😀');
  });

  it('leaves a text at most its limit as it is', () => {
    const text = '😀😀';

    const cut = cutChars(text, 2);

    expect(cut).toBe(text);
  });
});

describe('cutUnits', () => {
  it('leaves out a pair the limit would split, rather than send half of it', () => {
    const text = `${'a'.repeat(4)}😀`;

    const cut = cutUnits(text, 5);

    expect(cut).toBe('aaaa');
  });

  it('cuts at the limit where no pair is split', () => {
    expect(cutUnits('abcdef', 3)).toBe('abc');
  });
});
