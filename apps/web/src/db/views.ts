// The pages' data as the Rust core's views give it (docs/rust-core.md, 2.5 step 3): finished JSON from the database's
// worker instead of SQL here. Each view names the tables it reads, so its page reads it again when one changes.
import type { CustomPage, ItemSlides, LibraryAudio, LibraryVideo, Overlay, Presentation, PresentationItem, Slide, Song, SongArrangement, Theme } from '@gp/core';
import type { ReadDb } from './share.ts';

/** What a running order's slides read (itemSlidesView): the library the items show. */
const SLIDE_READS = ['songs', 'song_parts', 'song_arrangements', 'labels', 'audios', 'videos', 'custom_slides', 'images'];

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
