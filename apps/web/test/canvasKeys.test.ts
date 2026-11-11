import { describe, expect, it } from 'vitest';
import { arrowNudge, nextInTurn } from '../src/ui/canvasKeys.ts';

describe("an editor's slide by the keyboard", () => {
  it('moves the picked one a point by an arrow, and ten with Shift', () => {
    expect(arrowNudge({ key: 'ArrowLeft', shiftKey: false })).toEqual([-1, 0]);
    expect(arrowNudge({ key: 'ArrowDown', shiftKey: true })).toEqual([0, 10]);
  });

  it('moves nothing by another key', () => {
    expect(arrowNudge({ key: 'a', shiftKey: false })).toBeNull();
  });

  it('picks the first by Tab with none picked, and the last by Shift+Tab', () => {
    expect(nextInTurn(['a', 'b', 'c'], null, false)).toBe('a');
    expect(nextInTurn(['a', 'b', 'c'], null, true)).toBe('c');
  });

  it('picks the next by Tab, and none past the end, where Tab leaves the slide', () => {
    expect(nextInTurn(['a', 'b'], 'a', false)).toBe('b');
    expect(nextInTurn(['a', 'b'], 'b', false)).toBeUndefined();
    expect(nextInTurn(['a', 'b'], 'a', true)).toBeUndefined();
  });
});
