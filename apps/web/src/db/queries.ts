import {
  type Bible,
  type CcliEntry,
  type Display,
  type LibraryAudio,
  type LibraryVideo,
  type Label,
  type Overlay,
  type Presentation,
  type PresentationItem,
  type RemoteControlPolicy,
  type Song,
  type SongPart,
  type Theme,
} from '@gp/core';
import { locale } from '../i18n.ts';
import type { ReadDb } from './share.ts';

// The pages' reads: the Rust core's views (docs/rust-core.md, 2.5 step 3), which give the core's row types as the
// pages use them, and the orders by name in the page's language, which are the shell's (Intl.Collator). A Bible's text
// is read a book or a chapter at a time through the core's bibleView (BibleTab.tsx).

/** `localeCompare(…, locale, { sensitivity: 'base' })` in the page's language, made once: making it per call cost 86 ms to sort 3 000 songs. */
const byLocale = new Intl.Collator(locale(), { sensitivity: 'base' }).compare;

const byName = (a: Song, b: Song) => byLocale(a.name, b.name);

/**
 * The library, by name, without the trash (spec 02: culture-aware, case-insensitive): the core's rows (songsView), in
 * the table's order, sorted by name in the page's language, as the shell's to choose.
 */
export async function listSongs(db: ReadDb): Promise<Song[]> {
  return (await db.view<Song[]>('songsView', {})).toSorted(byName);
}

export const songPartsOf = (db: ReadDb, songIds: string[]): Promise<SongPart[]> => db.view<SongPart[]>('songPartsView', { songIds });

export async function listLabels(db: ReadDb): Promise<Map<string, Label>> {
  return new Map((await db.view<Label[]>('labelsView', {})).map((l) => [l.id, l]));
}

/** Presentations, newest event first; those without a date last (milestone 1 has no "last changed"). */
export const listPresentations = (db: ReadDb): Promise<Presentation[]> => db.view<Presentation[]>('presentationListView', {});

/** How many items each presentation has, for the start page's rows (docs/layout-2-0.md); one with none is missing. */
export async function itemCounts(db: ReadDb): Promise<Map<string, number>> {
  return new Map((await db.view<[string, number][]>('itemCountsView', {})).map(([id, n]) => [id, Number(n)]));
}

/** The templates page's list (spec 03 screen 3), by name: a template has no "last changed" here. */
/** The templates, last changed first (PresentationService.GetAllTemplateSummariesAsync). */
export async function listTemplates(db: ReadDb): Promise<Presentation[]> {
  return (await db.view<Presentation[]>('templatesView', {})).toSorted((a, b) => byLastChanged(a, b) || byPresentationName(a, b));
}

/** The templates the "Skapa presentation" picker offers (PRES-R32): the 10 last used, never-used ones last (03 Q7), then last changed. */
export async function recentTemplates(db: ReadDb): Promise<Presentation[]> {
  return (await listTemplates(db)).toSorted((a, b) => (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1)).slice(0, 10);
}

/** Latest change first; one never stamped (made before schema 12) after those that were. */
export function byLastChanged(a: Pick<Presentation, 'updatedAt'>, b: Pick<Presentation, 'updatedAt'>): number {
  return (b.updatedAt ?? -1) - (a.updatedAt ?? -1);
}

const byPresentationName = (a: Presentation, b: Presentation) => byLocale(a.name, b.name) || a.id.localeCompare(b.id);

export interface TrashEntry {
  kind: 'Presentation' | 'Template' | 'Song' | 'Image' | 'Audio' | 'Video' | 'Slide';
  id: string;
  name: string;
  /** The event date of a presentation, the author of a song. */
  detail: string | null;
  /** A template's, for its weekday, time and place. */
  template?: Presentation;
  deletedAt: number;
}

/** What is in the trash, newest deletion first (spec 03 section 5): the core's entries (trashEntriesView), in the page's order. */
export async function listTrash(db: ReadDb): Promise<TrashEntry[]> {
  return (await db.view<TrashEntry[]>('trashEntriesView', {})).toSorted((a, b) => b.deletedAt - a.deletedAt || a.id.localeCompare(b.id));
}

export const itemsOf = (db: ReadDb, presentationId: string): Promise<PresentationItem[]> => db.view<PresentationItem[]>('itemsView', { presentationId });

