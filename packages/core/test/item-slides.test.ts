import { describe, expect, it } from 'vitest';
import { readItemSlides, type SlideSources, type SongData } from '../src/item-slides.ts';
import type { LibraryAudio, LibraryImage, PresentationItem, Song } from '../src/schema.ts';

const item = (id: string, type: PresentationItem['type'], sourceId = id, content: string | null = null): PresentationItem => ({
  id,
  presentationId: 'P',
  type,
  title: id,
  sourceId,
  sort: 0,
  arrangementId: null,
  content,
  overlayId: null,
  note: null,
});
const song = (id: string, deletedAt: number | null = null): Song => ({ id, name: id, author: null, publisher: null, year: null, ccli: null, deletedAt });

/** A library of one song of two parts, one picture and nothing else; counts how often the songs are read. */
function library(songs: Song[] = [song('S')]): SlideSources & { songReads: number } {
  const sources = {
    songReads: 0,
    async songData(): Promise<SongData> {
      sources.songReads++;
      return {
        songs: new Map(songs.map((s) => [s.id, s])),
        parts: [0, 1].map((sort) => ({ id: `S${sort}`, songId: 'S', sort, labelId: null, content: `part ${sort}` })),
        labels: new Map(),
        arrangements: [],
      };
    },
    audio: async () => null,
    video: async () => null,
    customSlide: async () => null,
    image: async (id: string) => (id === 'pic' ? ({ fullHash: 'full', thumbHash: 'thumb' } as LibraryImage) : null),
  };
  return sources;
}

describe('readItemSlides', () => {
  it("gives a song item a slide per part, and reads the running order's songs once", async () => {
    const sources = library();

    const slides = await readItemSlides(sources, [item('a', 'song', 'S'), item('b', 'song', 'S')]);

    expect([slides.get('a')!.slides.map((s) => s.text), slides.get('b')!.slides.length, sources.songReads]).toEqual([['part 0', 'part 1'], 2, 1]);
  });

  it('gives a heading no slides and no problem', async () => {
    const slides = await readItemSlides(library(), [item('h', 'header')]);

    expect(slides.get('h')).toEqual({ slides: [], problem: null });
  });

  it('gives a song in the trash no slides, so presenting steps over it', async () => {
    const slides = await readItemSlides(library([song('S', 123)]), [item('a', 'song', 'S')]);

    expect(slides.get('a')).toEqual({ slides: [], problem: 'song-trashed' });
  });

  it('says a song is missing when it is gone', async () => {
    const slides = await readItemSlides(library(), [item('a', 'song', 'gone')]);

    expect(slides.get('a')!.problem).toBe('song-missing');
  });

  it('keeps the pictures of an image item that are still there, and drops one that is gone', async () => {
    const images = item('i', 'image', 'pic', JSON.stringify({ images: ['gone', 'pic'] }));

    const slides = await readItemSlides(library(), [images]);

    expect(slides.get('i')!.slides.map((s) => [s.key, s.image])).toEqual([['image1', 'full']]);
  });

  it('says an audio item is missing when its file is gone, and plays it when it is there', async () => {
    const sources = { ...library(), audio: async (id: string) => (id === 'mp3' ? ({ hash: 'h', fileName: 'Psalm.mp3' } as LibraryAudio) : null) };

    const slides = await readItemSlides(sources, [item('there', 'audio', 'mp3'), item('gone', 'audio', 'x')]);

    expect([slides.get('there')!.audio, slides.get('gone')!.problem]).toEqual([{ hash: 'h', fileName: 'Psalm.mp3' }, 'audio-missing']);
  });
});
