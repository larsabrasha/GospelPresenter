import type { CustomPage } from './custom-slides.ts';
import { z } from 'zod';
import type { BibleSlide } from './bible.ts';
import { MEDIA_HASH } from './media.ts';
import type { VideoCodec, VideoType } from './video.ts';
import type { SongArrangement } from './schema.ts';

/** A video slide's video: what a device needs to stream it and to know whether it can play it. */
export interface SlideVideo {
  hash: string;
  type: VideoType;
  codec: VideoCodec;
}

/** What an output renders for one slide (spec 04 `LiveSlide`): a song part, a piece of a Bible passage, a picture or a video. */
export interface Slide {
  /** The part id, plus the occurrence when an arrangement repeats the part: stable while the song is edited. */
  key: string;
  /** Which of the theme's styles it takes. A `media` slide has no text: its picture fills the stage. */
  kind: 'song' | 'bible' | 'media';
  /** A media slide's picture: the hash of its `full` blob. */
  image: string | null;
  /** Its `thumb` blob, which every device keeps: drawn where the full picture is not on the device. */
  thumb?: string | null;
  /** The text as plain text: a song part as written; a Bible slide with its verse numbers. */
  text: string;
  /** A Bible slide's runs of words, each starting with its verse number if it starts a verse. */
  verses: BibleSlide | null;
  label: { text: string; color: string } | null;
  credits: string | null;
  /** A video slide's video, which the outputs play; its `image` is the still, drawn where it does not play. */
  video?: SlideVideo;
  /**
   * An audio item's one slide (Lars, 2026-11-06: audio is shown and played alone, as a video): the outputs show the
   * theme's background and nothing on it while the presenting computer plays the file; its name is for the operator.
   */
  audio?: { name: string };
  /**
   * A custom slide's page (docs/custom-slides.md), drawn instead of the text; `kind` is `song`, whose theme style it
   * follows, and `text` its texts, for a public output.
   */
  custom?: CustomPage;
}

// A song's and a Bible passage's slides are the Rust core's (crates/gp-core/src/slides.rs, itemSlidesView and
// bibleSlidesView): what an output shows is worked out in one place for every app.

/** An arrangement's part ids. A value that is not a list of strings reads as empty. */
export function parsePartIds(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** A song's arrangements in their order; the first is the default (SONG-R19). */
export function sortedArrangements(arrangements: SongArrangement[], songId: string): SongArrangement[] {
  return arrangements.filter((a) => a.songId === songId).toSorted((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

/** A slide of an image item: one picture, over the theme's media background (spec 05). */
export function imageSlide(fullHash: string, key = 'image', thumbHash: string | null = null): Slide {
  return { key, kind: 'media', text: '', verses: null, image: fullHash, thumb: thumbHash, label: null, credits: null };
}

/** A video item's one slide: the still as its picture, the video for the outputs that play it. */
export function videoSlide(video: { hash: string; contentType: VideoType; codec: VideoCodec; stillHash: string; thumbHash?: string }): Slide {
  return {
    key: 'video',
    kind: 'media',
    text: '',
    verses: null,
    image: video.stillHash,
    thumb: video.thumbHash ?? null,
    label: null,
    credits: null,
    video: { hash: video.hash, type: video.contentType, codec: video.codec },
  };
}

/** An audio item's one slide: nothing on the outputs but the theme's background, while the sound plays. */
export function audioSlide(name: string): Slide {
  return { key: 'audio', kind: 'media', text: '', verses: null, image: null, label: null, credits: null, audio: { name } };
}

/** At most this many pictures in one image item. */
export const MAX_ITEM_IMAGES = 50;

/**
 * What an image item keeps: its pictures in order, library ids (Presentation.razor's image parts).
 * An item made before there could be several has no content and shows its `sourceId` alone.
 */
export const imageItemContentSchema = z.object({ images: z.array(z.string().min(1).max(64)).min(1).max(MAX_ITEM_IMAGES) });

/** An image item's pictures, by library id, in order. */
export function imageItemIds(item: { sourceId: string; content: string | null }): string[] {
  if (!item.content) return [item.sourceId];
  try {
    const parsed = imageItemContentSchema.safeParse(JSON.parse(item.content));
    return parsed.success ? parsed.data.images : [item.sourceId];
  } catch {
    return [item.sourceId];
  }
}

// ------------------------------------------------------------------ PDFs (PRES-R11, D29): a slideshow's pages

/** At most this many pages in a PDF the import takes (PRES-R11). */
export const MAX_SLIDE_PAGES = 100;

/** The largest PDF the import takes (PRES-R11): 50 MB. */
export const MAX_SLIDES_SOURCE_BYTES = 50 * 1024 * 1024;

/** One page of a PDF, rendered at import: the hashes of its two pictures, as a library picture has (MEDIA-R4). */
export interface SlidePage {
  full: string;
  thumb: string;
}

const slidePageSchema = z.object({ full: z.string().regex(MEDIA_HASH), thumb: z.string().regex(MEDIA_HASH) });
/** A PDF's pages, rendered at import: what `addSlides` takes, and a deck of before (schema 20, a zip of format 3). */
export const slideDeckPagesSchema = z.array(slidePageSchema).min(1).max(MAX_SLIDE_PAGES);

/** A deck's pages, or none where they do not read. */
export function parseSlideDeckPages(json: string | null): SlidePage[] {
  try {
    const parsed = slideDeckPagesSchema.safeParse(JSON.parse(json ?? ''));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
