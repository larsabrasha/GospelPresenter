import { bibleItemSlides, IDLE, imageSlide, newer, parseBibleContent, songSlides, type LivePointer, type PresentationItem, type Slide } from '@gp/core';
import type { ReadDb } from '../db/share.ts';
import { arrangementsOf, getImage, getSong, listLabels, songPartsOf } from '../db/queries.ts';

type LiveMessage = { type: 'pointer'; pointer: LivePointer } | { type: 'hello' };

/**
 * The live pointer between the windows of one machine (ADR 0007, decision 4).
 * The operator window owns it and answers `hello` from an output that opens
 * later. Outputs render from their own copy of the database plus the pointer.
 */
export class LiveChannel {
  private channel: BroadcastChannel;
  private current: LivePointer = IDLE;
  private listeners = new Set<(p: LivePointer) => void>();

  constructor(
    orgId: string,
    private role: 'operator' | 'output',
  ) {
    this.channel = new BroadcastChannel(`gp-live:${orgId}`);
    this.channel.addEventListener('message', (e: MessageEvent<LiveMessage>) => {
      if (e.data.type === 'hello') {
        if (this.role === 'operator') this.channel.postMessage({ type: 'pointer', pointer: this.current } satisfies LiveMessage);
      } else this.receive(e.data.pointer);
    });
    if (role === 'output') this.channel.postMessage({ type: 'hello' } satisfies LiveMessage);
  }

  get pointer(): LivePointer {
    return this.current;
  }

  private receive(p: LivePointer) {
    const next = newer(this.current, p);
    if (next === this.current) return;
    this.current = next;
    for (const fn of this.listeners) fn(next);
  }

  /** Operator only: changes what the outputs show. */
  set(change: Partial<Omit<LivePointer, 'rev'>>) {
    const pointer = { ...this.current, ...change, rev: this.current.rev + 1 };
    this.receive(pointer);
    this.channel.postMessage({ type: 'pointer', pointer } satisfies LiveMessage);
  }

  subscribe(fn: (p: LivePointer) => void): () => void {
    this.listeners.add(fn);
    fn(this.current);
    return () => this.listeners.delete(fn);
  }

  close() {
    this.channel.close();
  }
}

export interface ItemSlides {
  slides: Slide[];
  /** Why the item has no slides, if it has none. */
  problem: 'song-missing' | 'song-trashed' | 'no-parts' | 'image-missing' | null;
}

/**
 * The slides of one item. A song item is a reference: its slides come from
 * the current song in the item's arrangement (spec 03). A Bible item carries
 * its own slides, frozen when it was added (BIBLE-R12).
 */
export async function slidesOf(db: ReadDb, item: PresentationItem): Promise<ItemSlides> {
  if (item.type === 'bible') {
    const content = parseBibleContent(item.content);
    const slides = content ? bibleItemSlides(item.title, content) : [];
    return { slides, problem: slides.length ? null : 'no-parts' };
  }
  if (item.type === 'image') {
    // A reference like a song, but a trashed picture still shows (MEDIA-R8); a purged one is gone.
    const image = await getImage(db, item.sourceId);
    return image ? { slides: [imageSlide(image.fullHash)], problem: null } : { slides: [], problem: 'image-missing' };
  }
  const song = await getSong(db, item.sourceId);
  if (!song) return { slides: [], problem: 'song-missing' };
  if (song.deletedAt !== null) return { slides: [], problem: 'song-trashed' }; // D17: skipped live
  const slides = songSlides(song, await songPartsOf(db, [song.id]), await listLabels(db), await arrangementsOf(db, [song.id]), item.arrangementId);
  return { slides, problem: slides.length ? null : 'no-parts' };
}
