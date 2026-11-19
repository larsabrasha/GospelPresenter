// A presentation page's own state in the core (`pageEventView`, `pageModelView`; crates/gp-core/src/page_state.rs): the
// item selected, the slide made ready, the last thing added, a number typed, changed by the page's events, the same on
// every shell. The keys were useEditorKeys.ts's (spec 03 section 6, spec 04 "Keyboard shortcuts during live").
import { describe, expect, it } from 'vitest';
import { nodeRustCore } from '../src/node.ts';

interface At { itemId: string; partIndex: number }
interface State { selectedId?: string | null; picked?: At | null; lastAddedId?: string | null; typed?: string; presenting?: boolean; followed?: string | null }
interface Live { presentationId: string | null; itemId: string | null; partIndex: number; black: boolean }
interface Answer { state: State; live: Partial<Live> | null; command: Record<string, unknown> | null; handled: boolean }

// A heading, a song of three slides and one of two.
const ORDER = [['h', 0], ['a', 3], ['b', 2]];
const IDLE: Live = { presentationId: null, itemId: null, partIndex: 0, black: false };
const presented = (itemId: string | null, partIndex = 0, black = false): Live => ({ presentationId: 'p', itemId, partIndex, black });

/** The page's answer to `event`, its state `state`, presented as `live` says. */
function sent(event: object, state: State = {}, live: Live = IDLE, isTemplate = false): Answer {
  const context = { presentationId: 'p', isTemplate, presenting: live.presentationId === 'p', live };
  return nodeRustCore().pure<Answer>('pageEventView', { state: { presenting: context.presenting, ...state }, context, order: ORDER, event });
}
const model = (state: State, live: Live, isTemplate = false) =>
  nodeRustCore().pure<{ state: State; canStart: boolean; cue: { text: string; n: number; itemId: string } | null }>('pageModelView', {
    state: { presenting: live.presentationId === 'p', ...state },
    context: { presentationId: 'p', isTemplate, presenting: live.presentationId === 'p', live },
    order: ORDER,
  });

describe('choosing an item by ⌘↑ ⌘↓', () => {
  it('selects the first item from none and makes its first slide ready', () => {
    const answer = sent({ type: 'item', delta: 1 }, { selectedId: 'h' });

    expect(answer.state).toMatchObject({ selectedId: 'a', picked: { itemId: 'a', partIndex: 0 } });
  });

  it('goes to a heading with nothing made ready, and has the slides go to it', () => {
    const answer = sent({ type: 'item', delta: -1 }, { selectedId: 'a' });

    expect([answer.state.picked, answer.command]).toEqual([null, { type: 'item', itemId: 'h', reveal: true, focus: false }]);
  });

  it('makes nothing ready on the item shown while presenting', () => {
    const answer = sent({ type: 'item', delta: 1 }, { selectedId: 'h', followed: 'a' }, presented('a'));

    expect(answer.state).toMatchObject({ selectedId: 'a', picked: null });
  });

  it('does not wrap past the last item', () => {
    const answer = sent({ type: 'item', delta: 1 }, { selectedId: 'b' });

    expect(answer.state.selectedId).toBe('b');
  });
});

describe('making a slide ready', () => {
  it('moves the slide made ready by → and takes the selection along', () => {
    const answer = sent({ type: 'pick', delta: 1 }, { picked: { itemId: 'a', partIndex: 2 } });

    expect(answer.state).toMatchObject({ picked: { itemId: 'b', partIndex: 0 }, selectedId: 'b' });
  });

  it('makes a slide tapped before presenting ready and selects its item', () => {
    const answer = sent({ type: 'show', itemId: 'b', partIndex: 1 });

    expect([answer.state.picked, answer.state.selectedId, answer.live]).toEqual([{ itemId: 'b', partIndex: 1 }, 'b', null]);
  });

  it('shows a slide tapped while presenting', () => {
    const answer = sent({ type: 'show', itemId: 'b', partIndex: 1 }, { followed: 'a' }, presented('a'));

    expect(answer.live).toEqual({ itemId: 'b', partIndex: 1, black: false });
  });
});

describe('a number typed while presenting', () => {
  it('makes that slide of the item ready, and ↵ shows it', () => {
    const typed = sent({ type: 'digit', digit: 2 }, { selectedId: 'a', followed: 'a' }, presented('a'));

    const shown = sent({ type: 'enter', onPage: false }, typed.state, presented('a'));

    expect([typed.state.picked, shown.live]).toEqual([{ itemId: 'a', partIndex: 1 }, { itemId: 'a', partIndex: 1, black: false }]);
  });

  it('says there is no such slide, and ↵ shows nothing', () => {
    const typed = sent({ type: 'digit', digit: 9 }, { selectedId: 'a', followed: 'a' }, presented('a'));

    const shown = sent({ type: 'enter', onPage: false }, typed.state, presented('a'));

    expect([model(typed.state, presented('a')).cue, shown.live]).toEqual([{ text: 'live.noSuchSlide', n: 9, itemId: 'a' }, null]);
  });
});