// ------------------------------------------------------------------ Bibles and themes

export interface InstalledBible extends Bible {
  /** Its text is on this device, so it can be searched offline. */
  stored: boolean;
  /** This device has chosen to keep its text ("Tillgänglig offline"). A desktop host keeps every text regardless. */
  kept: boolean;
}

/** The organisation's translations, by name (BIBLE-R8): the core's rows (biblesView), in the page's order. */
export async function listBibles(db: ReadDb): Promise<InstalledBible[]> {
  return (await db.view<InstalledBible[]>('biblesView', {})).toSorted((a, b) => byLocale(a.name, b.name) || a.id.localeCompare(b.id));
}

export const orgDefaultThemeId = (db: ReadDb): Promise<string | null> => db.view<string | null>('defaultThemeIdView', {});

/** The organisation's remote control policy; no row is the presenter's choice. */
export function orgRemoteControl(db: ReadDb): Promise<RemoteControlPolicy> {
  return db.view<RemoteControlPolicy>('remoteControlView', {});
}

/**
 * The CCLI report (ccliReportView): the entries by date, newest first, then presentation and song name in the page's
 * language (SONG-R52), and whether collection is on (SONG-R49).
 */
export async function ccliReport(db: ReadDb): Promise<{ entries: CcliEntry[]; on: boolean }> {
  const { entries, on } = await db.view<{ entries: CcliEntry[]; on: boolean }>('ccliReportView', {});
  const ordered = entries.toSorted(
    (a, b) => b.date.localeCompare(a.date) || byLocale(a.presentationName, b.presentationName) || a.presentationId.localeCompare(b.presentationId) || byLocale(a.songName, b.songName),
  );
  return { entries: ordered, on };
}

/** The organisation's own themes (docs/themes.md), in the order they were made (ownThemesView). */
export const ownThemes = (db: ReadDb): Promise<Theme[]> => db.view<Theme[]>('ownThemesView', {});

/** An own theme to edit, with when it was last saved; null where there is none (ownThemeView). */
export const getOwnTheme = (db: ReadDb, id: string): Promise<{ theme: Theme; updatedAt: number } | null> => db.view('ownThemeView', { id });

/** The organisation's default theme, as a page outside a presentation draws in (THEME-R2). */
export const defaultTheme = (db: ReadDb): Promise<Theme> => db.view<Theme>('themeView', { id: null });

// ------------------------------------------------------------------ outputs

/** The organisation's outputs, by name (spec 04 §7). */
/** The outputs in the order they were made, as Skärmar lists them (RemoteDisplayService.cs); those from before schema 12 first, by name. */
/** The rows are the core's (displaysView); the order is this page's language's, as the shell's to choose. */
export async function listDisplays(db: ReadDb): Promise<Display[]> {
  const rows = await db.view<Display[]>('displaysView', {});
  return rows.toSorted((a, b) => (a.createdAt ?? -1) - (b.createdAt ?? -1) || byLocale(a.name, b.name) || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ audio

/** The audio files, newest first, without the trash (MEDIA-R7), from the core (audiosView). */
export const listAudios = (db: ReadDb): Promise<LibraryAudio[]> => db.view<LibraryAudio[]>('audiosView', {});

// ------------------------------------------------------------------ video

/** The videos, newest first, without the trash (MEDIA-R7), from the core (videosView). */
export const listVideos = (db: ReadDb): Promise<LibraryVideo[]> => db.view<LibraryVideo[]>('videosView', {});

/** Whether this device keeps the presentation's files whatever its date ("Tillgänglig offline"). */
export async function isPinned(db: ReadDb, presentationId: string): Promise<boolean> {
  return (await pinnedIds(db)).has(presentationId);
}

/** The presentations kept offline on this device. */
export async function pinnedIds(db: ReadDb): Promise<Set<string>> {
  return new Set(await db.view<string[]>('pinnedView', {}));
}

// ------------------------------------------------------------------ overlays

/** The organisation's overlays, in the order they were made (PRES-R18), from the core (overlaysView). */
export const listOverlays = (db: ReadDb): Promise<Overlay[]> => db.view<Overlay[]>('overlaysView', {});

/** An overlay's row, null when there is none (overlayRowView). */
export const getOverlay = (db: ReadDb, id: string): Promise<Overlay | null> => db.view<Overlay | null>('overlayRowView', { id });

