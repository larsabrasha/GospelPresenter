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
}
let rules: Rules | undefined;
const theRules = () => (rules ??= pageCore().pure<Rules>('rulesView', {}));

/** Whether `role` may do `permission` (`can`), as the core's mutators decide it: a button the core would refuse is not shown. */
export function can(role: Role, permission: Permission): boolean {
  return theRules().permissions[role]?.includes(permission) ?? false;
}

/** The limits of the organisation's data, the core's: a field's length, a button hidden at the limit. */
export const limits = () => theRules().limits;

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
