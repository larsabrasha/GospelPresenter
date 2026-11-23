// Presenting's keys (spec 04 "Keyboard shortcuts during live") and its marks, as the shells hold them: the keys and
// the marks themselves are the Rust core's (`presentingKeyView`, `slideMarksView`, crates/gp-core/src/presenting.rs).

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

/** How a slide is marked while presenting: shown now, or the one → shows next. */
export type SlideMarkKind = 'shown' | 'next';

/**
 * Whether an item may be removed: not the one on the outputs, black or not (`shownId`); removed after Släck, the next →
 * would start the order over (Lars, 2026-11-18).
 */
export const removableItem = (itemId: string, shownId: string | null | undefined) => itemId !== shownId;
