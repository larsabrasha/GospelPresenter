// This page's own instance of the Rust core, beside the database worker's: for the views that read no database, worked
// out on the page's thread, synchronously (`RustCore.pure`). Presenting's keys and marks (live/presenting.ts), so a key
// reaches the outputs without a round trip to the worker; and the Bible tab's preview, the output's own slides.
import type { Permission, Role, Slide } from '@gp/core';
import { RustCore } from '@gp/rust-core';
import coreUrl from '@gp/rust-core/gp_core.wasm?url';

let core: RustCore | undefined;

/** Loads the page's core: the signed-in app waits for it as it waits for its database (main.tsx). */
export async function loadPageCore(): Promise<void> {
  if (core) return;
  const bytes = await (await fetch(coreUrl)).arrayBuffer();
  core = new RustCore(await WebAssembly.compile(bytes));
}

/** The page's core given, where there is no page to fetch it into: the unit tests (test/setup.ts). */
export function setPageCore(given: RustCore): void {
  core = given;
}

/** The page's core; it must have been loaded (`loadPageCore`). */
export function pageCore(): RustCore {
  if (!core) throw new Error('the page’s core is not loaded (loadPageCore)');
  return core;
}

/**
 * The slides, title and add button's label an item of these verses would have (`bibleSlidesView`): split and titled
 * as `addBibleToPresentation` freezes them, so the Bible tab's preview is what the outputs will show.
 */
export function bibleSlides(translation: string, verses: readonly { b: string; c: number; v: number; t: string }[]): { title: string; label: string; slides: Slide[] } {
  return pageCore().pure<{ title: string; label: string; slides: Slide[] }>('bibleSlidesView', { translation, verses });
}

/** What a reference selects among the books `available` (`verseSearchPlanView`, BIBLE-R11), or null. */
export function verseSearchPlan(query: string, available: readonly string[]): { codes: string[]; from: [number, number]; to: [number, number] } | null {
  return pageCore().pure('verseSearchPlanView', { query, available });
}

/** What the core's mutators hold to (`rulesView`): each role's permissions and the limits of the organisation's data. */
interface Rules {
  permissions: Record<Role, Permission[]>;
  limits: {
    songs: number;
    partsPerSong: number;
    arrangementsPerSong: number;
    itemsPerPresentation: number;
    versesPerItem: number;
    customSlides: number;
    customElements: number;
    customPages: number;
    customText: number;
    fileName: number;
  };
  fields: Record<'presentationName' | 'itemTitle' | 'itemNote' | 'location' | 'description', FieldRule>;
}

/** A field's rule as the core's mutators check it: whether it may be left empty, and its most characters. */
export interface FieldRule {
  required: boolean;
  max: number;
}
let rules: Rules | undefined;
const theRules = () => (rules ??= pageCore().pure<Rules>('rulesView', {}));

/** Whether `role` may do `permission` (`can`), as the core's mutators decide it: a button the core would refuse is not shown. */
export function can(role: Role, permission: Permission): boolean {
  return theRules().permissions[role]?.includes(permission) ?? false;
}

/** The limits of the organisation's data, the core's: a field's length, a button hidden at the limit. */
export const limits = () => theRules().limits;

/** The fields' rules, the core's (docs/view-models.md): whether Spara waits for a word, and a field's length. */
export const fields = () => theRules().fields;

/** A presentation's details dialog as every shell draws it (`detailsDialogView`): its title, field groups and buttons. */
export interface DetailsDialogView {
  title: 'presentations.createTitle' | 'presentation.editDetails';
  groups: ('name' | 'location' | 'date' | 'time' | 'theme' | 'description')[][];
  actions: { id: 'cancel' | 'save'; text: 'common.cancel' | 'common.create' | 'common.save'; busyText: 'common.creating' | null; role: 'cancel' | 'confirm' }[];
}

/** The details dialog of a new presentation, or of one there (`detailsDialogView`). */
export const detailsDialog = (isNew: boolean) => pageCore().pure<DetailsDialogView>('detailsDialogView', { isNew });

/** An action a menu offers, as the core works it out for every shell (docs/view-models.md). */
export interface Action {
  id: string;
  /** Its text's key; the web writes each key out where it draws the action, so the texts' check sees them used. */
  text: string;
  enabled: boolean;
  destructive: boolean;
  /** A submenu's choices: an arrangement's (`name` null: "Arrangemang {n}"), an overlay's (`text` for Ingen). */
  choices?: { id: string; name?: string | null; n?: number; text?: string }[];
  chosen?: string;
}
interface ActionGroups {
  groups: { id: string; actions: Action[] }[];
}

/** The ids of what the presentation's menu offers (`presentationActionsView`): its entries, the same for every shell. */
export function presentationActionIds(isTemplate: boolean, presenting: boolean, role: Role): Set<string> {
  const { groups } = pageCore().pure<ActionGroups>('presentationActionsView', { isTemplate, presenting, role });
  return new Set(groups.flatMap((g) => g.actions.map((a) => a.id)));
}

/**
 * What an item's menu offers (`itemActionsView`), by action id, as every shell offers it: the computer's … and the
 * phone's sheet. `shownId` is the item on the outputs while presenting, black or not.
 */
export function itemActions(args: { item: unknown; song: unknown; arrangements: unknown[]; overlays: unknown[]; shownId: string | null }): Map<string, Action> {
  const { groups } = pageCore().pure<ActionGroups>('itemActionsView', args);
  return new Map(groups.flatMap((g) => g.actions.map((a) => [a.id, a] as const)));
}

/** `text` cut into pieces with the word prefixes matching `query` marked (`highlightView`, SONG-A20), as the core's search reads them. */
export const highlight = (text: string, query: string) => pageCore().pure<{ text: string; hit: boolean }[]>('highlightView', { text, query });

interface BookNames { sv: string; en: string; oldTestament: boolean }
const books = new Map<string, BookNames>();

/** A book's Swedish and English names and its testament (`bibleBookNamesView`, BIBLE-R10), asked once a code. */
export function bookInfo(code: string): BookNames {
  let b = books.get(code);
  if (!b) books.set(code, (b = pageCore().pure<BookNames[]>('bibleBookNamesView', { codes: [code] })[0]!));
  return b;
}
