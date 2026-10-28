import { z } from 'zod';
import { bibleCredits, bibleSlideText, type BibleItemContent, type BibleSlide } from './bible.ts';
import { MEDIA_HASH } from './media.ts';
import type { Label, Song, SongArrangement, SongPart } from './schema.ts';

/** What an output renders for one slide (spec 04 `LiveSlide`): a song part, a piece of a Bible passage or a picture. */
export interface Slide {
  /** The part id, plus the occurrence when an arrangement repeats the part: stable while the song is edited. */
  key: string;
  /** Which of the theme's styles it takes. A `media` slide has no text: its picture fills the stage. */
  kind: 'song' | 'bible' | 'media';
  /** A media slide's picture: the hash of its `full` blob. */
  image: string | null;
  /** The text as plain text: a song part as written; a Bible slide with its verse numbers. */
  text: string;
  /** A Bible slide's runs of words, each starting with its verse number if it starts a verse. */
  verses: BibleSlide | null;
  label: { text: string; color: string } | null;
  credits: string | null;
}

/** "Author · © Publisher · Year", dropping missing pieces; null if there are none (spec 04). */
export function songCredits(song: Pick<Song, 'author' | 'publisher' | 'year'>): string | null {
  const pieces = [song.author, song.publisher ? `© ${song.publisher}` : null, song.year ? String(song.year) : null];
  const kept = pieces.filter((p): p is string => !!p?.trim());
  return kept.length ? kept.join(' · ') : null;
}

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

/**
 * The parts in the order they are shown (SONG-R18, R19): the item's
 * arrangement, else the song's first arrangement, else all parts in part
 * order. An arrangement id that is not one of the song's shows all parts; ids
 * of deleted parts are skipped; repeats are kept.
 */
export function arrangedParts(song: Song, parts: SongPart[], arrangements: SongArrangement[], itemArrangementId: string | null = null): SongPart[] {
  const own = parts.filter((p) => p.songId === song.id).toSorted((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const arrangementId = itemArrangementId ?? sortedArrangements(arrangements, song.id)[0]?.id ?? null;
  const arrangement = arrangementId ? arrangements.find((a) => a.id === arrangementId && a.songId === song.id) : undefined;
  if (!arrangement) return own;
  const byId = new Map(own.map((p) => [p.id, p]));
  return parsePartIds(arrangement.partIds).flatMap((id) => byId.get(id) ?? []);
}

/** One slide per arranged part (spec 02: one part is one slide). */
export function songSlides(
  song: Song,
  parts: SongPart[],
  labels: Map<string, Label>,
  arrangements: SongArrangement[] = [],
  itemArrangementId: string | null = null,
): Slide[] {
  const credits = songCredits(song);
  const seen = new Map<string, number>();
  return arrangedParts(song, parts, arrangements, itemArrangementId).map((p) => {
    const n = seen.get(p.id) ?? 0;
    seen.set(p.id, n + 1);
    const l = p.labelId ? labels.get(p.labelId) : undefined;
    return { key: n ? `${p.id}#${n}` : p.id, kind: 'song', text: p.content, verses: null, image: null, label: l ? { text: l.text, color: l.color } : null, credits };
  });
}

/** A Bible item's slides, as frozen when it was added; the credits name the passage and its translation (D12). */
export function bibleItemSlides(title: string, content: BibleItemContent): Slide[] {
  const credits = bibleCredits(title, content.translation);
  return content.slides.map((verses, i) => ({ key: `b${i}`, kind: 'bible', text: bibleSlideText(verses), verses, image: null, label: null, credits }));
}

/** The one slide of an image item: the picture, over the theme's media background (spec 05). */
export function imageSlide(fullHash: string): Slide {
  return { key: 'image', kind: 'media', text: '', verses: null, image: fullHash, label: null, credits: null };
}

// ------------------------------------------------------------------ slide decks (PRES-R11, D29)

/** At most this many pages in one slide deck (PRES-R11). */
export const MAX_SLIDE_PAGES = 100;

/** One page of a slide deck: the hashes of its two pictures, as a library picture has (MEDIA-R4). */
export interface SlidePage {
  full: string;
  thumb: string;
}

/**
 * What a slide deck item keeps: the file it came from and its pages, rendered
 * once at import. A snapshot like a Bible item: no deck table, and the
 * pictures are media blobs named by their hashes.
 */
export interface SlidesItemContent {
  fileName: string;
  pages: SlidePage[];
}

const slidePageSchema = z.object({ full: z.string().regex(MEDIA_HASH), thumb: z.string().regex(MEDIA_HASH) });
export const slidesItemContentSchema = z.object({
  fileName: z.string().max(200),
  pages: z.array(slidePageSchema).max(MAX_SLIDE_PAGES),
});

/** The content of a slide deck item, or null if it is not one we can read. */
export function parseSlidesContent(json: string | null): SlidesItemContent | null {
  if (!json) return null;
  try {
    const parsed = slidesItemContentSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A slide deck's slides: each page a picture filling the stage, like an image item. */
export function slideDeckSlides(content: SlidesItemContent): Slide[] {
  return content.pages.map((page, i) => ({ key: `s${i}`, kind: 'media', text: '', verses: null, image: page.full, label: null, credits: null }));
}
