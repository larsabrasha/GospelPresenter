import { describe, expect, it } from 'vitest';
import { marked } from '../src/ui/Selecting.tsx';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('marked', () => {
  it('turns over only the item clicked without Shift', () => {
    const now = new Set(['a']);
    const next = marked(now, 'c', false, 'a', order);
    expect([...next].toSorted()).toEqual(['a', 'c']);
  });

  it('marks every item from the earlier click to this one with Shift', () => {
    const next = marked(new Set(['b']), 'd', true, 'b', order);
    expect([...next].toSorted()).toEqual(['b', 'c', 'd']);
  });

  it('marks the range upwards when Shift-clicking above the earlier click', () => {
    const next = marked(new Set(['d']), 'b', true, 'd', order);
    expect([...next].toSorted()).toEqual(['b', 'c', 'd']);
  });

  it('unmarks the range when the item Shift-clicked was marked', () => {
    const next = marked(new Set(['a', 'b', 'c', 'd']), 'c', true, 'a', order);
    expect([...next].toSorted()).toEqual(['d']);
  });

  it('turns over only the item when there is no earlier click', () => {
    const next = marked(new Set(), 'c', true, null, order);
    expect([...next]).toEqual(['c']);
  });

  it('turns over only the item when the earlier click is no longer on the page', () => {
    const next = marked(new Set(), 'c', true, 'gone', order);
    expect([...next]).toEqual(['c']);
  });
});
