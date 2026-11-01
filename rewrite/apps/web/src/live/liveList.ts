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

/** What the folded outputs say: how many are on and how many watch, or what is wrong. */
export type OutputsState = { kind: 'off' } | { kind: 'on'; on: number; viewers: number } | { kind: 'offline'; name: string };

/**
 * The outputs folded to one line: an output chosen but gone (a saved screen whose page closed) first, as that is
 * what needs doing; else how many are on, the output window counted, and how many watch the public ones.
 */
export function outputsState(externalOn: boolean, outputs: readonly { name: string; chosen: boolean; sending: boolean; offline: boolean; viewers?: number }[]): OutputsState {
  const gone = outputs.find((o) => o.chosen && o.offline);
  if (gone) return { kind: 'offline', name: gone.name };
  const on = outputs.filter((o) => o.sending);
  const count = on.length + (externalOn ? 1 : 0);
  if (!count) return { kind: 'off' };
  return { kind: 'on', on: count, viewers: on.reduce((n, o) => n + (o.viewers ?? 0), 0) };
}
