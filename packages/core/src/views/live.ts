// The app's live state and what a presentation page offers (ADR 0008; ported back from crates/gp-core/src/live_state.rs
// and page_models.rs). The live state is the pointer every window of a device shares (ADR 0007, decision 4;
// docs/view-models.md): which presentation is presented, its slide, black, the overlay shown. It changes only here, so
// every window holds the same rules: one presentation presented at a time, and the overlays' (LIVE-R11, R15, R16).
// Which of two pointers is newer (`rev`) stays the channel's between windows. A page's menus and dialog are worked out
// here once, as the web had them (docs/view-models.md); the page draws what these answer.
import { MutationError } from '../mutation.ts';
import { can, type Permission, type Role } from '../permissions.ts';
import { ORIGINAL_ARRANGEMENT } from '../mutators/base.ts';

type Obj = Record<string, unknown>;

const invalid = () => new MutationError('invalid-args', 'arguments');
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const objOf = (v: unknown): Obj => {
  if (!isObj(v)) throw invalid();
  return v;
};
/** JavaScript's truthiness of an id: a string that is not empty. */
const some = (v: unknown): v is string => typeof v === 'string' && v !== '';
/** Two JSON values alike, as the Rust core compared them. */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
  const a = objOf(args);
  const prev = objOf(a.pointer);
  const change = objOf(a.change);
  const overlays = isObj(a.overlays) ? a.overlays : {};
  const overlayOf = (item: unknown) => (some(item) && Object.hasOwn(overlays, item) ? overlays[item] : null);
  const was = (k: string) => (Object.hasOwn(prev, k) ? prev[k] : null);
  if (Object.hasOwn(change, 'presentationId')) {
    const to = change.presentationId;
    if (some(to) && some(was('presentationId')) && !same(to, was('presentationId'))) return { refused: 'another-presented' };
  }
  const next: Obj = {};
  for (const k of FIELDS) next[k] = Object.hasOwn(change, k) ? change[k] : was(k);
  const rev = (typeof prev.rev === 'number' ? prev.rev : 0) + 1;
  const done = () => ({ pointer: { ...next, rev } });
  if (Object.hasOwn(change, 'overlayId')) {
    if (some(change.overlayId)) next.black = false;
    return done();
  }
  if (!some(next.presentationId) || next.black === true) {
    next.overlayId = null;
    return done();
  }
  if (was('black') === true) {
    next.overlayId = overlayOf(next.itemId);
    return done();
  }
  if (same(next.itemId, was('itemId'))) return done();
  const left = overlayOf(was('itemId'));
  const entered = overlayOf(next.itemId);
  const kept = some(left) && same(was('overlayId'), left) ? null : was('overlayId');
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
  const a = objOf(args);
  const p = objOf(a.pointer);
  const none = { change: false };
  if (!some(p.presentationId) || !some(p.itemId) || p.black === true) return none;
  if (!Object.hasOwn(a, 'before')) return none;
  const before = a.before;
  if (Object.hasOwn(a, 'after') && same(before, a.after)) return none;
  if (!same(Object.hasOwn(p, 'overlayId') ? p.overlayId : null, before)) return none;
  return { change: true, overlayId: Object.hasOwn(a, 'after') ? a.after : null };
}

// ------------------------------------------------------------------ what a page offers

/** A string argument that JavaScript would take as given: empty and missing alike are "none". */
const given = (a: Obj, k: string) => (some(a[k]) ? (a[k] as string) : undefined);

/**
 * `addPositionView` {order, shownId, lastAddedId, chosenId, selectedId}: the item something added goes after, one rule
 * for every layout (Lars, 2026-11-18). The one chosen in an item's menu ("Lägg till efter"). While presenting (the item
 * on the outputs, black or not): the last thing added while it is still ahead of the shown item, so several additions
 * keep their order, else the shown item. With nothing shown: the selected item, else the last thing added. Null: at the
 * end. An id not in `order` (an item gone) counts as none.
 */
