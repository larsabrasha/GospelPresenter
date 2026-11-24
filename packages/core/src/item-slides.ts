// A running order's slides, item by item, as the shells show them; the core works them out and says why an item has
// none (`itemSlidesView`, crates/gp-core/src/slides.rs).
import type { LibraryVideo } from './schema.ts';
import type { Slide } from './slides.ts';

export interface ItemSlides {
  slides: Slide[];
  /** Why the item has no slides, if it has none. */
  problem: 'song-missing' | 'song-trashed' | 'no-parts' | 'image-missing' | 'audio-missing' | 'video-missing' | 'custom-missing' | null;
  /** An audio item's file: its one slide, shown, plays it on the presenting computer (Lars, 2026-11-06). */
  audio?: { hash: string; fileName: string };
  /** A video item's video: its one slide plays it on the outputs, its sound on the presenting computer. */
  video?: LibraryVideo;
}
