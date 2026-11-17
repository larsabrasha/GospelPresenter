// The pages' data as the Rust core's views give it (docs/rust-core.md, 2.5 step 3): finished JSON from the database's
// worker instead of SQL here. Each view names the tables it reads, so its page reads it again when one changes.
import type { ItemSlides, Overlay, Presentation, PresentationItem, Song, SongArrangement, Theme } from '@gp/core';
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
