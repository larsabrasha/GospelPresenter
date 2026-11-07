import { IDLE, type AudioCommand, type LiveAudio, type LivePointer, type LiveVideo, type VideoCommand } from '@gp/core';
import type { AudioControl } from './audio.ts';
import { expectedPosition, type VideoControl, type VideoRef, type VideoState } from './video.ts';

// Where audio and video play (Lars, 2026-11-07). The primary output plays them: the first output window opened that
// is still open, picture and sound from one element, so they are in step on the screen the room sees, and nothing the
// operator does in the presenting window moves that element. With no output window open, the presenting window plays
// them. The presenting window decides which window that is, on the live channel, and hands over from where they were
// when an output window opens or closes. Everything else follows the state the primary reports: the other outputs and
// the presenting window's own picture muted, the controllers through the server.

/** What a player reports: its video and audio as they were at `at`, the next video it buffers, and whether the browser wants a tap before it plays. */
export interface Played {
  video: VideoState | null;
  next: VideoRef | null;
  audio: LiveAudio | null;
  at: number;
  refused: boolean;
}

export type PlayerCommand = { kind: 'video'; command: VideoCommand } | { kind: 'audio'; command: AudioCommand };

/** What plays in a window (player.ts), as the playback drives it. */
export interface Plays {
  /** Plays what the pointer shows; `from` goes on where another window left it. */
  follow(p: LivePointer, from?: Played): void;
  /** Stops, and says where it was, for the next window to go on from. */
  release(): Played;
  played(): Played;
  subscribe(fn: () => void): () => void;
  command(c: PlayerCommand): void;
}

/** The messages about who plays, between the presenting window and its output windows. */
export type PlaybackMessage =
  /** An output window opened, or answers a roll call (it asks for the pointer with it). */
  | { type: 'hello'; id: string }
  /** An output window is still open: every ALIVE_MS, and at once on a roll call if it plays. */
  | { type: 'alive'; id: string; primary: boolean }
  /** An output window closes. */
  | { type: 'bye'; id: string }
  /** The presenting window started: which output windows are open? */
  | { type: 'roll' }
  /** Which output window plays, and from where; none, the presenting window. */
  | { type: 'primary'; id: string | null; from: Played | null }
  /** The primary output's player, on every change. */
  | { type: 'played'; id: string; played: Played }
  /** A command for the primary output's player. */
  | { type: 'command'; id: string; command: PlayerCommand };

/** The live channel, as the playback uses it. */
export interface PlaybackBus {
  post(m: PlaybackMessage): void;
  listen(fn: (m: PlaybackMessage) => void): () => void;
}

/** How often an output window says it is open. */
export const ALIVE_MS = 1000;
/** An output window not heard from for this long has closed (a page that never said bye: a crash). */
export const GONE_MS = 4000;
/** How long a presenting window that starts waits for the output windows to answer, before it plays itself. */
export const ROLL_MS = 800;
/** How long the presenting window waits, after the primary output closes, before it plays itself: a reload comes back. */
export const GRACE_MS = 1500;

/** A video state kept from before a reload, as a player's report, for the next player to go on from. */
export function playedFromVideo(v: LiveVideo): Played {
  return { video: { hash: v.hash, type: v.type, codec: v.codec, itemId: '', playing: v.playing, position: v.position, duration: null }, next: null, audio: null, at: v.at, refused: false };
}

/** A position reported at `at`, moved on to `now` while it plays, never past the end. */
function movedOn<S extends { playing: boolean; position: number; duration: number | null }>(s: S, at: number, now: number): S {
  const position = expectedPosition({ ...s, at }, now, s.duration);
  return { ...s, position, playing: s.playing && (s.duration === null || position < s.duration) };
}

/** The presenting window's video, wherever it plays: what the live page, the owner and the outputs read. */
export interface PlaybackVideo extends VideoControl {
  live(now?: number): LiveVideo | null;
  next(): VideoRef | null;
}

/**
 * The presenting window's side: picks the primary output, plays here while there is none, and is the audio and
 * video the live page drives and the owner reports, wherever they play.
 */