describe('↵ and Escape while presenting', () => {
  it("leaves ↵ to a focused button when nothing is ready and the focus is not the page's", () => {
    const answer = sent({ type: 'enter', onPage: false }, { followed: 'a' }, presented('a'));

    expect([answer.handled, answer.live]).toEqual([false, null]);
  });

  it('shows the next slide on ↵ on the page with nothing ready', () => {
    const answer = sent({ type: 'enter', onPage: true }, { followed: 'a' }, presented('a', 2));

    expect(answer.live).toEqual({ itemId: 'b', partIndex: 0, black: false });
  });

  it('lets go of the number typed first, then of the slide made ready, selecting the item shown', () => {
    const state = { followed: 'a', selectedId: 'b', picked: { itemId: 'b', partIndex: 0 }, typed: '1' };

    const first = sent({ type: 'escape' }, state, presented('a'));
    const second = sent({ type: 'escape' }, first.state, presented('a'));

    expect([first.state.picked, second.state]).toEqual([{ itemId: 'b', partIndex: 0 }, expect.objectContaining({ picked: null, selectedId: 'a' })]);
  });
});

describe('keys only while presenting', () => {
  it('leaves Space to the page before presenting', () => {
    expect(sent({ type: 'step', delta: 1 }).handled).toBe(false);
  });

  it('blacks the screen on b while presenting', () => {
    expect(sent({ type: 'black' }, { followed: 'a' }, presented('a')).live).toEqual({ itemId: 'a', partIndex: 0, black: true });
  });
});

describe('Delete', () => {
  it('removes the item selected', () => {
    expect(sent({ type: 'delete' }, { selectedId: 'b' }).command).toEqual({ type: 'remove', itemId: 'b' });
  });

  it('does not remove the item on the outputs, black or not', () => {
    expect(sent({ type: 'delete' }, { selectedId: 'a', followed: 'a' }, presented('a', 0, true)).handled).toBe(false);
  });
});

describe('starting', () => {
  it('starts when nothing is presented', () => {
    const answer = sent({ type: 'start' });

    expect([answer.live, answer.command]).toEqual([{ presentationId: 'p', itemId: null, partIndex: 0, black: false }, { type: 'start' }]);
  });

  it('does not start while another presentation is presented', () => {
    const elsewhere = { ...IDLE, presentationId: 'other', itemId: 'x' };

    expect([sent({ type: 'start' }, {}, elsewhere).live, model({}, elsewhere).canStart]).toEqual([null, false]);
  });

  it('never starts a template', () => {
    expect(model({}, IDLE, true).canStart).toBe(false);
  });
});

describe('what follows from presenting', () => {
  it('lets go of the last thing added and the slide made ready when presenting starts', () => {
    const answer = sent({ type: 'sync' }, { presenting: false, lastAddedId: 'b', picked: { itemId: 'a', partIndex: 1 } }, presented(null));

    expect(answer.state).toMatchObject({ presenting: true, lastAddedId: null, picked: null });
  });

  it("selects the item this window's own step shows, letting go of the slide made ready", () => {
    const answer = sent({ type: 'step', delta: 1 }, { followed: 'a', selectedId: 'a', picked: { itemId: 'b', partIndex: 1 } }, presented('a', 2));

    expect(answer.state).toMatchObject({ followed: 'b', selectedId: 'b', picked: null });
  });

  it('keeps its own selection and slide made ready when another window shows another item (Lars, 2026-11-18)', () => {
    const answer = sent({ type: 'sync' }, { followed: 'a', selectedId: 'h', picked: { itemId: 'b', partIndex: 1 } }, presented('b'));

    expect(answer.state).toMatchObject({ followed: 'b', selectedId: 'h', picked: { itemId: 'b', partIndex: 1 } });
  });

  it('selects what is added, and keeps it as the last thing added', () => {
    expect(sent({ type: 'added', itemId: 'n' }).state).toMatchObject({ selectedId: 'n', lastAddedId: 'n' });
  });
});

describe('the page read again (Lars, 2026-11-19: never back to the top)', () => {
  it('stays at the item at the top of the screen', () => {
    const answer = sent({ type: 'changed', itemIds: ['a', 'b'] }, { selectedId: 'a' });

    expect(answer.command).toEqual({ type: 'stay', itemId: 'a' });
  });

  it('stays at the next item on the screen when the one at the top is gone', () => {
    const answer = sent({ type: 'changed', itemIds: ['gone', 'b'] });

    expect(answer.command).toEqual({ type: 'stay', itemId: 'b' });
  });

  it('names no item to stay at when none on the screen is left', () => {
    const answer = sent({ type: 'changed', itemIds: ['gone'] });

    expect(answer.command).toEqual({ type: 'stay', itemId: null });
  });

  it('keeps the selection and the slide made ready that the page still has', () => {
    const answer = sent({ type: 'changed', itemIds: ['h'] }, { selectedId: 'b', picked: { itemId: 'a', partIndex: 2 }, lastAddedId: 'b' });

    expect(answer.state).toMatchObject({ selectedId: 'b', picked: { itemId: 'a', partIndex: 2 }, lastAddedId: 'b' });
  });

  it('selects the item it stays at when the one selected is gone', () => {
    const answer = sent({ type: 'changed', itemIds: ['gone', 'b'] }, { selectedId: 'gone' });

    expect(answer.state.selectedId).toBe('b');
  });

  it('lets go of a slide made ready that the page no longer has', () => {
    const answer = sent({ type: 'changed', itemIds: ['a'] }, { picked: { itemId: 'b', partIndex: 2 } });

    expect(answer.state.picked).toBeNull();
  });

  it('lets go of the last thing added when it is gone', () => {
    const answer = sent({ type: 'changed', itemIds: ['a'] }, { lastAddedId: 'gone' });

    expect(answer.state.lastAddedId).toBeNull();
  });
});
