// The app's live state in the core (`liveChangeView`, `followItemOverlayView`; crates/gp-core/src/live_state.rs): the
// pointer every window of a device shares, its overlay rules (moved here from packages/core with the rules) and one
// presentation presented at a time. That they are 2.0's is the parity check's (parity/views/live-state.mjs).
import { describe, expect, it } from 'vitest';
import { Core } from '../../src/core.ts';

interface LivePointer { presentationId: string | null; itemId: string | null; partIndex: number; black: boolean; overlayId: string | null; rev: number }
type Change = Partial<Omit<LivePointer, 'rev'>>;

// TODO.md "Overlays": A carries overlay O, B carries none, C carries O too. P is another overlay.
const overlays = { A: 'O', B: null, C: 'O' };
const at = (change: Partial<LivePointer>): LivePointer => ({ presentationId: 'P1', itemId: null, partIndex: 0, black: false, overlayId: null, rev: 1, ...change });
const changed = (p: LivePointer, change: Change) => new Core().pure<{ pointer?: LivePointer; refused?: string }>('liveChangeView', { pointer: p, change, overlays });
const overlayAfter = (p: LivePointer, change: Change) => changed(p, change).pointer!.overlayId;
const follow = (p: LivePointer, args: { before?: string | null; after?: string | null }) => new Core().pure<{ change: boolean; overlayId?: string | null }>('followItemOverlayView', { pointer: p, ...args });

describe('one presentation presented at a time', () => {
  it('refuses to start a presentation while another is presented', () => {
    const presented = at({ presentationId: 'P1', itemId: 'A' });

    const started = changed(presented, { presentationId: 'P2', itemId: null, partIndex: 0, black: false });

    expect(started).toEqual({ refused: 'another-presented' });
  });

  it('starts one once the other has ended', () => {
    const ended = changed(at({ presentationId: 'P1', itemId: 'A' }), { presentationId: null, itemId: null }).pointer!;

    const started = changed(ended, { presentationId: 'P2', itemId: null, partIndex: 0, black: false });

    expect(started.pointer).toMatchObject({ presentationId: 'P2', rev: 3 });
  });

  it('lets the presentation presented start over', () => {
    const presented = at({ presentationId: 'P1', itemId: 'A', partIndex: 2 });

    const again = changed(presented, { presentationId: 'P1', itemId: null, partIndex: 0 });

    expect(again.pointer).toMatchObject({ presentationId: 'P1', itemId: null, partIndex: 0 });
  });
});

describe('the live pointer', () => {
  it('numbers each change one after the pointer it changed', () => {
    const next = changed(at({ rev: 7 }), { partIndex: 1 });

    expect(next.pointer!.rev).toBe(8);
  });

  it("switches an item's overlay on when it goes live and off when it leaves", () => {
    expect(overlayAfter(at({}), { itemId: 'A', partIndex: 0 })).toBe('O');
    expect(overlayAfter(at({ itemId: 'A', overlayId: 'O' }), { partIndex: 1 })).toBe('O');
    expect(overlayAfter(at({ itemId: 'A', overlayId: 'O' }), { itemId: 'B', partIndex: 0 })).toBeNull();
  });

  it('keeps an overlay two items carry on, going from one to the other', () => {
    expect(overlayAfter(at({ itemId: 'A', overlayId: 'O' }), { itemId: 'C', partIndex: 0 })).toBe('O');
  });

  it("keeps a manual off until the item changes, and brings the item's overlay back on entering it", () => {
    const off = changed(at({ itemId: 'A', overlayId: 'O' }), { overlayId: null }).pointer!;

    expect(off.overlayId).toBeNull();
    expect(overlayAfter(off, { partIndex: 1 })).toBeNull();
    expect(overlayAfter(at({ itemId: 'B' }), { itemId: 'A', partIndex: 0 })).toBe('O');
  });

  it('keeps a manual overlay when the item left carried another, and lets the new item override it', () => {
    expect(overlayAfter(at({ itemId: 'A', overlayId: 'P' }), { itemId: 'B', partIndex: 0 })).toBe('P');
    expect(overlayAfter(at({ itemId: 'B', overlayId: 'P' }), { itemId: 'C', partIndex: 0 })).toBe('O');
  });

  it('switches the overlay off on black and on stopping', () => {
    expect(changed(at({ itemId: 'A', overlayId: 'O' }), { black: true }).pointer).toMatchObject({ black: true, overlayId: null });
    expect(overlayAfter(at({ itemId: 'A', overlayId: 'O' }), { presentationId: null, itemId: null })).toBeNull();
  });

  it("brings the item's own overlay back when a slide is shown after black (Lars, 2026-11-02)", () => {
    expect(overlayAfter(at({ itemId: 'A', black: true }), { partIndex: 1, black: false })).toBe('O');
    expect(overlayAfter(at({ itemId: 'B', black: true }), { partIndex: 0, black: false })).toBeNull();
  });

  it('ends the black screen when an overlay is shown', () => {
    expect(changed(at({ itemId: 'B', black: true }), { overlayId: 'P' }).pointer).toMatchObject({ black: false, overlayId: 'P' });
  });
});

describe("the shown item's overlay changed while it is live", () => {
  const shown = (change: Partial<LivePointer>) => at({ itemId: 'A', ...change });

  it("switches to the item's new overlay when its old one was showing", () => {
    expect(follow(shown({ overlayId: 'O' }), { before: 'O', after: 'P' })).toEqual({ change: true, overlayId: 'P' });
  });

  it('switches it on when the item had none and none was showing', () => {
    expect(follow(shown({}), { before: null, after: 'O' })).toEqual({ change: true, overlayId: 'O' });
  });

  it('switches it off when the item no longer carries one', () => {
    expect(follow(shown({ overlayId: 'O' }), { before: 'O', after: null })).toEqual({ change: true, overlayId: null });
  });

  it("leaves a manual choice that is not the item's own", () => {
    expect(follow(shown({ overlayId: 'M' }), { before: 'O', after: 'P' })).toEqual({ change: false });
  });

  it('changes nothing while the screen is black, or when the item was not known before', () => {
    expect(follow(shown({ black: true }), { before: null, after: 'O' })).toEqual({ change: false });
    expect(follow(shown({}), { after: 'O' })).toEqual({ change: false });
  });
});
