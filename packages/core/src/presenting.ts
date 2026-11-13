// Presenting's keys (spec 04 "Keyboard shortcuts during live"; the web's useEditorKeys.ts) and its marks, as pure
// functions every shell calls: the web's presentation page now, a native app or MCP the same way. A shell holds the
// state, sends what was pressed, and shows what comes back.

/** A slide of the running order: its item, and its place among the item's slides. */
export interface SlideAt {
  itemId: string;
  partIndex: number;
}

/** What presenting holds: whether this window presents, what the outputs show, and the slide made ready. */
export interface Presenting {
  presenting: boolean;
  /** The live pointer's slide: no item before anything is shown; `black` is Släck. */
  shown: { itemId: string | null; partIndex: number; black: boolean };
  /** Outlined in blue: before presenting the slide picked, while presenting the one ↵ shows. */
  picked: SlideAt | null;
}

/**
 * A key: `step` steps what is shown (Space, PageDown and PageUp, a clicker), `pick` moves the outline (← →), `enter`
 * is ↵, `black` is b and `.` (Släck), `escape` lets go of the outline.
 */
export type PresentingKey = { type: 'step'; delta: number } | { type: 'pick'; delta: number } | { type: 'enter' } | { type: 'black' } | { type: 'escape' };

/** Every slide of the running order, in order: what the keys step through. A heading has none. */
export function slideOrder(items: readonly { itemId: string; parts: number }[]): SlideAt[] {
  return items.flatMap((o) => Array.from({ length: o.parts }, (_, partIndex) => ({ itemId: o.itemId, partIndex })));
}

const indexOf = (order: readonly SlideAt[], at: { itemId: string | null; partIndex: number } | null) =>
  at ? order.findIndex((s) => s.itemId === at.itemId && s.partIndex === at.partIndex) : -1;

/** `delta` slides from `from`: the first or the last when `from` is not in the order; none past either end. */
function stepped(order: readonly SlideAt[], from: { itemId: string | null; partIndex: number } | null, delta: number): SlideAt | null {
  const at = indexOf(order, from);
  return order[at === -1 ? (delta > 0 ? 0 : order.length - 1) : at + delta] ?? null;
}

/**
 * What presenting holds after `key`. A part that does not change keeps its object, so a shell can tell what to send
 * on: a new `shown` to the outputs, a new `picked` to the outline.
 *
 * Stepping what is shown ends Släck. The outline moves from where it is; while presenting, its first move starts from
 * the slide shown. ↵ shows the slide made ready, else the next; b blacks; Escape lets go of the outline. ↵, b and
 * Escape do nothing before presenting.
 */
export function presentingKey(order: readonly SlideAt[], state: Presenting, key: PresentingKey): Presenting {
  switch (key.type) {
    case 'step': {
      const next = stepped(order, state.shown, key.delta);
      return next ? { ...state, shown: { ...next, black: false } } : state;
    }
    case 'pick': {
      const from = state.picked ?? (state.presenting && state.shown.itemId ? state.shown : null);
      const next = stepped(order, from, key.delta);
      return next ? { ...state, picked: next } : state;
    }
    case 'enter':
      if (!state.presenting) return state;
      if (state.picked) return { ...state, shown: { ...state.picked, black: false }, picked: null };
      return presentingKey(order, state, { type: 'step', delta: 1 });
    case 'black':
      return state.presenting ? { ...state, shown: { ...state.shown, black: true } } : state;
    case 'escape':
      return state.presenting && state.picked ? { ...state, picked: null } : state;
  }
}

/** How a slide is marked while presenting: shown now, or the one → shows next. */
export type SlideMarkKind = 'shown' | 'next';

/**
 * The marks of the running order's slides, the same on a computer and a phone (Lars, 2026-11-02): VISAS on the slide
 * shown, NÄSTA on the one → shows next, after Släck too, from the slide last shown (Lars, 2026-11-01).
 */
export function slideMarks(order: readonly SlideAt[], shown: Presenting['shown']): (itemId: string, partIndex: number) => SlideMarkKind | null {
  const at = indexOf(order, shown);
  const next = at === -1 ? null : (order[at + 1] ?? null);
  return (itemId, partIndex) => {
    if (!shown.black && itemId === shown.itemId && partIndex === shown.partIndex) return 'shown';
    if (next && itemId === next.itemId && partIndex === next.partIndex) return 'next';
    return null;
  };
}
