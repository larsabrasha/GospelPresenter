// A running order's slides, item by item: the view every shell shows and presents from. The core decides what each
// item shows and why one shows nothing; the shell reads the library for it (`SlideSources`), as it keeps it.
import { parseBibleContent } from './bible.ts';
import { customPageText, type CustomPage } from './custom-slides.ts';
import type { Label, LibraryAudio, LibraryImage, LibraryVideo, PresentationItem, Song, SongArrangement, SongPart } from './schema.ts';
import { audioSlide, bibleItemSlides, imageItemIds, imageSlide, songSlides, videoSlide, type Slide } from './slides.ts';

export interface ItemSlides {
  slides: Slide[];
  /** Why the item has no slides, if it has none. */
  problem: 'song-missing' | 'song-trashed' | 'no-parts' | 'image-missing' | 'audio-missing' | 'video-missing' | 'custom-missing' | null;
  /** An audio item's file: its one slide, shown, plays it on the presenting computer (Lars, 2026-11-06). */
  audio?: { hash: string; fileName: string };
  /** A video item's video: its one slide plays it on the outputs, its sound on the presenting computer. */
  video?: LibraryVideo;
}

/** What song items read, for every song of a running order at once. */
export interface SongData {
  songs: Map<string, Song>;
  parts: SongPart[];
  labels: Map<string, Label>;
  arrangements: SongArrangement[];
}

/** The library as the slides read it, from where the shell keeps it; null for what is not there. */
export interface SlideSources {
  /** The songs of these ids, their parts, arrangements and the labels, read together. */
  songData(songIds: string[]): Promise<SongData>;
  audio(id: string): Promise<LibraryAudio | null>;
  video(id: string): Promise<LibraryVideo | null>;
  customSlide(id: string): Promise<{ pages: CustomPage[] } | null>;
  image(id: string): Promise<LibraryImage | null>;
}

/**
 * The slides of every item of a running order, by item id. A song item is a reference: its slides come from the
 * current song in the item's arrangement (spec 03). A Bible item carries its own slides, frozen when it was added
 * (BIBLE-R12); a slideshow item names a slideshow of the library, a PDF's pages too (D29). The songs are read
 * together, once rather than four queries an item: a running order of 30 songs waited on 120 answers in turn.
 */
export async function readItemSlides(sources: SlideSources, items: PresentationItem[]): Promise<Map<string, ItemSlides>> {
  const songIds = [...new Set(items.filter((i) => i.type === 'song').map((i) => i.sourceId))];
  const songs = songIds.length ? await sources.songData(songIds) : null;
  const out = new Map<string, ItemSlides>();
  for (const item of items) out.set(item.id, await itemSlides(sources, item, songs));
  return out;
}

async function itemSlides(sources: SlideSources, item: PresentationItem, songData: SongData | null): Promise<ItemSlides> {
  // A heading shows nothing: presenting steps over it (spec 03 2f).
  if (item.type === 'header') return { slides: [], problem: null };
  if (item.type === 'bible') {
    const content = parseBibleContent(item.content);
    const slides = content ? bibleItemSlides(item.title, content) : [];
    return { slides, problem: slides.length ? null : 'no-parts' };
  }
  if (item.type === 'audio') {
    const audio = await sources.audio(item.sourceId);
    return audio ? { slides: [audioSlide(audio.fileName)], problem: null, audio: { hash: audio.hash, fileName: audio.fileName } } : { slides: [], problem: 'audio-missing' };
  }
  if (item.type === 'video') {
    const video = await sources.video(item.sourceId);
    return video ? { slides: [videoSlide(video)], problem: null, video } : { slides: [], problem: 'video-missing' };
  }
  if (item.type === 'custom') {
    // A reference as a song is: the slide as it is in the library now, a page a slide; trashed, it still shows.
    const custom = await sources.customSlide(item.sourceId);
    if (!custom) return { slides: [], problem: 'custom-missing' };
    // A PDF's page is a picture slide too: a public output and a screen show its picture (the gate's SLIDE_PAGES_SQL).
    const slides = custom.pages.map((page, i): Slide => {
      const pdf = page.backgroundPage;
      return { key: `page${i}`, kind: pdf ? 'media' : 'song', image: pdf?.full ?? null, thumb: pdf?.thumb ?? null, text: customPageText(page), verses: null, label: null, credits: null, custom: page };
    });
    return { slides, problem: null };
  }
  if (item.type === 'image') {
    // A slide per picture. A reference like a song, but a trashed picture still shows (MEDIA-R8); a purged one is gone.
    const found = await Promise.all(imageItemIds(item).map((id) => sources.image(id)));
    const slides = found.flatMap((image, i) => (image ? [imageSlide(image.fullHash, `image${i}`, image.thumbHash)] : []));
    return slides.length ? { slides, problem: null } : { slides: [], problem: 'image-missing' };
  }
  const song = songData?.songs.get(item.sourceId);
  if (!song) return { slides: [], problem: 'song-missing' };
  if (song.deletedAt !== null) return { slides: [], problem: 'song-trashed' }; // D17: skipped live
  const slides = songSlides(song, songData!.parts, songData!.labels, songData!.arrangements, item.arrangementId);
  return { slides, problem: slides.length ? null : 'no-parts' };
}