export class Playback {
  readonly video: PlaybackVideo;
  readonly audio: AudioControl;
  /** The output windows open, when each was heard from last, in the order they opened. */
  private outputs = new Map<string, number>();
  private primary: string | null = null;
  /** The primary output's last report. */
  private remote: Played | null = null;
  /** Whether the player here plays. */
  private local = false;
  /** Where the next player goes on from: kept from before a reload, or the primary that closed. */
  private pending: Played | null;
  private starting = true;
  private grace: ReturnType<typeof setTimeout> | null = null;
  private pointer: LivePointer = IDLE;
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];

  constructor(
    private bus: PlaybackBus,
    private player: Plays,
    restored: Played | null = null,
  ) {
    this.pending = restored;
    this.offs.push(
      bus.listen((m) => this.receive(m)),
      player.subscribe(() => this.local && this.notify()),
    );
    const roll = setTimeout(() => {
      this.starting = false;
      this.decide();
    }, ROLL_MS);
    const sweep = setInterval(() => this.sweep(), ALIVE_MS);
    this.offs.push(
      () => clearTimeout(roll),
      () => clearInterval(sweep),
      () => this.grace && clearTimeout(this.grace),
    );
    bus.post({ type: 'roll' });
    this.video = {
      state: () => this.videoState(),
      subscribe: (fn) => this.subscribe(fn),
      command: (command) => this.send({ kind: 'video', command }),
      live: (now = Date.now()) => {
        const s = this.videoState(now);
        return s && { hash: s.hash, type: s.type, codec: s.codec, playing: s.playing, position: s.position, at: now };
      },
      next: () => this.current()?.next ?? null,
    };
    this.audio = {
      state: () => {
        const p = this.current();
        return p?.audio ? movedOn(p.audio, p.at, Date.now()) : null;
      },
      subscribe: (fn) => this.subscribe(fn),
      command: (command) => this.send({ kind: 'audio', command }),
    };
  }

  /** The pointer changed: the player here plays what it shows; the primary output reads the pointer itself. */
  follow(p: LivePointer) {
    this.pointer = p;
    if (this.local) this.player.follow(p);
  }

  /** Which output window plays; null while the presenting window does, or nobody yet. */
  primaryOutput(): string | null {
    return this.primary;
  }

  /** Whether the browser that plays wants a tap first. */
  refused(): boolean {
    return !!this.current()?.refused;
  }

  close() {
    for (const off of this.offs) off();
  }

  private subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  private current(): Played | null {
    return this.local ? this.player.played() : this.remote;
  }

  private videoState(now = Date.now()): VideoState | null {
    const p = this.current();
    return p?.video ? movedOn(p.video, p.at, now) : null;
  }

  private send(command: PlayerCommand) {
    if (this.local) this.player.command(command);
    else if (this.primary) this.bus.post({ type: 'command', id: this.primary, command });
  }

  private receive(m: PlaybackMessage) {
    if (m.type === 'hello') this.heard(m.id);
    else if (m.type === 'alive') {
      this.heard(m.id);
      // A presenting window that reloaded finds the output that kept playing, and leaves it be.
      if (m.primary && this.starting && !this.primary) this.primary = m.id;
      // One that thinks it plays but does not (it was taken for closed): told who does, it stops.
      else if (m.primary && m.id !== this.primary) this.bus.post({ type: 'primary', id: this.primary, from: null });
    } else if (m.type === 'bye') this.drop(m.id);
    else if (m.type === 'played' && m.id === this.primary) {
      this.remote = m.played;
      this.notify();
      return;
    } else return;
    this.decide();
  }

  private heard(id: string) {
    this.outputs.set(id, Date.now());
  }

  private sweep() {
    const now = Date.now();
    for (const [id, last] of this.outputs) if (now - last > GONE_MS) this.drop(id);
    this.decide();
  }

  /** An output window closed: if it played, whoever plays next goes on from its last report. */
  private drop(id: string) {
    if (!this.outputs.delete(id) || id !== this.primary) return;
    // Its last report stays what the controls show until the next one takes over, which goes on from there.
    this.pending = this.remote;
    this.primary = null;
    // Nobody plays meanwhile, the output that went quiet included.
    this.bus.post({ type: 'primary', id: null, from: null });
    if (!this.outputs.size) this.grace = setTimeout(() => this.playHere(), GRACE_MS);
    this.notify();
  }

  /** The first output window opened that is still open plays; with none, this window, unless one may come back. */
  private decide() {
    if (this.starting || (this.primary && this.outputs.has(this.primary))) return;
    const first = this.outputs.keys().next();
    if (!first.done) this.handTo(first.value);
    else if (!this.local && !this.grace) this.playHere();
  }

  private handTo(id: string) {
    this.stopGrace();
    const from = this.local ? this.player.release() : this.pending;
    this.local = false;
    this.pending = null;
    this.primary = id;
    // Until the output reports, where it goes on from is the best guess.
    this.remote = from;
    this.bus.post({ type: 'primary', id, from });
    this.notify();
  }

  private playHere() {
    this.stopGrace();
    if (this.local) return;
    this.local = true;
    const from = this.pending;
    this.pending = null;
    this.remote = null;
    this.player.follow(this.pointer, from ?? undefined);
    this.notify();
  }

  private stopGrace() {
    if (this.grace) clearTimeout(this.grace);
    this.grace = null;
  }
}

/**
 * An output window's side: says it is open, and plays while it is the primary output, from the pointer it reads
 * itself, reporting its player on every change and taking the presenting window's commands.
 */
export class OutputPlayback {
  private primary = false;
  private listeners = new Set<() => void>();
  private offPlayer: () => void = () => {};

  constructor(
    private bus: PlaybackBus,
    private id: string,
    private player: Plays,
    private live: { readonly pointer: LivePointer; subscribe(fn: (p: LivePointer) => void): () => void },
  ) {
    const offBus = bus.listen((m) => this.receive(m));
    const offLive = live.subscribe((p) => this.primary && this.player.follow(p));
    const timer = setInterval(() => this.alive(), ALIVE_MS);
    this.close = () => {
      offBus();
      offLive();
      clearInterval(timer);
      bus.post({ type: 'bye', id });
    };
    addEventListener('pagehide', this.close);
  }

  /** The window closes: it says bye and stops listening. */
  readonly close: () => void;

  /** Whether this window plays the audio and video. */
  isPrimary = (): boolean => this.primary;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private alive() {
    this.bus.post({ type: 'alive', id: this.id, primary: this.primary });
  }

  private report() {
    if (this.primary) this.bus.post({ type: 'played', id: this.id, played: this.player.played() });
  }

  private receive(m: PlaybackMessage) {
    // A presenting window that started: hello again, which brings the pointer too, as when this window opened.
    if (m.type === 'roll') {
      this.bus.post({ type: 'hello', id: this.id });
      if (this.primary) this.alive();
      this.report();
    } else if (m.type === 'primary') this.become(m.id === this.id, m.from);
    else if (m.type === 'command' && m.id === this.id && this.primary) this.player.command(m.command);
  }

  private become(primary: boolean, from: Played | null) {
    if (primary === this.primary) return;
    this.primary = primary;
    if (primary) {
      this.offPlayer = this.player.subscribe(() => this.report());
      this.player.follow(this.live.pointer, from ?? undefined);
      this.report();
    } else {
      this.offPlayer();
      this.player.release();
    }
    for (const fn of this.listeners) fn();
  }
}
