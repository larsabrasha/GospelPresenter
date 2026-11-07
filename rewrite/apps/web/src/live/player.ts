import type { LivePointer } from '@gp/core';
import { getVideo, itemsOf } from '../db/queries.ts';
import type { ReadDb } from '../db/share.ts';
import { AudioEngine, audioUrlOfItem } from './audio.ts';
import type { Played, PlayerCommand, Plays } from './playback.ts';
import { followSoundOutput } from './soundOutput.ts';
import { expectedPosition, VideoEngine } from './video.ts';

/**
 * The audio and video of what is shown, played in this window: by the primary output, or by the presenting window
 * while no output window is open (playback.ts). It follows the live pointer: a video item shown plays from its start,
 * the next item's video buffers meanwhile, an audio item shown plays from its start, anything else stops them, and
 * the black screen pauses them (Lars, 2026-11-06).
 */
export class Player implements Plays {
  readonly video: VideoEngine;
  readonly audio: AudioEngine;
  /** Pointers followed, so one whose reads finish late never undoes a newer one. */
  private turn = 0;

  constructor(
    private db: ReadDb,
    video?: VideoEngine,
    audio?: AudioEngine,
  ) {
    this.video = video ?? new VideoEngine();
    this.audio = audio ?? new AudioEngine((itemId) => audioUrlOfItem(db, itemId));
    // Its sound to the device chosen under Utgångar, for the window's lifetime.
    followSoundOutput(() => [...this.video.elements(), ...this.audio.elements()]);
  }

  follow(p: LivePointer, from?: Played) {
    void this.run(p, from);
  }

  private async run(p: LivePointer, from: Played | undefined) {
    const mine = ++this.turn;
    if (!p.presentationId) {
      this.video.stop();
      await this.audio.show(null);
      return;
    }
    const items = await itemsOf(this.db, p.presentationId);
    const at = items.findIndex((i) => i.id === p.itemId);
    const item = at >= 0 ? items[at] : undefined;
    const videoOf = async (i: (typeof items)[number] | undefined) => (i?.type === 'video' ? await getVideo(this.db, i.sourceId) : null);
    const shownVideo = await videoOf(item);
    const nextVideo = at >= 0 ? await videoOf(items[at + 1]) : null;
    if (mine !== this.turn) return;
    // Handed over, or a reloaded window: the video or audio shown goes on where it was, if it is the same.
    const v = from?.video && shownVideo && from.video.hash === shownVideo.hash ? from.video : null;
    const a = from?.audio && item?.type === 'audio' && from.audio.itemId === item.id ? from.audio : null;
    const resume = (s: { playing: boolean; position: number; duration: number | null } | null) =>
      s && from ? { position: expectedPosition({ ...s, at: from.at }, Date.now(), s.duration), playing: s.playing && !p.black } : undefined;
    await Promise.all([
      this.video.show(shownVideo && item ? { itemId: item.id, video: shownVideo } : null, resume(v)).then(() => {
        if (mine !== this.turn) return;
        this.video.setBlack(p.black);
        void this.video.buffer(nextVideo);
      }),
      this.audio.show(item?.type === 'audio' ? item.id : null, resume(a)).then(() => {
        if (mine === this.turn) this.audio.setBlack(p.black);
      }),
    ]);
  }

  release(): Played {
    this.turn++;
    const next = this.video.next();
    return { video: this.video.release(), next, audio: this.audio.release(), at: Date.now(), refused: false };
  }

  played(): Played {
    return { video: this.video.state(), next: this.video.next(), audio: this.audio.state(), at: Date.now(), refused: this.video.refused() || this.audio.refused() };
  }

  subscribe(fn: () => void): () => void {
    const offVideo = this.video.subscribe(fn);
    const offAudio = this.audio.subscribe(fn);
    return () => {
      offVideo();
      offAudio();
    };
  }

  command(c: PlayerCommand) {
    if (c.kind === 'video') this.video.command(c.command);
    else this.audio.command(c.command);
  }

  /** A tap in this window: what the browser held back plays. */
  unlock() {
    this.video.unlock();
    this.audio.unlock();
  }
}
