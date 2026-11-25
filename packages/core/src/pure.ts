// The core's views that read no database, as typed functions a page calls on its own thread, at once: presenting's
// keys and marks (so a key reaches the outputs without a round trip to the database's worker), the live pointer's
// rules, a Bible passage's slides, the song import's reading and comparing, the search's marking and how the sync
// stands. The views themselves (views/, sync-status.ts) take their arguments as JSON did when they were the Rust
// core's; these give them their types.
import type { BibleBookText } from './bible.ts';
import { runPureView } from './commands.ts';
import type { LivePointer, LivePointerChange } from './live.ts';
import type { SlideAt } from './presenting.ts';
import type { Slide } from './slides.ts';
import type { SyncStatus } from './sync-status.ts';
import { importZip } from './views/files-bible-import.ts';

export { sortBibleBooks } from './views/files-bible-import.ts';
export type { ImportedSong } from './views/files-propresenter.ts';
export { proPresenterSong } from './views/files-propresenter.ts';
export { bibleItemContent } from './views/slides-items.ts';
export type { SyncStatus } from './sync-status.ts';

const view = <T>(name: string, args: object) => runPureView(name, args) as T;

// ------------------------------------------------------------------ presenting

/** The running order as presenting takes it: each item's id and how many slides it has; a heading has none. */
export type SlideOrder = readonly (readonly [itemId: string, parts: number])[];

/** The slide shown and the one → shows next (VISAS and NÄSTA), after Släck too. */
export const presentingMarks = (order: SlideOrder, shown: { itemId: string | null; partIndex: number; black: boolean } | null) => view<{ shown: SlideAt | null; next: SlideAt | null }>('slideMarksView', { order, shown });

/**
 * The item something added goes after, one rule for the computer and the phone: the one chosen in an item's … menu
 * ("Lägg till efter"); while presenting, the last thing added while it is still ahead of the shown item, so several
 * additions keep the order they were added in, else the shown item; before, the selected item, else the last thing
 * added (a phone has no selection). Null: at the end.
 */
export const addPosition = (place: { order: readonly string[]; shownId: string | null; lastAddedId: string | null; chosenId: string | null; selectedId?: string | null }) =>
  view<string | null>('addPositionView', place);

// ------------------------------------------------------------------ the live pointer

/** The pointer after `change`, by the overlays' rules (LIVE-R11, R15, R16), or refused: another presentation is presented. */
export const liveChange = (pointer: LivePointer, change: LivePointerChange, overlays: Record<string, string | null>) =>
  view<{ pointer?: LivePointer; refused?: string }>('liveChangeView', { pointer, change, overlays });

/**
 * Whether the outputs follow a change of the shown item's own overlay, and to which, unless a manual choice stands.
 * `before` and `after` are left out where the item's overlay was not known.
 */
export const followItemOverlay = (pointer: LivePointer, before: string | null | undefined, after: string | null | undefined) =>
  view<{ change: boolean; overlayId?: string | null }>('followItemOverlayView', { pointer, before, after });

// ------------------------------------------------------------------ a presentation page's state

/** The page's state: the item selected, the slide made ready, the last thing added and a number typed. */
export interface PageState {
  selectedId: string | null;
  /** The slide made ready, outlined in blue: ↵ shows it while presenting; before, the one pointed out. */
  picked: SlideAt | null;
  /** The last thing added, which the next addition follows (`addPosition`). */
  lastAddedId: string | null;
  /** A number typed while presenting: that slide of the item is made ready. */
  typed: string;
  presenting: boolean;
  /** The item last shown, so another one shown is selected. */
  followed: string | null;
}

/** An event of the page. */
export type PageEvent =
  | { type: 'pick' | 'clicker' | 'step' | 'item' | 'move'; delta: number }
  | { type: 'black' | 'escape' | 'clearTyped' | 'delete' | 'add' | 'start' | 'end' | 'sync' }
  | { type: 'enter'; onPage: boolean }
  | { type: 'digit'; digit: number }
  | ({ type: 'pickAt' | 'show' } & SlideAt)
  | { type: 'select' | 'added'; itemId: string };

