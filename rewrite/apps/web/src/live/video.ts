import { useEffect, useState } from 'react';
import type { LibraryVideo, LiveVideo, VideoCodec, VideoType } from '@gp/core';
import { playUrl } from '../media/video.ts';

// Video during live (TODO.md "Video on the outputs"). The presenting window
// plays it: one element, unmuted, whose sound is the presenting computer's, as
// an audio item's is (LIVE-R6), and whose clock every output follows. The
// output window on the same machine plays the picture, muted, from the state
// this window posts on the live channel; a paired screen does the same from
// the state in the canvas the server sends; a public output shows the still.
// Each follower works out where the video should be now and nudges its speed,
// or seeks when it is more than a fraction of a second off (`follow`).

/** What the outputs need of a video: which one, and what plays it. */
export interface VideoRef {
  hash: string;
  type: VideoType;
  codec: VideoCodec;
}

/** The presenting window's video now: the item, the video, playing or not, where, and how long. */
export interface VideoState extends VideoRef {
  itemId: string;
  playing: boolean;
  position: number;
  duration: number | null;
}

export type VideoCommand = { action: 'play' | 'pause'; itemId: string } | { action: 'seek'; itemId: string; position: number };

/** What the live page and the stage view drive: the engine in the presenting window. */
export interface VideoControl {
  state(): VideoState | null;
  subscribe(fn: () => void): () => void;
  command(c: VideoCommand): void;
}

/** What the output window follows: the video and where it was at `at` (this machine's clock), and the next one to buffer. */
export interface OutputVideo {
  video: LiveVideo | null;
  /** The video of the item after the live one: buffered now, so it starts at once when it goes live. */
  next: VideoRef | null;
}

/** A follower this far off seeks rather than nudging its speed: "more than a fraction of a second". */
export const SEEK_DRIFT_S = 0.3;
/** A follower within this of where it should be plays at normal speed. */
const IN_STEP_S = 0.04;
/** The most a follower changes its speed by to catch up or wait: 5 %, which nobody hears in a muted picture. */
const MAX_NUDGE = 0.05;

/** Where a video should be at `now`: its position at `at`, moved on while it plays, never past its end. */
export function expectedPosition(v: Pick<LiveVideo, 'playing' | 'position' | 'at'>, now: number, duration: number | null = null): number {
  const position = v.playing ? v.position + Math.max(0, now - v.at) / 1000 : v.position;
  return duration !== null && Number.isFinite(duration) ? Math.min(duration, position) : position;
}

/**
 * How a follower gets in step: seek when it is more than SEEK_DRIFT_S off
 * (or paused anywhere but where it should be), else play a little faster or
 * slower until it is within IN_STEP_S.
 */
export function follow(expected: number, actual: number, playing: boolean): { seekTo: number | null; rate: number } {
  const diff = expected - actual;
  if (!playing) return { seekTo: Math.abs(diff) > IN_STEP_S ? expected : null, rate: 1 };
  if (Math.abs(diff) > SEEK_DRIFT_S) return { seekTo: expected, rate: 1 };
  if (Math.abs(diff) <= IN_STEP_S) return { seekTo: null, rate: 1 };
  return { seekTo: null, rate: 1 + Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, diff / 2)) };
}

/** Puts an element where `video` says, now; `now` is the clock `video.at` is on. */
export function keepInStep(el: HTMLVideoElement, video: LiveVideo, now: number) {
  const duration = Number.isFinite(el.duration) ? el.duration : null;
  const playing = video.playing && (duration === null || expectedPosition(video, now, duration) < duration);
  const step = follow(expectedPosition(video, now, duration), el.currentTime, playing);
  if (step.seekTo !== null && !el.seeking) el.currentTime = step.seekTo;
  if (el.playbackRate !== step.rate) el.playbackRate = step.rate;
  if (playing && el.paused) void el.play().catch(() => undefined);
  if (!playing && !el.paused) el.pause();
}

/** Whether an element is advancing: playing, and not waiting for data. */
const advancing = (el: HTMLVideoElement) => !el.paused && !el.ended && el.readyState >= 3;

/** One element and the video it holds. */
interface Slot {
  el: HTMLVideoElement;
  ref: VideoRef | null;
}

