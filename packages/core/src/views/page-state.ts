// A presentation page's own state, one per window (ADR 0008; ported back from crates/gp-core/src/page_state.rs;
// docs/view-models.md, Lars 2026-11-18): the item selected, the slide made ready (outlined in blue, ↵ shows it), the
// last thing added and a number being typed, changed only here, by the page's events: its keys, a tap, a row chosen,
// an addition. Every shell holds the state and sends its events; what the keys do is the same on each (spec 03
// section 6, spec 04 "Keyboard shortcuts during live"). What only a screen knows stays the shell's: which slide is
// above another in a grid (it sends `pickAt`), where the focus is (it says whether ↵ is the page's), and how long a
// number waits.
//
// The app's live state, which presentation is presented and its slide, is not here: it is read (`context.live`), and
// a change to it comes back as `live`, for the shell to apply through `liveChangeView` (live.ts).
import { removableItem } from '../presenting.ts';
import { argsOf, asBool, asI64, asStr, filled, invalidArgs, isObj, type Obj, sameJson } from './serde.ts';
import { presentingKeyView, slideCounts } from './slides-presenting.ts';

/** A text that is not empty, else none. */
const sOf = (v: unknown): string | null => (filled(v) ? v : null);
const has = (o: Obj, k: string) => Object.hasOwn(o, k);
/** A value an event must carry, else `invalid-args`. */
function need<T>(v: T | null): T {
  if (v === null) throw invalidArgs();
  return v;
}

/** Rust's `str::parse::<i64>`: an optional sign and digits, in range; else none. */
function parseI64(s: string): number | null {
  if (!/^[+-]?[0-9]+$/.test(s)) return null;
  const n = BigInt(s);
  return n >= -(2n ** 63n) && n < 2n ** 63n ? Number(n) : null;
}

/** The last three bytes of a text, as Rust slices it (a cut inside a character panics there). */
function lastThree(s: string): string {
  const points = [...s];
  const size = (c: string) => {
    const n = c.codePointAt(0)!;
    return n < 0x80 ? 1 : n < 0x800 ? 2 : n < 0x10000 ? 3 : 4;
  };
  let bytes = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    bytes += size(points[i]!);
    if (bytes === 3) return points.slice(i).join('');
    if (bytes > 3) throw new Error('byte index is not a char boundary');
  }
  return s;
}

class Page {
  constructor(
    readonly st: Obj,
    readonly presenting: boolean,
    readonly live: Obj,
    /** The item on the outputs while this page is presented, black or not. */
    readonly liveItem: string | null,
    readonly counts: [string, number][],
  ) {}

  get(k: string) {
    return sOf(this.st[k]);
  }
  set(k: string, v: unknown) {
    this.st[k] = v;
  }
  picked(): [string, number] | null {
    const p = this.st.picked;
    if (!isObj(p)) return null;
    const [item, at] = [sOf(p.itemId), asI64(p.partIndex)];
    return item === null || at === null ? null : [item, at];
  }
  count(item: string) {
    return this.counts.find(([i]) => i === item)?.[1] ?? 0;
  }
  has(item: string) {
    return this.counts.some(([i]) => i === item);
  }
  typed() {
    return this.get('typed') ?? '';
  }

  /**
   * What follows from the context before any event: presenting started or ended lets go of the last thing added and
   * the slide made ready. Another item shown, by another window (or a remote control), is only noted: this window's
   * selection and slide made ready stay its own (Lars, 2026-11-18); its own step into another item takes its selection
   * along (`follow`).
   */
  sync() {
    if ((asBool(this.st.presenting) ?? false) !== this.presenting) {
      this.set('presenting', this.presenting);
      this.set('lastAddedId', null);
      this.set('picked', null);
    }
    if (this.presenting && this.get('followed') !== this.liveItem) this.set('followed', this.liveItem);
  }

  /** This window's own change of what is shown: another item shown is the one selected, and lets go of the slide made ready. */
  follow(change: unknown) {
    const item = isObj(change) ? sOf(change.itemId) : null;
    if (item === null || !this.presenting || this.get('followed') === item) return;
    this.set('followed', item);
    this.set('selectedId', item);
    this.set('picked', null);
  }

  /** A key of presenting as `presentingKeyView` answers it: what is shown changes the app's live state, the slide made ready takes the selection along. */
  press(order: unknown, key: Obj): unknown {
    const field = (k: string, otherwise: unknown) => (has(this.live, k) ? this.live[k] : otherwise);
    const shown = {
      itemId: field('itemId', null),
      partIndex: field('partIndex', 0),
      black: field('black', false),
    };
    const picked = has(this.st, 'picked') ? this.st.picked : null;
    const next = presentingKeyView({
      order,
      state: { presenting: this.presenting, shown, picked },
      key,
    });
    if (!sameJson(next.picked, picked)) {
      const item = sOf(next.picked?.itemId);
      if (item !== null) this.set('selectedId', item);
      this.set('picked', next.picked);
    }
    return sameJson(next.shown, shown) ? null : next.shown;
  }
}