function addPositionView(args: unknown) {
  const a = objOf(args);
  if (!Array.isArray(a.order) || !a.order.every((v) => typeof v === 'string')) throw invalid();
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

/** An action's or a button's icon, as the web draws it, by a name of the app's own (Lars, 2026-11-21). */
function iconOf(id: string): string {
  switch (id) {
    case 'rename':
    case 'edit':
    case 'editImages':
    case 'editDetails':
      return 'edit';
    case 'note':
      return 'comment';
    case 'arrangement':
    case 'overlay':
    case 'tick':
      return id;
    case 'addAfter':
    case 'add':
    case 'new':
      return 'add';
    case 'black':
      return 'display';
    case 'delete':
    case 'trash':
      return 'delete';
    case 'materials':
      return 'song';
    case 'saveAsTemplate':
      return 'duplicate';
    case 'back':
      return 'back';
    case 'start':
      return 'play';
    case 'end':
      return 'stop';
    case 'fold':
      return 'sidebar';
    default:
      return kindIcon(id);
  }
}

/** The kinds Lägg till offers, in the web's order (AddItemDialog.tsx's tabs, then Programpunkt apart). */
const ADD_KINDS = [
  ['song', 'add.song'],
  ['bible', 'add.bible'],
  ['image', 'add.image'],
  ['audio', 'presentation.audioTab'],
  ['video', 'presentation.videoTab'],
  ['slides', 'add.slides'],
  ['header', 'header.kind'],
] as const;

const kindIcon = (kind: string) => (ADD_KINDS.some(([k]) => k === kind) ? kind : 'none');

/** The kinds to add, as choices of Lägg till (efter) ›; Programpunkt in a group of its own, after a line. */
const addKinds = () => ADD_KINDS.map(([id, text]) => ({ id, text, icon: kindIcon(id), apart: id === 'header' }));

/** An action of a menu: its id, its text's key, its icon, whether it may be done now, red when it removes something. */
const action = (id: string, text: string): Obj => ({ id, text, icon: iconOf(id), enabled: true, destructive: false });

const group = (id: string, actions: Obj[]) => (actions.length ? [{ id, actions }] : []);

/** Rust's `can`: the roles it knows, nothing for another. */
const roleCan = (role: unknown, permission: Permission) => (role === 'user' || role === 'admin' || role === 'superAdmin') && can(role as Role, permission);

/**
 * `presentationActionsView` {isTemplate, presenting, role}: the presentation's menu behind its title (the web's
 * PresentationMenu.tsx): Redigera detaljer… and, but for a template, Noter och länkar; Spara som mall… for one who may
 * manage templates, but for a template; and to the trash unless it is being presented.
 */
function presentationActionsView(args: unknown) {
  const a = objOf(args);
  if (typeof a.isTemplate !== 'boolean' || typeof a.presenting !== 'boolean') throw invalid();
  const template = a.isTemplate;
  const details = [action('editDetails', 'presentation.editDetailsMenu'), ...(template ? [] : [action('materials', 'material.title')])];
  const save = !template && roleCan(a.role, 'ManageTemplates') ? [action('saveAsTemplate', 'templates.saveAsMenu')] : [];
  const trash = { ...action('trash', template ? 'templates.trash' : 'presentation.trash'), destructive: true };
  return { groups: [...group('details', details), ...group('template', save), ...group('remove', a.presenting ? [] : [trash])] };
}

/** Whether an item may be removed: not the one on the outputs (`shown`, black or not). */
const removable = (item: string, shown: string | undefined) => shown !== item;

/**
 * `itemActionsView` {item, song, arrangements, overlays, shownId}: an item's menu (the web's ItemContextMenu.tsx), the
 * same on its row, its heading's … and a phone's sheet: opening it and Kommentar; Arrangemang › for a song not in the
 * trash with arrangements, and Överlägg › while there are overlays, for anything but a programme item; Lägg till efter
 * › and Markera; and Radera, not for the item on the outputs (Lars, 2026-11-18).
 */
function itemActionsView(args: unknown) {
  const a = objOf(args);
  const item = objOf(a.item);
  const kind = typeof item.type === 'string' ? item.type : 'song';
  if (typeof item.id !== 'string') throw invalid();
  const songHere = kind === 'song' && isObj(a.song) && (a.song.deletedAt === null || a.song.deletedAt === undefined);
  const list = (k: string) => (Array.isArray(a[k]) ? (a[k] as unknown[]) : []);
  const open: Obj[] = [];
  if (kind === 'header') open.push(action('rename', 'header.rename'));
  if (kind === 'custom' || songHere) open.push(action('edit', 'presentation.editSong'));
  if (kind === 'image') open.push(action('editImages', 'presentation.editImages'));
  open.push(action('note', 'note.title'));
  const show: Obj[] = [];
  if (kind !== 'header') {
    const arrangements = songHere ? list('arrangements') : [];
    // Original first, the song's parts in their own order, beside an arrangement of its own (Lars, 2026-11-19).
    if (arrangements.length) {
      const field = (x: unknown, k: string) => (isObj(x) && Object.hasOwn(x, k) ? x[k] : null);
      const choices = [{ id: ORIGINAL_ARRANGEMENT, text: 'song.original' }, ...arrangements.map((x, n) => ({ id: field(x, 'id'), name: field(x, 'name'), n: n + 1 }))];
      const chosen = typeof item.arrangementId === 'string' ? item.arrangementId : field(arrangements[0], 'id');
      show.push({ ...action('arrangement', 'song.arrangements'), choices, chosen });
    }
    const overlays = list('overlays');
    if (overlays.length) {
      const field = (x: unknown, k: string) => (isObj(x) && Object.hasOwn(x, k) ? x[k] : null);
      const choices = [{ id: '', text: 'overlays.itemNone' }, ...overlays.map((o) => ({ id: field(o, 'id'), name: field(o, 'title') }))];
      show.push({ ...action('overlay', 'overlays.itemOverlay'), choices, chosen: typeof item.overlayId === 'string' ? item.overlayId : '' });
    }
  }
  const listing = [{ ...action('addAfter', 'live.addAfter'), choices: addKinds() }, action('tick', 'presentation.tick')];
  const ok = removable(item.id, given(a, 'shownId'));
  const remove = { ...action('delete', ok ? 'common.delete' : 'live.shownCannotRemove'), enabled: ok, destructive: true };
  return { groups: [...group('open', open), ...group('show', show), ...group('list', listing), ...group('remove', [remove])] };
}

/**
 * `detailsDialogView` {isNew}: a presentation's details dialog: its title, its fields in their groups in order (the
 * theme only for one there), and its buttons in order: Avbryt, then Skapa (Skapar… while it works) for a new one,
 * Spara for one there.
 */
function detailsDialogView(args: unknown) {
  const a = objOf(args);
  if (typeof a.isNew !== 'boolean') throw invalid();
  const isNew = a.isNew;
  return {
    title: isNew ? 'presentations.createTitle' : 'presentation.editDetails',
    groups: [['name', 'location'], ['date', 'time'], ...(isNew ? [] : [['theme']]), ['description']],
    actions: [
      { id: 'cancel', text: 'common.cancel', role: 'cancel' },
      { id: 'save', text: isNew ? 'common.create' : 'common.save', busyText: isNew ? 'common.creating' : null, role: 'confirm' },
    ],
  };
}

export const pureViews = { liveChangeView, followItemOverlayView, addPositionView, presentationActionsView, itemActionsView, detailsDialogView };