/** What the page does after an event: the core decides that it is done, the page how. */
export type PageCommand =
  | { type: 'reveal'; itemId: string }
  | { type: 'item'; itemId: string; reveal: boolean; focus: boolean }
  | { type: 'move'; itemId: string; by: number }
  | { type: 'remove'; itemId: string }
  | { type: 'add' | 'start' | 'end' };

/** The cue said over the live picture: the slide ↵ shows, or that the number typed has none. */
export interface PageCue {
  text: 'live.cued' | 'live.noSuchSlide';
  n: number;
  itemId: string;
}

/** Where the page is: which presentation, whether it is a template or presented, and the live pointer. */
export interface PageContext {
  presentationId: string;
  isTemplate: boolean;
  presenting: boolean;
  live: LivePointer;
}

/** The page's state as its context leaves it, whether ▶ may start, and the cue. */
export const pageModel = (state: PageState, context: PageContext, order: SlideOrder) =>
  view<{ state: PageState; canStart: boolean; cue: PageCue | null }>('pageModelView', { state, context, order });

/** The page's answer to `event`: its new state, a change to the live pointer, a command, and whether it was the page's. */
export const pageEvent = (state: PageState, context: PageContext, order: SlideOrder, event: PageEvent) =>
  view<{ state: PageState; live: LivePointerChange | null; command: PageCommand | null; handled: boolean }>('pageEventView', { state, context, order, event });

// ------------------------------------------------------------------ Bibles

/** A verse as a passage is made of it. */
type PassageVerse = { b: string; c: number; v: number; t: string };

/** The slides, title and add button's label an item of these verses has, split and titled as `addBibleToPresentation` freezes them. */
export const bibleSlides = (translation: string, verses: readonly PassageVerse[]) => view<{ title: string; label: string; slides: Slide[] }>('bibleSlidesView', { translation, verses });

/** What a reference selects among the books `available` (BIBLE-R11), or null. */
export const verseSearchPlan = (query: string, available: readonly string[]) =>
  view<{ codes: string[]; from: [number, number]; to: [number, number] } | null>('verseSearchPlanView', { query, available });

/** A translation read from a zip (BIBLE-R3–R6). */
export interface ImportedBible {
  name: string;
  abbreviation: string;
  language: string | null;
  books: BibleBookText[];
}

/** A translation's zip read; refused with its reason as the code (not-zip, compression, too-large, no-files, no-verses). */
export const importBibleZip = (data: Uint8Array) => importZip(data) as ImportedBible;

// ------------------------------------------------------------------ the song import and search

/** The places in `library` of the names one of `names` has (case and composition aside). */
export const songNamesakes = (names: readonly string[], library: readonly string[]) => view<number[]>('songNamesakesView', { names, library });

/** Skip the file's song, replace the library's with it, or add it beside the other. */
export type DuplicateChoice = 'skip' | 'replace' | 'keep';

/**
 * Each song of an import that shares a name, in file order: its index, the song it is compared with (the library's
 * with the same text, else the first; or one earlier in the import, with no id), whether their text is the same, the
 * choices it offers (replacing only a library song) and the one it starts with (a same text skipped, another kept).
 */
export const songImportDuplicates = (songs: readonly { name: string; text: string }[], library: readonly { id: string; name: string; text: string }[]) =>
  view<{ index: number; other: { id: string | null; text: string }; same: boolean; choices: DuplicateChoice[]; choice: DuplicateChoice }[]>('songImportDuplicatesView', { songs, library });

/** `text` cut into pieces with the word prefixes matching `query` marked (SONG-A20), as the song search reads them. */
export const searchMarks = (text: string, query: string) => view<{ text: string; hit: boolean }[]>('highlightView', { text, query });

// ------------------------------------------------------------------ the sync

/** How the sync stands, in words, and whether it is a problem; `waitedLong` once `waiting` has held for the grace. */
export const syncStatus = (s: { pending: number; stopped: string | null; connected: boolean; unreachable: boolean; busy: boolean; waitedLong: boolean }) => view<SyncStatus>('syncStatusView', s);