function pageOf(a: Obj): { p: Page; order: unknown; cx: Obj } {
  const cx = argsOf(a.context);
  const live = argsOf(cx.live);
  const presenting = asBool(cx.presenting) ?? false;
  const counts = slideCounts(a.order);
  const p = new Page(isObj(a.state) ? { ...a.state } : {}, presenting, live, presenting ? sOf(live.itemId) : null, counts);
  p.sync();
  return { p, order: a.order, cx };
}

/** ▶: not a template, and only while no presentation is presented (one at a time, `liveChangeView`). */
const canStart = (cx: Obj, live: Obj) => cx.isTemplate !== true && sOf(live.presentationId) === null;

const slideAt = (itemId: string, partIndex: number) => ({ itemId, partIndex });

/**
 * `pageEventView` {state, context: {presentationId, isTemplate, presenting, live}, order, event}: the page's state after
 * an event, a change to the app's live state if any, the command the shell carries out (a dialog, a mutation, a scroll),
 * and whether the event was the page's (a key that was not leaves the browser its own use of it).
 *
 * The events: `pick` {delta} (← →), `clicker` {delta} (PageUp/PageDown: steps while presenting, else picks), `step`
 * {delta} (Space, only while presenting), `black` (b and ., only while presenting), `enter` {onPage} (↵: the slide made
 * ready, or a number typed; else, only where the focus is the page's, the next), `escape` (the number, then the slide
 * made ready), `digit` {digit} (that slide of the item made ready, while presenting), `clearTyped` (the number waited
 * long enough), `item` {delta} (⌘↑ ⌘↓: the item before or after, its first slide made ready), `pickAt` {itemId,
 * partIndex} (↑ ↓ as the slides stand on the screen), `show` {itemId, partIndex} (a slide tapped: shown while
 * presenting, else made ready), `select` {itemId} (a row chosen), `added` {itemId}, `move` {by} (⌥↑ ⌥↓), `delete`,
 * `add`, `start` (F5, ⌥⌘P, ▶), `end` (⌘.), `sync` (the context changed), `changed` {itemIds} (the page read again).
 */
