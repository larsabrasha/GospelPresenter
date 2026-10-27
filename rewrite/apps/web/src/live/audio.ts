import { useEffect, useState } from 'react';
import type { AudioCommand, LiveAudio } from '@gp/core';
import { blobUrl, getAudio } from '../db/queries.ts';
import type { ReadDb } from '../db/share.ts';
import type { LiveLink } from './remote.ts';

// Audio during live (spec 04 §1b). It plays only on the presenting computer:
// one audio item at a time is the session's audio, and it keeps playing while
// the operator moves on, until another audio item is played. Selecting it
// never changes what is shown (LIVE-R6). A controller drives it by command
// and sees a muted mirror.

/** What the live page and the stage view drive: the engine here, or a session's audio elsewhere. */
export interface AudioControl {
  /** The session's audio now, the position brought up to date. */
  state(): LiveAudio | null;
  subscribe(fn: () => void): () => void;
  command(c: AudioCommand): void;
}

/** Fade-out (Tona ut): 5 s, ease-out cubic, then pause, rewind and the volume back (spec 04 §1b). */
export const FADE_MS = 5000;
/** While the seek bar moves the sound is muted, until 150 ms after the last move. */
const SEEK_MUTE_MS = 150;

/** A tenth of a second of silence: a WAV header and zeros (8 kHz, 8-bit, mono). */
const SILENCE = (() => {
  const samples = 800;
  const b = new Uint8Array(44 + samples).fill(128, 44);
  const v = new DataView(b.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  ascii(36, 'data');
  v.setUint32(40, samples, true);
  return b;
})();

/** The audio item's file, by item: its blob as this device has it. */
export async function audioUrlOfItem(db: ReadDb, itemId: string): Promise<string | null> {
  const [item] = await db.query<{ source_id: string }>(`SELECT source_id FROM presentation_items WHERE id = ? AND type = 'audio'`, [itemId]);
  const audio = item ? await getAudio(db, item.source_id) : null;
  return audio ? blobUrl(db, audio.hash) : null;
}

/** The presenting window's audio: one element, so playing one item stops the other. */
export class AudioEngine implements AudioControl {
  private el: HTMLAudioElement;
  private itemId: string | null = null;
  private fading: ReturnType<typeof setInterval> | null = null;
  private unmute: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(private urlOf: (itemId: string) => Promise<string | null>) {
    this.el = new Audio();
    this.el.preload = 'auto';
    for (const e of ['play', 'pause', 'seeked', 'loadedmetadata', 'ended', 'durationchange']) this.el.addEventListener(e, () => this.notify());
    // A browser lets a page start sound only after the user has done something there, and Safari only on an
    // element that has played after such a gesture. A controller's "play" comes with no gesture here, so the
    // element plays a moment of silence at the operator's first click or key, and may start sound later.
    const unlock = () => {
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
      if (this.itemId) return; // already playing a real file: nothing to unlock
      this.el.src = URL.createObjectURL(new Blob([SILENCE as BlobPart], { type: 'audio/wav' }));
      this.el.muted = true;
      void this.el.play().then(
        () => {
          if (!this.itemId) this.el.pause();
          this.el.muted = false;
        },
        () => (this.el.muted = false),
      );
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
  }

  state(): LiveAudio | null {
    if (!this.itemId) return null;
    const d = this.el.duration;
    return { itemId: this.itemId, playing: !this.el.paused, position: this.el.currentTime, duration: Number.isFinite(d) ? d : null, fading: this.fading !== null };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  command(c: AudioCommand): void {
    void this.run(c);
  }

  private async run(c: AudioCommand) {
    if (c.action !== 'play' && c.itemId !== this.itemId) return; // a command for audio that is not playing here
    if (c.action === 'play') {
      if (c.itemId !== this.itemId) {
        const url = await this.urlOf(c.itemId);
        if (!url) return; // not on this device (yet): nothing to play
        this.stopFade();
        this.el.src = url;
        this.itemId = c.itemId;
      }
      await this.el.play().catch(() => this.notify()); // refused (no user gesture yet): the state says it is not playing
    } else if (c.action === 'pause') {
      this.stopFade();
      this.el.pause();
    } else if (c.action === 'seek') {
      this.el.muted = true;
      this.el.currentTime = c.position;
      if (this.unmute) clearTimeout(this.unmute);
      this.unmute = setTimeout(() => (this.el.muted = false), SEEK_MUTE_MS);
    } else this.fade();
    this.notify();
  }

  /**
   * The presentation ended: its audio stops with it. Nothing playing, nothing
   * to do and nobody told: the owner calls this on every report while it
   * presents nothing, so telling would report again, for ever.
   */
  stop() {
    if (this.el.paused && !this.fading) return;
    this.stopFade();
    this.el.pause();
    this.notify();
  }

  private fade() {
    if (this.fading || this.el.paused) return;
    const start = this.el.volume;
    const began = Date.now();
    this.fading = setInterval(() => {
      const t = Math.min(1, (Date.now() - began) / FADE_MS);
      this.el.volume = start * (1 - t) ** 3; // 1 - easeOutCubic(t)
      if (t < 1) return;
      this.stopFade();
      this.el.pause();
      this.el.currentTime = 0;
      this.el.volume = start;
      this.notify();
    }, 50);
  }

  private stopFade() {
    if (!this.fading) return;
    clearInterval(this.fading);
    this.fading = null;
    this.el.volume = 1;
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

/**
 * A session's audio elsewhere: what the owner last reported, its position
 * moved on by the time since this window got the report, while it plays.
 * Commands go to the owner; nothing plays here.
 */
export class RemoteAudio implements AudioControl {
  private received = Date.now();
  private last: string | null = null;

  constructor(
    private link: LiveLink,
    private sessionId: string,
  ) {}

  private reported(): LiveAudio | null {
    const a = this.link.sessions.find((s) => s.id === this.sessionId)?.audio ?? null;
    const key = JSON.stringify(a);
    if (key !== this.last) {
      this.last = key;
      this.received = Date.now();
    }
    return a;
  }

  state(): LiveAudio | null {
    const a = this.reported();
    if (!a?.playing) return a;
    const position = a.position + (Date.now() - this.received) / 1000;
    return { ...a, position: a.duration === null ? position : Math.min(a.duration, position) };
  }

  subscribe(fn: () => void): () => void {
    return this.link.subscribe(fn);
  }

  command(c: AudioCommand): void {
    this.link.audioCommand(this.sessionId, c);
  }
}

/** The audio state, and while it plays, a fresh position four times a second. */
export function useAudio(control: AudioControl): LiveAudio | null {
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
