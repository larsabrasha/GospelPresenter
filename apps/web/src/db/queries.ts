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
// pages use them, ordered by name in the page's language by the core too (`locale`, crates/gp-core/src/collation.rs,
// since 2026-11-18). A Bible's text is read a book or a chapter at a time through the core's bibleView (BibleTab.tsx).

/** The library, by name in the page's language, without the trash (spec 02: culture-aware, case-insensitive; songsView). */
export const listSongs = (db: ReadDb): Promise<Song[]> => db.view<Song[]>('songsView', { locale: locale() });

export const songPartsOf = (db: ReadDb, songIds: string[]): Promise<SongPart[]> => db.view<SongPart[]>('songPartsView', { songIds });

export async function listLabels(db: ReadDb): Promise<Map<string, Label>> {
  return new Map((await db.view<Label[]>('labelsView', {})).map((l) => [l.id, l]));
}

/** Presentations, newest event first; those without a date last (milestone 1 has no "last changed"). */
export const listPresentations = (db: ReadDb): Promise<Presentation[]> => db.view<Presentation[]>('presentationListView', {});

/**
 * The templates, last changed first, one never stamped (made before schema 12) after those that were, then by name in
 * the page's language (PresentationService.GetAllTemplateSummariesAsync; templatesView).
 */
export const listTemplates = (db: ReadDb): Promise<Presentation[]> => db.view<Presentation[]>('templatesView', { locale: locale() });

/** The templates the "Skapa presentation" picker offers (PRES-R32): the 10 last used, never-used ones last (03 Q7), then last changed. */
export const recentTemplates = (db: ReadDb): Promise<Presentation[]> => db.view<Presentation[]>('templatesView', { locale: locale(), recent: true });

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

/** The organisation's translations, by name in the page's language (BIBLE-R8; biblesView). */
export async function listBibles(db: ReadDb): Promise<InstalledBible[]> {
  return db.view<InstalledBible[]>('biblesView', { locale: locale() });
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
export const ccliReport = (db: ReadDb): Promise<{ entries: CcliEntry[]; on: boolean }> => db.view('ccliReportView', { locale: locale() });

/** The organisation's own themes (docs/themes.md), in the order they were made (ownThemesView). */
export const ownThemes = (db: ReadDb): Promise<Theme[]> => db.view<Theme[]>('ownThemesView', {});

/** An own theme to edit, with when it was last saved; null where there is none (ownThemeView). */
export const getOwnTheme = (db: ReadDb, id: string): Promise<{ theme: Theme; updatedAt: number } | null> => db.view('ownThemeView', { id });

/** The organisation's default theme, as a page outside a presentation draws in (THEME-R2). */
export const defaultTheme = (db: ReadDb): Promise<Theme> => db.view<Theme>('themeView', { id: null });

// ------------------------------------------------------------------ outputs

/**
 * The outputs in the order they were made, as Skärmar lists them (spec 04 §7, RemoteDisplayService.cs); those from
 * before schema 12 first, by name in the page's language (displaysView).
 */
export const listDisplays = (db: ReadDb): Promise<Display[]> => db.view<Display[]>('displaysView', { locale: locale() });

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

