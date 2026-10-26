import { IDLE, newer, songSlides, type LivePointer, type PresentationItem, type Slide } from '@gp/core';
import type { ReadDb } from '../db/share.ts';
import { getSong, listLabels, songPartsOf } from '../db/queries.ts';

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
  problem: 'song-missing' | 'song-trashed' | 'no-parts' | null;
}

/** The slides of one item, from the current song (spec 03: a song item is a reference). */
export async function slidesOf(db: ReadDb, item: PresentationItem): Promise<ItemSlides> {
  const song = await getSong(db, item.sourceId);
  if (!song) return { slides: [], problem: 'song-missing' };
  if (song.deletedAt !== null) return { slides: [], problem: 'song-trashed' }; // D17: skipped live
  const slides = songSlides(song, await songPartsOf(db, [song.id]), await listLabels(db));
  return { slides, problem: slides.length ? null : 'no-parts' };
}
