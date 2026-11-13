import {
  applyLiveChange,
  IDLE,
  newer,
  readItemSlides,
  type ItemSlides,
  type LivePointer,
  type LivePointerChange,
  type PresentationItem,
  type SlideSources,
  type LiveVideo,
} from '@gp/core';
import type { ReadDb } from '../db/share.ts';
import { newId } from '../ids.ts';
import type { OutputVideo } from './video.ts';
import type { PlaybackBus, PlaybackMessage } from './playback.ts';
import { getCustomSlide } from '../db/customSlides.ts';
import { getImage } from '../db/images.ts';
import { arrangementsOf, getAudio, getVideo, listLabels, songPartsOf, songsById } from '../db/queries.ts';

/** `ask`: a presenting window just opened asks what is shown, and every window that knows answers with its pointer. */
type LiveMessage = { type: 'pointer'; pointer: LivePointer } | { type: 'video'; video: OutputVideo } | { type: 'ask' } | PlaybackMessage;

function restoreVideo(key: string): LiveVideo | null {
  try {
    const stored = sessionStorage.getItem(key);
    return stored ? (JSON.parse(stored) as LiveVideo) : null;
  } catch {
    return null;
  }
}

function restore(key: string): LivePointer | null {
  try {
    const stored = sessionStorage.getItem(key);
    return stored ? (JSON.parse(stored) as LivePointer) : null;
  } catch {
    return null;
  }
}

/**
 * The live pointer between the windows of one machine (ADR 0007, decision 4).
 * The operator window owns it and answers `hello` from an output that opens
 * later. Outputs render from their own copy of the database plus the pointer.
 * It also carries who plays the audio and video (playback.ts).
 */
export class LiveChannel implements PlaybackBus {
  /** An output window's own name on the channel, for the playback. */
  readonly id = newId();
  private playbackListeners = new Set<(m: PlaybackMessage) => void>();
  private channel: BroadcastChannel;
  private current: LivePointer = IDLE;
  private presenting = false;
  private storageKey: string;
  private listeners = new Set<(p: LivePointer) => void>();
  private video: OutputVideo = { video: null, next: null };
  private videoListeners = new Set<(v: OutputVideo) => void>();
  /**
   * The overlay each item of the presenting presentation carries, kept
   * current by the owner (`useLiveOwner`), so `set` can switch it on and off
   * at once, with the slide, in one message.
   */
  itemOverlays = new Map<string, string | null>();

  /** Where the video was when this window was reloaded, if it played one: it resumes from there (Lars, 2026-10-31). */
  restoredVideo: LiveVideo | null = null;

  constructor(
    orgId: string,
    private role: 'operator' | 'output',
  ) {
    this.channel = new BroadcastChannel(`gp-live:${orgId}`);
    this.storageKey = `gp.live:${orgId}`;
    // A reloaded operator window goes on presenting what it presented, a video where it was.
    if (role === 'operator') {
      this.current = restore(this.storageKey) ?? IDLE;
      this.restoredVideo = this.current.presentationId ? restoreVideo(`${this.storageKey}:video`) : null;
      this.presenting = this.current.presentationId !== null;
    }
    this.channel.addEventListener('message', (e: MessageEvent<LiveMessage>) => {
      const m = e.data;
      if (m.type === 'pointer') return this.receive(m.pointer, false);
      // A window opened later (a second tab, the app opened again) takes up what the outputs show, so its own changes,
      // numbered after it, reach them (the review, 2026-11-09).
      if (m.type === 'ask') return void (this.current.rev > 0 && this.channel.postMessage({ type: 'pointer', pointer: this.current } satisfies LiveMessage));
      if (m.type === 'video') return void (this.role === 'output' && this.receiveVideo(m.video));
      // The pointer first, so an output that becomes the primary has it before it plays.
      if (m.type === 'hello' && this.role === 'operator') {
        this.channel.postMessage({ type: 'pointer', pointer: this.current } satisfies LiveMessage);
        this.channel.postMessage({ type: 'video', video: this.video } satisfies LiveMessage);
      }
      for (const fn of this.playbackListeners) fn(m);
    });
    if (role === 'output') this.channel.postMessage({ type: 'hello', id: this.id } satisfies LiveMessage);
    else this.channel.postMessage({ type: 'ask' } satisfies LiveMessage);
  }

