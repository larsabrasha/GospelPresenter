// A presentation page's own state, the core's (`pageEvent`, `pageModel`; docs/view-models.md): the item selected, the
// slide made ready, the last thing added and a number typed. This window holds it; every change is the core's answer
// to an event, so a computer and a phone do the same with the same keys and taps. A change to what the outputs show
// comes back with the answer and goes to the app's live state (LiveChannel, `liveChange`).
import type { LivePointer, LivePointerChange } from '@gp/core';
import { pageEvent, pageModel, type PageEvent, type PageState } from '@gp/core/core';
import { useLayoutEffect, useRef, useState } from 'react';
import type { SlideOrder } from './presenting.ts';

export type { PageCommand, PageEvent, PageState } from '@gp/core/core';

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
  const model = pageModel(held, context, o.order);
  if (JSON.stringify(model.state) !== JSON.stringify(held)) setHeld(model.state);
  // The latest state, so two events in one moment (two keys) each start from the other's answer; the rendered one
  // once React has drawn it.
  const latest = useRef(model.state);
  useLayoutEffect(() => {
    latest.current = model.state;
  });
  const send = (event: PageEvent) => {
    const answer = pageEvent(latest.current, context, o.order, event);
    latest.current = answer.state;
    setHeld(answer.state);
    if (answer.live) o.setLive(answer.live);
    return answer;
  };
  return { state: model.state, canStart: model.canStart, cue: model.cue, send };
}

/** The page's state and its events, as the page passes them on. */
export type PageControl = ReturnType<typeof usePageState>;