function newSlot(onEvent: () => void): Slot {
  const el = document.createElement('video');
  el.preload = 'auto';
  el.playsInline = true;
  for (const e of ['play', 'pause', 'playing', 'waiting', 'seeked', 'loadedmetadata', 'durationchange', 'ended', 'ratechange']) el.addEventListener(e, onEvent);
  return { el, ref: null };
}

/**
 * The presenting window's video: the item shown, playing in an element of its
 * own, with sound. A second element buffers the next video item, so it starts
 * at once when it goes live. Leaving the item stops it.
 */
export class VideoEngine implements VideoControl {
  private current: Slot;
  private spare: Slot;
  private itemId: string | null = null;
  private listeners = new Set<() => void>();
  /** Changes of item, so a URL that arrives late never loads into a newer one. */
  private turn = 0;

  constructor(private urlOf: (hash: string) => Promise<string | null> = playUrl) {
    const notify = () => this.notify();
    this.current = newSlot(notify);
    this.spare = newSlot(notify);
  }

  state(): VideoState | null {
    const ref = this.current.ref;
    if (!this.itemId || !ref) return null;
    const el = this.current.el;
    return { ...ref, itemId: this.itemId, playing: advancing(el), position: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : null };
  }

  /** The state as the outputs take it: where it is at this moment. */
  live(now = Date.now()): LiveVideo | null {
    const s = this.state();
    return s && { hash: s.hash, type: s.type, codec: s.codec, playing: s.playing, position: s.position, at: now };
  }

  /** The video buffered for the next item. */
  next(): VideoRef | null {
    return this.itemId ? (this.spare.ref ?? null) : (this.current.ref ?? null);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The item now live: a video item starts from its beginning, at once if it
   * was buffered; anything else stops the video. The same item again changes nothing.
   */
  async show(item: { itemId: string; video: LibraryVideo } | null) {
    if ((item?.itemId ?? null) === this.itemId) return;
    const turn = ++this.turn;
    this.current.el.pause();
    if (!item) {
      this.itemId = null;
      return this.notify();
    }
    const ref = { hash: item.video.hash, type: item.video.contentType, codec: item.video.codec };
    if (this.spare.ref?.hash === ref.hash && this.current.ref?.hash !== ref.hash) [this.current, this.spare] = [this.spare, this.current];
    this.itemId = item.itemId;
    if (this.current.ref?.hash !== ref.hash) {
      const url = await this.urlOf(ref.hash);
      if (turn !== this.turn || !url) return this.notify();
      this.current.ref = ref;
      this.current.el.src = url;
    }
    this.current.el.currentTime = 0;
    await this.start(this.current.el);
    this.notify();
  }

  /** Buffers the next item's video, so its start is there when it goes live. */
  async buffer(video: LibraryVideo | null) {
    const slot = this.itemId ? this.spare : this.current;
    if (!video || slot.ref?.hash === video.hash || this.current.ref?.hash === video.hash) return;
    const url = await this.urlOf(video.hash);
    if (!url || slot.ref?.hash === video.hash) return;
    slot.ref = { hash: video.hash, type: video.contentType, codec: video.codec };
    slot.el.src = url;
    slot.el.load();
    this.notify();
  }

  command(c: VideoCommand): void {
    if (c.itemId !== this.itemId) return;
    const el = this.current.el;
    if (c.action === 'play') {
      if (el.ended) el.currentTime = 0;
      void this.start(el);
    } else if (c.action === 'pause') el.pause();
    else if (c.action === 'seek') el.currentTime = c.position;
    this.notify();
  }

  /** The presentation ended: the video stops with it. */
  stop() {
    if (!this.itemId) return;
    this.turn++;
    this.itemId = null;
    this.current.el.pause();
    this.notify();
  }

  /** Plays; a browser that refuses sound without a gesture gets the picture going muted. */
  private async start(el: HTMLVideoElement) {
    el.muted = false;
    await el.play().catch(async () => {
      el.muted = true;
      await el.play().catch(() => undefined);
    });
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

/** The video state, and while it plays, a fresh position four times a second. */
export function useVideo(control: VideoControl): VideoState | null {
  const [state, setState] = useState(() => control.state());
  useEffect(() => {
    const update = () => setState(control.state());
    const off = control.subscribe(update);
    const tick = setInterval(update, 250);
    update();
    return () => {
      off();
      clearInterval(tick);
    };
  }, [control]);
  return state;
}
