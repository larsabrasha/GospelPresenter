// Presenting's keys and marks from the Rust core (`presentingKeyView`, `slideMarksView`, crates/gp-core/src/presenting.rs),
// as packages/core's presentingKey and slideMarks: pure, so the page calls the core on its own thread, synchronously,
// and a key reaches the outputs without a round trip to the database's worker (docs/rust-core.md, 2.5 step 3).
import type { Presenting, PresentingKey, SlideAt, SlideMarkKind } from '@gp/core';
import { RustCore } from '@gp/rust-core';
import coreUrl from '@gp/rust-core/gp_core.wasm?url';

let core: RustCore | undefined;

/** This page's own instance of the core: the signed-in app waits for it as it waits for its database (main.tsx). */
export async function loadPresentingCore(): Promise<void> {
  if (core) return;
  const bytes = await (await fetch(coreUrl)).arrayBuffer();
  core = new RustCore(await WebAssembly.compile(bytes));
}

function theCore(): RustCore {
  if (!core) throw new Error('presenting: the core is not loaded (loadPresentingCore)');
  return core;
}

/** The running order as the core takes it: each item's id and how many slides it has; a heading has none. */
export type SlideOrder = readonly (readonly [itemId: string, parts: number])[];

/** `slideOrder`'s input, as the page has it. */
export const slideOrderOf = (items: readonly { itemId: string; parts: number }[]): SlideOrder => items.map((i) => [i.itemId, i.parts] as const);

const sameAt = (a: { itemId: string | null; partIndex: number } | null, b: { itemId: string | null; partIndex: number } | null) =>
  a === b || (!!a && !!b && a.itemId === b.itemId && a.partIndex === b.partIndex);

/**
 * What presenting holds after `key` (`presentingKey`). A part whose value does not change keeps its object, so the page
 * tells by identity what to send on: a new `shown` to the outputs, a new `picked` to the outline.
 */
export function presentingKey(order: SlideOrder, state: Presenting, key: PresentingKey): Presenting {
  const next = theCore().pure<Presenting>('presentingKeyView', { order, state, key });
  const shown = sameAt(next.shown, state.shown) && next.shown.black === state.shown.black ? state.shown : next.shown;
  const picked = sameAt(next.picked, state.picked) ? state.picked : next.picked;
  return shown === state.shown && picked === state.picked && next.presenting === state.presenting ? state : { presenting: next.presenting, shown, picked };
}

/**
 * How each slide is marked while presenting (`slideMarks`): VISAS on the slide shown, NÄSTA on the one → shows next,
 * after Släck too.
 */
export function slideMarks(order: SlideOrder, shown: Presenting['shown']): (itemId: string, partIndex: number) => SlideMarkKind | null {
  const marks = theCore().pure<{ shown: SlideAt | null; next: SlideAt | null }>('slideMarksView', { order, shown });
  return (itemId, partIndex) => (sameAt(marks.shown, { itemId, partIndex }) ? 'shown' : sameAt(marks.next, { itemId, partIndex }) ? 'next' : null);
}
