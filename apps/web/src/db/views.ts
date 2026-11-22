// The pages' data as the Rust core's views give it (docs/rust-core.md, 2.5 step 3): finished JSON from the database's
// worker instead of SQL here. Each view names the tables it reads, so its page reads it again when one changes.
import type {
  CustomPage,
  ItemSlides,
  Label,
  LibraryAudio,
  LibraryVideo,
  Overlay,
  Presentation,
  PresentationItem,
  Slide,
  Song,
  SongArrangement,
  SongMaterial,
  SongPart,
  SongVersion,
  Theme,
} from '@gp/core';
import type { ReadDb } from './share.ts';

/** What a running order's slides read (itemSlidesView): the library the items show. */
const SLIDE_READS = ['songs', 'song_parts', 'song_arrangements', 'labels', 'audios', 'videos', 'custom_slides', 'images'];

/**
 * The slides a song would show as an item of `arrangementId` (`itemSlidesView` of an item not saved): the song tab's
 * preview, worked out as the outputs work out an item's.
 */
export async function songPreviewSlides(db: ReadDb, songId: string, arrangementId: string | null): Promise<Slide[]> {
  const item = { id: 'preview', type: 'song', title: '', sourceId: songId, arrangementId, content: null };
  return (await db.view<Record<string, ItemSlides>>('itemSlidesView', { items: [item] })).preview?.slides ?? [];
}

/**
 * One of the start page's lists (`startPageView`, docs/view-models.md): Idag, Kommande or Senast ändrade, in their
 * order, each row with its number of items, and whether the rows show their date and its year.
 */
export interface StartList {
  id: 'today' | 'upcoming' | 'recent';
  showDate: boolean;
  withYear: boolean;
  rows: (Presentation & { itemCount: number })[];
}

/** The start page's lists on `today` (the device's date, `YYYY-MM-DD`), as the core groups them for every shell. */
export const startPage = (db: ReadDb, today: string) => db.view<StartList[]>('startPageView', { today });

/** The tables presentationPageView reads. */
export const PRESENTATION_PAGE_READS = [...SLIDE_READS, 'presentations', 'presentation_items', 'themes', 'org_settings', 'overlays'];

/** The presentation page's data (presentationPageView): the songs and slides by id, as the page looks them up. */
export async function presentationPage(db: ReadDb, id: string) {
  const v = await db.view<{
    presentation: Presentation | null;
    theme: Theme;
    items: PresentationItem[];
    slides: Record<string, ItemSlides>;
    songs: Song[];
    arrangements: SongArrangement[];
    overlays: Overlay[];
  }>('presentationPageView', { id });
  return { ...v, slides: new Map(Object.entries(v.slides)), songs: new Map(v.songs.map((s) => [s.id, s])) };
}

// ------------------------------------------------------------------ presenting

/** The tables liveSlideView reads: what a slide shown is drawn from, its theme and its overlay. */
export const LIVE_SLIDE_READS = [...SLIDE_READS, 'presentations', 'presentation_items', 'themes', 'org_settings', 'overlays'];

/**
 * What the outputs show for a pointer (liveSlideView): the presentation's name (null when it is gone), the slide
 * (null when there is none), the presentation's theme and the overlay shown (null for none).
 */
export function liveSlide(db: ReadDb, p: { presentationId: string; itemId: string | null; partIndex: number; overlayId: string | null }) {
  return db.view<{ name: string | null; slide: Slide | null; theme: Theme; overlay: CustomPage | null }>('liveSlideView', p);
}

/** What the overlay `id` shows (overlayView), null for none or one deleted meanwhile. */
export const shownOverlay = (db: ReadDb, id: string | null) => db.view<CustomPage | null>('overlayView', { id });

/** Each item's overlay in the running order (itemOverlaysView). */
export async function itemOverlays(db: ReadDb, presentationId: string): Promise<Map<string, string | null>> {
  return new Map(await db.view<[string, string | null][]>('itemOverlaysView', { presentationId }));
}

/** Whether a controller's command still points at what is there (liveTargetsView, LIVE-R49). */
export const liveTargets = (db: ReadDb, t: { presentationId: string; itemId?: string | null; overlayId?: string | null }) =>
  db.view<{ item: boolean; overlay: boolean }>('liveTargetsView', t);

/** The item shown, its video and the next item's, which buffers (livePlaybackView). */
export const livePlayback = (db: ReadDb, presentationId: string, itemId: string | null) =>
  db.view<{ item: { id: string; type: PresentationItem['type'] } | null; video: LibraryVideo | null; nextVideo: LibraryVideo | null }>('livePlaybackView', {
    presentationId,
    itemId,
  });

/** An audio item's file (itemAudioView), null for another kind of item or a file gone. */
export const itemAudio = (db: ReadDb, itemId: string) => db.view<LibraryAudio | null>('itemAudioView', { itemId });

/** What CCLI records for a slide shown long enough (ccliUseView, SONG-R48–R53), or null when nothing is to be. */
export const ccliUse = (db: ReadDb, presentationId: string, itemId: string | null) =>
  db.view<{ songId: string; songName: string; ccli: string; presentationId: string; presentationName: string } | null>('ccliUseView', { presentationId, itemId });

// ------------------------------------------------------------------ a song's pages

/** The tables songPageView reads. */
export const SONG_PAGE_READS = ['songs', 'song_parts', 'song_arrangements', 'labels'];

/** A song's page and the pages pushed in from it (songPageView): the song (null when gone), parts, arrangements, labels by id. */
export async function songPage(db: ReadDb, id: string) {
  const v = await db.view<{ song: Song | null; parts: SongPart[]; arrangements: SongArrangement[]; labels: Label[] }>('songPageView', { id });
  return { ...v, labels: new Map(v.labels.map((l) => [l.id, l])) };
}

/** A song by id, trashed or not (songView); null when there is none. */
export const getSong = (db: ReadDb, id: string) => db.view<Song | null>('songView', { id });

/** The presentations and templates, not in the trash, that show the song (songPresentationsView, D17). */
export const presentationsUsing = (db: ReadDb, songId: string) => db.view<Presentation[]>('songPresentationsView', { songId });

/** The tables songHistoryView reads. */
export const SONG_HISTORY_READS = ['songs', 'song_versions', 'themes', 'org_settings'];

/** A song's history (songHistoryView): the song, its versions newest first (SONG-R23), the default theme to show them in. */
export const songHistory = (db: ReadDb, id: string) => db.view<{ song: Song | null; versions: SongVersion[]; theme: Theme }>('songHistoryView', { id });

/** The sheet music, recordings and links of songs, each song's in its order (songMaterialsView). */
export const songMaterialsOf = (db: ReadDb, songIds: string[]) => db.view<SongMaterial[]>('songMaterialsView', { songIds });

/** A presentation's Noter och länkar (presentationMaterialsView): its songs with materials, in the running order, each
 * once; `empty` the text's key when there are none. */
export const presentationMaterials = (db: ReadDb, presentationId: string) =>
  db.view<{ songs: { songId: string; title: string; materials: SongMaterial[] }[]; empty: 'material.presentationEmpty' | null }>('presentationMaterialsView', { presentationId });

/** The core the database's worker runs (coreInfoView): its crate's name and version, for Om Gospel Presenter. */
export const coreInfo = (db: ReadDb) => db.view<{ name: string; version: string }>('coreInfoView', {});