  /**
   * Whether this window presents: it set the pointer last, or another window has not set one since. Only that window
   * plays sound and video here, so a second tab on the machine never plays it again (the review, 2026-11-09).
   */
  presents(): boolean {
    return this.presenting;
  }

  get pointer(): LivePointer {
    return this.current;
  }

  private receive(p: LivePointer, own: boolean) {
    const next = newer(this.current, p);
    if (next === this.current) return;
    this.current = next;
    this.presenting = own;
    for (const fn of this.listeners) fn(next);
  }

  /** Operator only: changes what the outputs show, with the overlay rules of `applyLiveChange`. */
  set(change: LivePointerChange) {
    const pointer = { ...applyLiveChange(this.current, change, (itemId) => this.itemOverlays.get(itemId) ?? null), rev: this.current.rev + 1 };
    this.receive(pointer, true);
    this.channel.postMessage({ type: 'pointer', pointer } satisfies LiveMessage);
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(pointer));
    } catch {
      // no storage: a reload stops presenting
    }
  }

  subscribe(fn: (p: LivePointer) => void): () => void {
    this.listeners.add(fn);
    fn(this.current);
    return () => this.listeners.delete(fn);
  }

  /**
   * Operator only: where the video plays now, and the next one to buffer, for
   * the output window on this machine (TODO.md "Video on the outputs"). Sent
   * on every change of the video, never through the server.
   */
  setVideo(video: OutputVideo) {
    this.video = video;
    this.channel.postMessage({ type: 'video', video } satisfies LiveMessage);
    try {
      if (video.video) sessionStorage.setItem(`${this.storageKey}:video`, JSON.stringify(video.video));
      else sessionStorage.removeItem(`${this.storageKey}:video`);
    } catch {
      // no storage: a reload starts the video over
    }
  }

  private receiveVideo(video: OutputVideo) {
    this.video = video;
    for (const fn of this.videoListeners) fn(video);
  }

  /** Output only: the video the operator plays, now and on every change. */
  subscribeVideo(fn: (v: OutputVideo) => void): () => void {
    this.videoListeners.add(fn);
    fn(this.video);
    return () => this.videoListeners.delete(fn);
  }

  post(m: PlaybackMessage) {
    this.channel.postMessage(m satisfies LiveMessage);
  }

  listen(fn: (m: PlaybackMessage) => void): () => void {
    this.playbackListeners.add(fn);
    return () => this.playbackListeners.delete(fn);
  }

  close() {
    this.channel.close();
  }
}

/** The database's reads the core's slides take (`SlideSources`). */
const sourcesOf = (db: ReadDb): SlideSources => ({
  songData: async (ids) => ({ songs: await songsById(db, ids), parts: await songPartsOf(db, ids), labels: await listLabels(db), arrangements: await arrangementsOf(db, ids) }),
  audio: (id) => getAudio(db, id),
  video: (id) => getVideo(db, id),
  customSlide: (id) => getCustomSlide(db, id),
  image: (id) => getImage(db, id),
});

/** One item's slides, as the core works them out (`readItemSlides`). */
export async function slidesOf(db: ReadDb, item: PresentationItem): Promise<ItemSlides> {
  return (await readItemSlides(sourcesOf(db), [item])).get(item.id)!;
}

/** Every item's slides of a running order, by item id, as the core works them out. */
export async function slidesOfItems(db: ReadDb, items: PresentationItem[]): Promise<Map<string, ItemSlides>> {
  return readItemSlides(sourcesOf(db), items);
}
