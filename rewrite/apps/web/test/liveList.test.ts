import { describe, expect, it } from 'vitest';
import { addAfter, followsShown } from '../src/live/liveList.ts';

const order = ['welcome', 'song', 'reading', 'sermon', 'blessing'];

describe('addAfter', () => {
  it('adds right after the shown item', () => {
    const place = { order, shownId: 'song', lastAddedId: null, chosenId: null };

    const after = addAfter(place);

    expect(after).toBe('song');
  });

  it('adds after the last thing added while that is still ahead of the shown item, so additions keep their order', () => {
    const place = { order: ['welcome', 'song', 'added', 'reading'], shownId: 'song', lastAddedId: 'added', chosenId: null };

    const after = addAfter(place);

    expect(after).toBe('added');
  });

  it('adds after the shown item again once the last thing added is behind it', () => {
    const place = { order: ['welcome', 'added', 'song', 'reading'], shownId: 'song', lastAddedId: 'added', chosenId: null };

    const after = addAfter(place);

    expect(after).toBe('song');
  });

  it('adds after the item chosen in its menu, wherever the shown item is', () => {
    const place = { order, shownId: 'song', lastAddedId: 'reading', chosenId: 'welcome' };

    const after = addAfter(place);

    expect(after).toBe('welcome');
  });

  it('ignores a chosen or last added item that is no longer in the order', () => {
    const place = { order, shownId: 'song', lastAddedId: 'gone', chosenId: 'removed' };

    const after = addAfter(place);

    expect(after).toBe('song');
  });

  it('adds after the selected item when nothing is shown', () => {
    const place = { order, shownId: null, lastAddedId: null, chosenId: null, selectedId: 'sermon' };

    const after = addAfter(place);

    expect(after).toBe('sermon');
  });
});

describe('followsShown', () => {
  const view = { viewHeight: 400, headingHeight: 36 };

  it('does not scroll after a tap in the list, where the part is under the finger', () => {
    const row = { ...view, byTap: true, top: 900, bottom: 980 };

    const follows = followsShown(row);

    expect(follows).toBe(false);
  });

  it('does not scroll when the part is already in view below the sticky heading', () => {
    const row = { ...view, byTap: false, top: 120, bottom: 200 };

    const follows = followsShown(row);

    expect(follows).toBe(false);
  });

  it('scrolls when the part is below the view', () => {
    const row = { ...view, byTap: false, top: 380, bottom: 460 };

    const follows = followsShown(row);

    expect(follows).toBe(true);
  });

  it('scrolls when the part is hidden under the sticky heading', () => {
    const row = { ...view, byTap: false, top: 10, bottom: 90 };

    const follows = followsShown(row);

    expect(follows).toBe(true);
  });
});
