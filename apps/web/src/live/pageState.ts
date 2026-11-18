// A presentation page's own state, the core's (`pageEventView`, `pageModelView`; docs/view-models.md): the item
// selected, the slide made ready, the last thing added and a number typed. This window holds it; every change is the
// core's answer to an event, so a computer, a phone and the native apps do the same with the same keys and taps. A change
// to what the outputs show comes back with the answer and goes to the app's live state (LiveChannel, `liveChangeView`).
import type { LivePointer, LivePointerChange, SlideAt } from '@gp/core';
import { useLayoutEffect, useRef, useState } from 'react';
import { pageCore } from '../db/pageCore.ts';
import type { SlideOrder } from './presenting.ts';

/** The page's state as the core keeps it. */
export interface PageState {
  selectedId: string | null;
  /** The slide made ready, outlined in blue: ↵ shows it while presenting; before, the one pointed out. */
  picked: SlideAt | null;
  /** The last thing added, which the next addition follows (`addPositionView`). */
  lastAddedId: string | null;
  /** A number typed while presenting: that slide of the item is made ready. */
  typed: string;
  presenting: boolean;
  /** The item last shown, so another one shown is selected. */
  followed: string | null;
}

/** An event of the page, as the core takes it (crates/gp-core/src/page_state.rs names each). */
export type PageEvent =
  | { type: 'pick' | 'clicker' | 'step' | 'item' | 'move'; delta: number }
  | { type: 'black' | 'escape' | 'clearTyped' | 'delete' | 'add' | 'start' | 'end' | 'sync' }
  | { type: 'enter'; onPage: boolean }
  | { type: 'digit'; digit: number }
  | ({ type: 'pickAt' | 'show' } & SlideAt)
  | { type: 'select' | 'added'; itemId: string };

/** What the shell does after an event: the core decides that it is done, the shell how. */
export type PageCommand =
  | { type: 'reveal'; itemId: string }
  | { type: 'item'; itemId: string; reveal: boolean; focus: boolean }
  | { type: 'move'; itemId: string; by: number }
  | { type: 'remove'; itemId: string }
  | { type: 'add' | 'start' | 'end' };

/** The cue said over the live picture: the slide ↵ shows, or that the number typed has none. */
export interface PageCue {
  text: 'live.cued' | 'live.noSuchSlide';
  n: number;
  itemId: string;
}

interface Answer {
  state: PageState;
  live: LivePointerChange | null;
  command: PageCommand | null;
  handled: boolean;
}

/**
 * The page's state, and `send` for its events: the core's answer is kept, its change to the live state set, and its
 * command and whether the event was the page's handed back. `initial` is the state on open.
 */
export function usePageState(o: {
  presentationId: string;
  isTemplate: boolean;
  /** This page is presented, by this window or controlled elsewhere. */
  presenting: boolean;
  pointer: LivePointer;
  order: SlideOrder;
  setLive: (change: LivePointerChange) => void;
  initial: () => Partial<PageState>;
}) {
  const [held, setHeld] = useState<PageState>(() => ({ selectedId: null, picked: null, lastAddedId: null, typed: '', presenting: o.presenting, followed: null, ...o.initial() }));
  const context = { presentationId: o.presentationId, isTemplate: o.isTemplate, presenting: o.presenting, live: o.pointer };
  // What the context changed (presenting started; another item shown by another window, which leaves this window's
  // selection as it is) is the core's too; kept at once, as React keeps
  // state derived during render.
  const model = pageCore().pure<{ state: PageState; canStart: boolean; cue: PageCue | null }>('pageModelView', { state: held, context, order: o.order });
  if (JSON.stringify(model.state) !== JSON.stringify(held)) setHeld(model.state);
  // The latest state, so two events in one moment (two keys) each start from the other's answer; the rendered one
  // once React has drawn it.
  const latest = useRef(model.state);
  useLayoutEffect(() => {
    latest.current = model.state;
  });
  const send = (event: PageEvent): { command: PageCommand | null; handled: boolean } => {
    const answer = pageCore().pure<Answer>('pageEventView', { state: latest.current, context, order: o.order, event });
    latest.current = answer.state;
    setHeld(answer.state);
    if (answer.live) o.setLive(answer.live);
    return answer;
  };
  return { state: model.state, canStart: model.canStart, cue: model.cue, send };
}

/** The page's state and its events, as the page passes them on. */
export type PageControl = ReturnType<typeof usePageState>;
