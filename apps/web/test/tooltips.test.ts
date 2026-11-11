import { describe, expect, it } from 'vitest';
import { splitKeys, tipPlace } from '../src/ui/tooltips.ts';

const VIEW = { width: 800, height: 600 };
const SIZE = { width: 100, height: 24 };

describe('a tooltip\'s text', () => {
  it('shows a shortcut at the title\'s end apart, to be fainter', () => {
    expect(splitKeys('Sök i allt (⌘K)')).toEqual({ text: 'Sök i allt', keys: '⌘K' });
  });

  it('shows a function key apart too, as Starta presentation\'s F5', () => {
    expect(splitKeys('Starta presentation (F5)')).toEqual({ text: 'Starta presentation', keys: 'F5' });
  });

  it('leaves a title with no shortcut whole, brackets and all', () => {
    expect(splitKeys('Verse 1 (refräng)')).toEqual({ text: 'Verse 1 (refräng)', keys: null });
  });
});

describe('where a tooltip goes', () => {
  it('is centred under its element', () => {
    expect(tipPlace({ left: 350, top: 100, width: 100, height: 30 }, SIZE, VIEW)).toEqual({ left: 350, top: 136 });
  });

  it('goes above an element at the window\'s foot', () => {
    expect(tipPlace({ left: 350, top: 570, width: 100, height: 24 }, SIZE, VIEW).top).toBe(540);
  });

  it('stays inside the window beside an element at its edge', () => {
    expect([tipPlace({ left: 0, top: 10, width: 20, height: 20 }, SIZE, VIEW).left, tipPlace({ left: 790, top: 10, width: 10, height: 20 }, SIZE, VIEW).left]).toEqual([8, 692]);
  });
});
