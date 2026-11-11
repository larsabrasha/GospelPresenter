// The running order while presenting (docs/layout-2-0.md): where an addition goes, and when the list follows the
// shown part.

/**
 * The item something added while presenting goes after: the one chosen in an item's … menu ("Lägg till efter");
 * else the last thing added, while it is still ahead of the shown item, so several additions keep the order they
 * were added in; else the shown item. With nothing shown, the selected item, as the editor adds.
 */
export function addAfter({
  order,
  shownId,
  lastAddedId,
  chosenId,
  selectedId = null,
}: {
  order: readonly string[];
  shownId: string | null;
  lastAddedId: string | null;
  chosenId: string | null;
  selectedId?: string | null;
}): string | null {
  if (chosenId && order.includes(chosenId)) return chosenId;
  const shown = shownId ? order.indexOf(shownId) : -1;
  const last = lastAddedId ? order.indexOf(lastAddedId) : -1;
  if (last !== -1 && last > shown) return lastAddedId;
  return shown !== -1 ? shownId : selectedId;
}

/**
 * Whether the list scrolls to the shown part: never after a tap in the list, where the part is under the finger;
 * otherwise (the arrows, someone controlling it remotely) only when the part is out of view, above the
 * sticky heading or below the bottom. `top` and `bottom` are the part's, relative to the list's visible top.
 */
export function followsShown({ byTap, top, bottom, viewHeight, headingHeight }: { byTap: boolean; top: number; bottom: number; viewHeight: number; headingHeight: number }): boolean {
  if (byTap) return false;
  return top < headingHeight || bottom > viewHeight;
}

/**
 * What an item's menu in the live list offers (docs/layout-2-0.md): moving it up or down while there is room, and
 * removing it unless it is the one shown.
 */
export function itemActions(order: readonly string[], itemId: string, shownId: string | null): { up: boolean; down: boolean; remove: boolean } {
  const at = order.indexOf(itemId);
  return { up: at > 0, down: at !== -1 && at < order.length - 1, remove: itemId !== shownId };
}

/** How a slide is marked while presenting: shown now, or the one → shows next. */
export type SlideMarkKind = 'shown' | 'next';

/**
 * The marks of the running order's slides, the same on a computer and a phone (Lars, 2026-11-02): VISAS on the slide
 * shown, NÄSTA on the one → shows next, after Släck too, from the slide last shown (Lars, 2026-11-01).
 */
export function slideMarks(
  order: readonly { itemId: string; parts: number }[],
  pointer: { itemId: string | null; partIndex: number; black: boolean },
): (itemId: string, partIndex: number) => SlideMarkKind | null {
  const steps = order.flatMap((o) => Array.from({ length: o.parts }, (_, partIndex) => ({ itemId: o.itemId, partIndex })));
  const at = steps.findIndex((s) => s.itemId === pointer.itemId && s.partIndex === pointer.partIndex);
  const next = at === -1 ? null : (steps[at + 1] ?? null);
  return (itemId, partIndex) => {
    if (!pointer.black && itemId === pointer.itemId && partIndex === pointer.partIndex) return 'shown';
    if (next && itemId === next.itemId && partIndex === next.partIndex) return 'next';
    return null;
  };
}