export function pageEventView(args: unknown) {
  const a = argsOf(args);
  const { p, order, cx } = pageOf(a);
  const ev = argsOf(a.event);
  const delta = asI64(ev.delta) ?? 1;
  const sign = Math.sign(delta);
  const itemArg = sOf(ev.itemId);
  const needItem = () => need(itemArg);
  const needPart = () => need(asI64(ev.partIndex));
  let live: unknown = null;
  let command: unknown = null;
  let handled = true;
  const type = asStr(ev.type);
  if (type === null) throw invalidArgs();
  switch (type) {
    case 'sync':
      break;
    case 'changed': {
      // The page read again, by a change made here or one a sync brought: never a new page, but this one where it
      // stands (Lars, 2026-11-19). `itemIds` are the items on the screen, the top first; the first still there stays at
      // the top, so one removed gives its place to the next. What the state names and the page no longer has is let go of.
      const onScreen = Array.isArray(ev.itemIds) ? (ev.itemIds as unknown[]) : [];
      const stay = onScreen.map(sOf).find((i): i is string => i !== null && p.has(i)) ?? null;
      const selected = p.get('selectedId');
      if (selected !== null && !p.has(selected)) p.set('selectedId', stay);
      const last = p.get('lastAddedId');
      if (last !== null && !p.has(last)) p.set('lastAddedId', null);
      const picked = p.picked();
      if (picked && picked[1] >= p.count(picked[0])) p.set('picked', null);
      command = { type: 'stay', itemId: stay };
      break;
    }
    case 'pick':
      p.set('typed', '');
      live = p.press(order, { type: 'pick', delta });
      break;
    case 'clicker':
      live = p.press(order, { type: p.presenting ? 'step' : 'pick', delta });
      break;
    case 'step':
      if (p.presenting) live = p.press(order, { type: 'step', delta });
      else handled = false;
      break;
    case 'black':
      if (p.presenting) live = p.press(order, { type: 'black' });
      else handled = false;
      break;
    case 'pickAt': {
      const at = needPart();
      const item = needItem();
      p.set('typed', '');
      p.set('picked', slideAt(item, at));
      p.set('selectedId', item);
      break;
    }
    case 'show': {
      const at = needPart();
      const item = needItem();
      if (p.presenting) {
        p.set('picked', null);
        live = { itemId: item, partIndex: at, black: false };
      } else {
        p.set('picked', slideAt(item, at));
        p.set('selectedId', item);
      }
      break;
    }
    case 'select': {
      const item = needItem();
      p.set('selectedId', item);
      if (p.presenting) p.set('picked', item !== p.liveItem && p.count(item) > 0 ? slideAt(item, 0) : null);
      command = { type: 'reveal', itemId: item };
      break;
    }
    case 'item': {
      if (!p.counts.length) {
        handled = false;
        break;
      }
      // PRES-R41: no wrap; from none, ↓ the first and ↑ the last.
      const n = p.counts.length;
      const selected = p.get('selectedId');
      const at = selected === null ? -1 : p.counts.findIndex(([i]) => i === selected);
      const next = at < 0 ? (delta > 0 ? 0 : n - 1) : Math.min(Math.max(at + sign, 0), n - 1);
      const item = p.counts[next]![0];
      p.set('selectedId', item);
      p.set('typed', '');
      const some = p.count(item) > 0;
      p.set('picked', some && !(p.presenting && item === p.liveItem) ? slideAt(item, 0) : null);
      // One with no slides (a heading) has no outline to follow: the slides go to it all the same (Lars, 2026-11-07).
      command = {
        type: 'item',
        itemId: item,
        reveal: !some,
        focus: p.presenting,
      };
      break;
    }
    case 'move': {
      const item = p.get('selectedId');
      if (item === null) handled = false;
      else command = { type: 'move', itemId: item, by: sign };
      break;
    }
    case 'delete': {
      const item = p.get('selectedId');
      if (item !== null && removableItem(item, p.liveItem)) command = { type: 'remove', itemId: item };
      else handled = false;
      break;
    }
    case 'add':
      command = { type: 'add' };
      break;
    case 'start':
      if (canStart(cx, p.live)) {
        live = {
          presentationId: has(cx, 'presentationId') ? cx.presentationId : null,
          itemId: null,
          partIndex: 0,
          black: false,
        };
        command = { type: 'start' };
      }
      break;
    case 'end':
      if (p.presenting) command = { type: 'end' };
      break;
    case 'digit': {
      if (!p.presenting) {
        handled = false;
        break;
      }
      const d = asI64(ev.digit);
      if (d === null || d < 0 || d > 9) throw invalidArgs();
      const typed = lastThree(p.typed() + String(d));
      p.set('typed', typed);
      const item = p.picked()?.[0] ?? p.get('selectedId') ?? p.liveItem;
      const at = (parseI64(typed) ?? 0) - 1;
      if (item !== null && at >= 0 && at < p.count(item)) p.set('picked', slideAt(item, at));
      break;
    }
    case 'clearTyped':
      p.set('typed', '');
      break;
    case 'escape':
      if (p.typed() !== '') p.set('typed', '');
      else if (p.presenting && p.picked()) {
        live = p.press(order, { type: 'escape' });
        if (p.liveItem !== null) p.set('selectedId', p.liveItem);
      } else handled = false;
      break;
    case 'enter': {
      const onPage = asBool(ev.onPage) ?? false;
      const typed = p.typed();
      if (!p.presenting || !(p.picked() || typed !== '' || onPage)) {
        handled = false;
        break;
      }
      // A number with no such slide shows nothing; with none made ready, the next.
      p.set('typed', '');
      const picked = p.picked();
      const fits = picked !== null && (parseI64(typed) ?? 0) - 1 === picked[1];
      if (typed === '' || fits) live = p.press(order, { type: 'enter' });
      break;
    }
    case 'added': {
      const item = needItem();
      p.set('selectedId', item);
      p.set('lastAddedId', item);
      break;
    }
    default:
      throw invalidArgs();
  }
  p.follow(live);
  return { state: p.st, live, command, handled };
}

/**
 * `pageModelView` {state, context, order}: what the page shows of its state: the state as the context leaves it
 * (`sync`), whether ▶ may start, and the cue said over the live picture: the slide ↵ shows (`live.cued`), or that the
 * number typed has none (`live.noSuchSlide`), each with its number and item.
 */
export function pageModelView(args: unknown) {
  const { p, cx } = pageOf(argsOf(args));
  let cue: unknown = null;
  if (p.presenting) {
    const n = parseI64(p.typed());
    const picked = p.picked();
    const target = picked?.[0] ?? p.get('selectedId') ?? p.liveItem;
    if (n !== null && target !== null && (n < 1 || n > p.count(target))) cue = { text: 'live.noSuchSlide', n, itemId: target };
    else if (picked) cue = { text: 'live.cued', n: picked[1] + 1, itemId: picked[0] };
  }
  return { state: p.st, canStart: canStart(cx, p.live), cue };
}
