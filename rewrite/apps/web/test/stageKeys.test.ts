import { describe, expect, it } from 'vitest';
import { stageKey, type StageKeyEvent } from '../src/pages/stageKeys.ts';

/** A keydown on `tagName` (the page's body unless given), tabbed to and with no modifier unless given. */
function key(
  k: string,
  opts: { tagName?: string; role?: string; tabbedTo?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): StageKeyEvent {
  return {
    key: k,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    target: { tagName: opts.tagName ?? 'BODY', isContentEditable: false, role: opts.role ?? null, tabbedTo: opts.tabbedTo ?? true },
  };
}

describe('stage mode keys', () => {
  it('goes to the next part on Enter and Space when no button has focus', () => {
    expect([stageKey(key('Enter')), stageKey(key(' '))]).toEqual(['next', 'next']);
  });

  it('leaves Enter and Space to a button tabbed to, so it can be pressed', () => {
    expect([stageKey(key('Enter', { tagName: 'BUTTON' })), stageKey(key(' ', { tagName: 'BUTTON' }))]).toEqual([null, null]);
  });

  it('leaves Enter and Space to a focused link or an element with an interactive role', () => {
    expect([stageKey(key('Enter', { tagName: 'A' })), stageKey(key(' ', { tagName: 'DIV', role: 'button' }))]).toEqual([null, null]);
  });

  it('goes to the next part on Enter while a clicked button keeps focus', () => {
    expect(stageKey(key('Enter', { tagName: 'BUTTON', tabbedTo: false }))).toBe('next');
  });

  it('still steps on the arrow keys while a button has focus', () => {
    expect(stageKey(key('ArrowRight', { tagName: 'BUTTON' }))).toBe('next');
  });

  it('leaves keys typed in a text field to the field', () => {
    expect(stageKey(key('b', { tagName: 'INPUT' }))).toBeNull();
  });

  it('blanks the screen on ".", "b" and "B"', () => {
    expect([stageKey(key('.')), stageKey(key('b')), stageKey(key('B'))]).toEqual(['black', 'black', 'black']);
  });

  it('ignores B held with Cmd, Ctrl or Alt, which belong to the browser', () => {
    expect([stageKey(key('b', { metaKey: true })), stageKey(key('b', { ctrlKey: true })), stageKey(key('b', { altKey: true }))]).toEqual([null, null, null]);
  });

  it('ignores Enter and the arrow keys held with a modifier', () => {
    expect([stageKey(key('Enter', { ctrlKey: true })), stageKey(key('ArrowLeft', { metaKey: true }))]).toEqual([null, null]);
  });
});
