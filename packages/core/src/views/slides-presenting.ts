// Presenting's keys and marks (ADR 0008; ported back from crates/gp-core/src/presenting.rs), pure: the web calls them on
// its own thread, so a key reaches the outputs at once. The order is the running order's slides as
// [[itemId, slides]…] (`slideOrder`'s input).
import { argsOf, asBool, asI64, asStr, invalidArgs, isObj, type Obj } from './serde.ts';

/** A slide of the running order; `item` is null for the pointer before anything is shown. */
interface At {
  item: string | null;
  part: number;
}

const same = (a: At, b: At) => a.item === b.item && a.part === b.part;

/**
 * The running order's slide counts, `[[itemId, slides]…]` (`slideOrder`'s input), as presenting and the page read
 * them: a row that is not a text and a whole number from 0 is skipped; an order that is not a list is `invalid-args`.
 */
export function slideCounts(order: unknown): [string, number][] {
  if (!Array.isArray(order)) throw invalidArgs();
  const out: [string, number][] = [];
  for (const r of order as unknown[]) {
    const [item, parts] = Array.isArray(r) ? [asStr(r[0]), asI64(r[1])] : [null, null];
    if (item !== null && parts !== null && parts >= 0) out.push([item, parts]);
  }
  return out;
}

/** `slideOrder`: every slide of the running order, in order. */
const orderOf = (a: Obj): At[] => slideCounts(a.order).flatMap(([item, parts]) => Array.from({ length: parts }, (_, part) => ({ item, part })));

/** A slide as JSON gives it: an `itemId` (a text, else none) and a whole `partIndex`. */
function atOf(v: unknown): At | null {
  if (!isObj(v) || v.itemId === undefined) return null;
  const part = asI64(v.partIndex);
  return part === null ? null : { item: asStr(v.itemId), part };
}

const indexOf = (order: At[], at: At | null) => (at ? order.findIndex((s) => same(s, at)) : -1);

/** `stepped`: the first or the last when `from` is not in the order; none past either end. */
function stepped(order: At[], from: At | null, delta: number): At | null {
  const at = indexOf(order, from);
  const i = at < 0 ? (delta > 0 ? 0 : order.length - 1) : at + delta;
  return order[i] ?? null;
}

/** A slide as the view answers one: no item where `itemId` was not a text. */
interface Slide {
  itemId: string | null;
  partIndex: number;
}

const slide = (a: At): Slide => ({ itemId: a.item, partIndex: a.part });

/**
 * `presentingKeyView` {order, state: {presenting, shown, picked}, key}: what presenting holds after the key, as
 * presentingKey answers it.
 */
export function presentingKeyView(args: unknown): { presenting: boolean; shown: Slide & { black: boolean }; picked: Slide | null } {
  const a = argsOf(args);
  const order = orderOf(a);
  if (!isObj(a.state)) throw invalidArgs();
  const state = a.state;
  const presenting = asBool(state.presenting);
  const shown = atOf(state.shown);
  const black = isObj(state.shown) ? asBool(state.shown.black) : null;
  if (presenting === null || shown === null || black === null || !isObj(a.key)) throw invalidArgs();
  const picked = atOf(state.picked);
  const key = a.key;
  const delta = asI64(key.delta) ?? 0;
  const next = { shown, black, picked };
  switch (asStr(key.type)) {
    case 'step': {
      const n = stepped(order, shown, delta);
      if (n) [next.shown, next.black] = [n, false];
      break;
    }
    case 'pick': {
      const n = stepped(order, picked ?? (presenting && shown.item !== null ? shown : null), delta);
      if (n) next.picked = n;
      break;
    }
    case 'enter':
      if (!presenting) break;
      if (picked) [next.shown, next.black, next.picked] = [picked, false, null];
      else {
        const n = stepped(order, shown, 1);
        if (n) [next.shown, next.black] = [n, false];
      }
      break;
    case 'black':
      if (presenting) next.black = true;
      break;
    case 'escape':
      if (presenting && picked) next.picked = null;
      break;
    default:
      throw invalidArgs();
  }
  return { presenting, shown: { itemId: next.shown.item, partIndex: next.shown.part, black: next.black }, picked: next.picked && slide(next.picked) };
}

/**
 * `slideMarksView` {order, shown}: the slide marked VISAS and the one marked NÄSTA, as slideMarks marks them; either
 * null. VISAS is not marked after Släck (nor any slide when nothing is shown: its itemId is null, as no slide's);
 * NÄSTA still is, from the slide last shown.
 */
export function slideMarksView(args: unknown): { shown: Slide | null; next: Slide | null } {
  const a = argsOf(args);
  const order = orderOf(a);
  const shown = atOf(a.shown);
  if (!shown) throw invalidArgs();
  const black = (isObj(a.shown) && asBool(a.shown.black)) || false;
  const at = indexOf(order, shown);
  const next = at < 0 ? undefined : order[at + 1];
  return { shown: black ? null : slide(shown), next: next ? slide(next) : null };
}
