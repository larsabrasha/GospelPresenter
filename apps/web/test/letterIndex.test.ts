import { describe, expect, it } from 'vitest';
import { keyAt } from '../src/ui/LetterIndex.tsx';

const KEYS = ['A', 'B', 'C', 'D'];

describe('the letter under a finger on the index', () => {
  it('is the one whose share of the height the finger is in', () => {
    expect([keyAt(5, 100, KEYS), keyAt(30, 100, KEYS), keyAt(99, 100, KEYS)]).toEqual(['A', 'B', 'D']);
  });

  it('stays at the ends when the finger slides past them', () => {
    expect([keyAt(-40, 100, KEYS), keyAt(180, 100, KEYS)]).toEqual(['A', 'D']);
  });

  it('is none without letters', () => {
    expect(keyAt(10, 100, [])).toBeNull();
  });
});
