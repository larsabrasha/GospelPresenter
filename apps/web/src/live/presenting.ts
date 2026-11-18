// Presenting's marks from the Rust core (`slideMarksView`, crates/gp-core/src/presenting.rs), as packages/core's
// slideMarks: pure, so the page calls the core on its own thread, synchronously (docs/rust-core.md, 2.5 step 3). Its
// keys are the page's state's (live/pageState.ts, `pageEventView`).
import type { Presenting, SlideAt, SlideMarkKind } from '@gp/core';
import { pageCore as theCore } from '../db/pageCore.ts';

/** The running order as the core takes it: each item's id and how many slides it has; a heading has none. */
export type SlideOrder = readonly (readonly [itemId: string, parts: number])[];

/** `slideOrder`'s input, as the page has it. */
export const slideOrderOf = (items: readonly { itemId: string; parts: number }[]): SlideOrder => items.map((i) => [i.itemId, i.parts] as const);

const sameAt = (a: { itemId: string | null; partIndex: number } | null, b: { itemId: string | null; partIndex: number } | null) =>
  a === b || (!!a && !!b && a.itemId === b.itemId && a.partIndex === b.partIndex);

/**
 * How each slide is marked while presenting (`slideMarks`): VISAS on the slide shown, NÄSTA on the one → shows next,
 * after Släck too.
 */
export function slideMarks(order: SlideOrder, shown: Presenting['shown']): (itemId: string, partIndex: number) => SlideMarkKind | null {
  const marks = theCore().pure<{ shown: SlideAt | null; next: SlideAt | null }>('slideMarksView', { order, shown });
  return (itemId, partIndex) => (sameAt(marks.shown, { itemId, partIndex }) ? 'shown' : sameAt(marks.next, { itemId, partIndex }) ? 'next' : null);
}
