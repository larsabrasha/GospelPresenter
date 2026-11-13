import { describe, expect, it } from 'vitest';
import { presentingKey, slideMarks, slideOrder, type Presenting } from '../src/presenting.ts';

// A song of two slides, a heading, and a reading of one.
const order = slideOrder([
  { itemId: 'song', parts: 2 },
  { itemId: 'heading', parts: 0 },
  { itemId: 'reading', parts: 1 },
]);
const nothing = { itemId: null, partIndex: 0, black: false };
const showing = (itemId: string, partIndex: number, black = false): Presenting => ({ presenting: true, shown: { itemId, partIndex, black }, picked: null });

describe('slideOrder', () => {
  it('lists every slide in order, a heading with none', () => {
    const steps = order.map((s) => `${s.itemId}/${s.partIndex}`);

    expect(steps).toEqual(['song/0', 'song/1', 'reading/0']);
  });
});

describe('presentingKey: step', () => {
  it('shows the next slide, ending Släck', () => {
    const state = showing('song', 0, true);

    const next = presentingKey(order, state, { type: 'step', delta: 1 });

    expect(next.shown).toEqual({ itemId: 'song', partIndex: 1, black: false });
  });

  it("steps over a heading into the next item after an item's last slide", () => {
    const state = showing('song', 1);

    const next = presentingKey(order, state, { type: 'step', delta: 1 });

    expect(next.shown).toEqual({ itemId: 'reading', partIndex: 0, black: false });
  });

  it('starts at the first slide forward, and at the last back, when nothing is shown', () => {
    const state: Presenting = { presenting: true, shown: nothing, picked: null };

    const forward = presentingKey(order, state, { type: 'step', delta: 1 });
    const back = presentingKey(order, state, { type: 'step', delta: -1 });

    expect([forward.shown.itemId, back.shown.itemId]).toEqual(['song', 'reading']);
  });

  it('changes nothing past the last slide', () => {
    const state = showing('reading', 0);

    const next = presentingKey(order, state, { type: 'step', delta: 1 });

    expect(next).toBe(state);
  });
});

describe('presentingKey: pick', () => {
  it('moves the outline from where it is, and leaves what is shown as it is', () => {
    const state: Presenting = { ...showing('song', 0), picked: { itemId: 'song', partIndex: 1 } };

    const next = presentingKey(order, state, { type: 'pick', delta: 1 });

    expect([next.picked, next.shown === state.shown]).toEqual([{ itemId: 'reading', partIndex: 0 }, true]);
  });

  it('starts from the slide shown while presenting', () => {
    const state = showing('song', 1);

    const next = presentingKey(order, state, { type: 'pick', delta: -1 });

    expect(next.picked).toEqual({ itemId: 'song', partIndex: 0 });
  });

  it('starts at the first slide before presenting, whatever the pointer says', () => {
    const state: Presenting = { ...showing('reading', 0), presenting: false };

    const next = presentingKey(order, state, { type: 'pick', delta: 1 });

    expect(next.picked).toEqual({ itemId: 'song', partIndex: 0 });
  });
});

describe('presentingKey: enter, black and escape', () => {
  it('↵ shows the slide made ready and lets go of the outline', () => {
    const state: Presenting = { ...showing('song', 0, true), picked: { itemId: 'reading', partIndex: 0 } };

    const next = presentingKey(order, state, { type: 'enter' });

    expect([next.shown, next.picked]).toEqual([{ itemId: 'reading', partIndex: 0, black: false }, null]);
  });

  it('↵ shows the next slide when none is made ready', () => {
    const state = showing('song', 0);

    const next = presentingKey(order, state, { type: 'enter' });

    expect(next.shown).toEqual({ itemId: 'song', partIndex: 1, black: false });
  });

  it('b blacks and keeps the slide', () => {
    const state = showing('song', 1);

    const next = presentingKey(order, state, { type: 'black' });

    expect(next.shown).toEqual({ itemId: 'song', partIndex: 1, black: true });
  });

  it('Escape lets go of the outline while presenting', () => {
    const state: Presenting = { ...showing('song', 0), picked: { itemId: 'reading', partIndex: 0 } };

    const next = presentingKey(order, state, { type: 'escape' });

    expect(next.picked).toBeNull();
  });

  it('↵, b and Escape do nothing before presenting', () => {
    const state: Presenting = { presenting: false, shown: nothing, picked: { itemId: 'song', partIndex: 1 } };

    const after = [presentingKey(order, state, { type: 'enter' }), presentingKey(order, state, { type: 'black' }), presentingKey(order, state, { type: 'escape' })];

    expect(after.every((s) => s === state)).toBe(true);
  });
});

describe('slideMarks', () => {
  it('marks the slide shown, and the next one within the item', () => {
    const mark = slideMarks(order, { itemId: 'song', partIndex: 0, black: false });

    expect([mark('song', 0), mark('song', 1), mark('reading', 0)]).toEqual(['shown', 'next', null]);
  });

  it("marks the first slide of the next item after an item's last", () => {
    const mark = slideMarks(order, { itemId: 'song', partIndex: 1, black: false });

    expect(mark('reading', 0)).toBe('next');
  });

  it('after Släck marks nothing shown, but still what comes next', () => {
    const mark = slideMarks(order, { itemId: 'song', partIndex: 0, black: true });

    expect([mark('song', 0), mark('song', 1)]).toEqual([null, 'next']);
  });

  it('marks nothing next after the last slide', () => {
    const mark = slideMarks(order, { itemId: 'reading', partIndex: 0, black: false });

    expect([mark('reading', 0), mark('song', 0)]).toEqual(['shown', null]);
  });
});
