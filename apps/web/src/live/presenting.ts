// Presenting's marks (the core's `presentingMarks`), on the page's own thread, at once. Its keys are the page's
// state's (live/pageState.ts, `pageEvent`).
import type { Presenting, SlideMarkKind } from '@gp/core';
import { presentingMarks, type SlideOrder } from '@gp/core/core';

export type { SlideOrder } from '@gp/core/core';

/** `slideOrder`'s input, as the page has it. */
export const slideOrderOf = (items: readonly { itemId: string; parts: number }[]): SlideOrder => items.map((i) => [i.itemId, i.parts] as const);

const sameAt = (a: { itemId: string | null; partIndex: number } | null, b: { itemId: string | null; partIndex: number } | null) =>
  a === b || (!!a && !!b && a.itemId === b.itemId && a.partIndex === b.partIndex);

/**
 * How each slide is marked while presenting (`slideMarks`): VISAS on the slide shown, NÄSTA on the one → shows next,
 * after Släck too.
 */
export function slideMarks(order: SlideOrder, shown: Presenting['shown']): (itemId: string, partIndex: number) => SlideMarkKind | null {
  const marks = presentingMarks(order, shown);
  return (itemId, partIndex) => (sameAt(marks.shown, { itemId, partIndex }) ? 'shown' : sameAt(marks.next, { itemId, partIndex }) ? 'next' : null);
}
