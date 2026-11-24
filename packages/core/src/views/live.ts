// The app's live state and what a presentation page offers (ADR 0008; ported back from crates/gp-core/src/live_state.rs
// and page_models.rs). The live state is the pointer every window of a device shares (ADR 0007, decision 4;
// docs/view-models.md): which presentation is presented, its slide, black, the overlay shown. It changes only here, so
// every window holds the same rules: one presentation presented at a time, and the overlays' (LIVE-R11, R15, R16).
// Which of two pointers is newer (`rev`) stays the channel's between windows. And where Lägg till puts what it adds.
import { argsOf, filled, invalidArgs, isObj, type Obj, sameJson } from './serde.ts';

const FIELDS = ['presentationId', 'itemId', 'partIndex', 'black', 'overlayId'] as const;

/**
 * `liveChangeView` {pointer, change, overlays}: the pointer after `change`, numbered one after it (`rev`), with the
 * overlay rules of `applyLiveChange`; `overlays` names the overlay each item carries (an item's id to its overlay's or
 * null). A change that would start a presentation while another is presented is refused, `another-presented`: the one
 * presented is ended first (Lars, 2026-11-18). {pointer} or {refused}.
 *
 * The overlay rules: a change that names `overlayId` is a manual toggle, which sets it, and showing one ends the black
 * screen (LIVE-R11); black and stopping switch it off; a slide shown again after black switches on the overlay its
 * item carries; moving to another item switches off the overlay the item left carries, if that is still the one shown,
 * and switches on the one the new item carries, a manual choice staying until the item changes and after it when it
 * was not the left item's own (LIVE-R15, R16).
 */
function liveChangeView(args: unknown) {
  const a = argsOf(args);
  const prev = argsOf(a.pointer);
  const change = argsOf(a.change);
  const overlays = isObj(a.overlays) ? a.overlays : {};
  const overlayOf = (item: unknown) => (filled(item) && Object.hasOwn(overlays, item) ? overlays[item] : null);
  const was = (k: string) => (Object.hasOwn(prev, k) ? prev[k] : null);
  if (Object.hasOwn(change, 'presentationId')) {
    const to = change.presentationId;
    if (filled(to) && filled(was('presentationId')) && !sameJson(to, was('presentationId'))) return { refused: 'another-presented' };
  }
  const next: Obj = {};
  for (const k of FIELDS) next[k] = Object.hasOwn(change, k) ? change[k] : was(k);
  const rev = (typeof prev.rev === 'number' ? prev.rev : 0) + 1;
  const done = () => ({ pointer: { ...next, rev } });
  if (Object.hasOwn(change, 'overlayId')) {
    if (filled(change.overlayId)) next.black = false;
    return done();
  }
  if (!filled(next.presentationId) || next.black === true) {
    next.overlayId = null;
    return done();
  }
  if (was('black') === true) {
    next.overlayId = overlayOf(next.itemId);
    return done();
  }
  if (sameJson(next.itemId, was('itemId'))) return done();
  const left = overlayOf(was('itemId'));
  const entered = overlayOf(next.itemId);
  const kept = filled(left) && sameJson(was('overlayId'), left) ? null : was('overlayId');
  next.overlayId = entered === null || entered === undefined ? kept : entered;
  return done();
}

/**
 * `followItemOverlayView` {pointer, before?, after?}: the overlay to show when the shown item's own overlay is changed
 * while it is presented (Lars, 2026-11-02: at once): the new one, if the outputs show the item's old one; else nothing
 * to change, as when black, nothing shown, the old one not known (`before` left out) or a manual choice standing.
 * {change: false} or {change: true, overlayId}.
 */
function followItemOverlayView(args: unknown) {
  const a = argsOf(args);
  const p = argsOf(a.pointer);
  const none = { change: false };
  if (!filled(p.presentationId) || !filled(p.itemId) || p.black === true) return none;
  if (!Object.hasOwn(a, 'before')) return none;
  const before = a.before;
  if (Object.hasOwn(a, 'after') && sameJson(before, a.after)) return none;
  if (!sameJson(Object.hasOwn(p, 'overlayId') ? p.overlayId : null, before)) return none;
  return { change: true, overlayId: Object.hasOwn(a, 'after') ? a.after : null };
}

// ------------------------------------------------------------------ what a page offers

/** A string argument that JavaScript would take as given: empty and missing alike are "none". */
const given = (a: Obj, k: string) => (filled(a[k]) ? (a[k] as string) : undefined);

/**
 * `addPositionView` {order, shownId, lastAddedId, chosenId, selectedId}: the item something added goes after, one rule
 * for every layout (Lars, 2026-11-18). The one chosen in an item's menu ("Lägg till efter"). While presenting (the item
 * on the outputs, black or not): the last thing added while it is still ahead of the shown item, so several additions
 * keep their order, else the shown item. With nothing shown: the selected item, else the last thing added. Null: at the
 * end. An id not in `order` (an item gone) counts as none.
 */
function addPositionView(args: unknown) {
  const a = argsOf(args);
  if (!Array.isArray(a.order) || !a.order.every((v) => typeof v === 'string')) throw invalidArgs();
  const order = a.order as string[];
  const here = (k: string) => {
    const id = given(a, k);
    return id !== undefined && order.includes(id) ? id : undefined;
  };
  const chosen = here('chosenId');
  if (chosen !== undefined) return chosen;
  const last = here('lastAddedId');
  const shown = here('shownId');
  if (shown !== undefined) return last !== undefined && order.indexOf(last) > order.indexOf(shown) ? last : shown;
  return here('selectedId') ?? last ?? null;
}

export const pureViews = { liveChangeView, followItemOverlayView, addPositionView };
