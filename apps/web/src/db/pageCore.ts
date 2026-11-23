// This page's own core, beside the database worker's: for the views that read no database, worked out on the page's
// thread, synchronously (`Core.pure`). Presenting's keys and marks (live/presenting.ts), so a key reaches the outputs
// without a round trip to the worker; and the Bible tab's preview, the output's own slides.
import type { Role, Slide } from '@gp/core';
import { base64, Core } from '@gp/core/core';

let core: Core | undefined;

/** The page's core, made at its first call. */
export function pageCore(): Core {
  core ??= new Core();
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

/** An action of a list, the core's: its id, its text's key, whether it removes, the row's field it needs. */
interface LibraryAction {
  id: string;
  text: string;
  destructive: boolean;
  when: string | null;
}

/** What one of Inställningar's lists can do (`libraryPageView`, docs/view-models.md), the same in every shell. */
export interface LibraryPage {
  list: 'collection' | 'pages';
  opens: 'page' | 'preview' | 'sheet' | 'none';
  add: { id: 'new' | 'import'; text: string } | null;
  extra: { id: 'import'; text: string; title: string } | null;
  pick: boolean;
  pickOnly: 'own' | null;
  picked: LibraryAction[];
  row: LibraryAction[];
}

export function libraryPage(kind: string, role: Role, host = false): LibraryPage {
  return pageCore().pure<LibraryPage>('libraryPageView', { kind, role, host });
}


/** `text` cut into pieces with the word prefixes matching `query` marked (`highlightView`, SONG-A20), as the core's search reads them. */
export const highlight = (text: string, query: string) => pageCore().pure<{ text: string; hit: boolean }[]>('highlightView', { text, query });

/** A song read from a ProPresenter file, before it has ids: arrangements name parts by their index. */
export interface ImportedSong {
  name: string;
  author: string | null;
  publisher: string | null;
  ccli: string | null;
  parts: { labelText: string | null; content: string }[];
  arrangements: { name: string | null; partIndexes: number[] }[];
}

/** A `.pro` file as a song, or null when it has no slide text or cannot be read (`proPresenterSongView`, SONG-R35–R43). */
export const proPresenterSong = (data: Uint8Array, fileName: string | null) =>
  pageCore().pure<ImportedSong | null>('proPresenterSongView', { data: base64(data), fileName });

interface BookNames { sv: string; en: string; oldTestament: boolean }
const books = new Map<string, BookNames>();

/** A book's Swedish and English names and its testament (`bibleBookNamesView`, BIBLE-R10), asked once a code. */
export function bookInfo(code: string): BookNames {
  let b = books.get(code);
  if (!b) books.set(code, (b = pageCore().pure<BookNames[]>('bibleBookNamesView', { codes: [code] })[0]!));
  return b;
}
