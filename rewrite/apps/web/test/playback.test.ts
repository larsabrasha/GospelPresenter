import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE, type LivePointer } from '@gp/core';
// An output window says bye on `pagehide`; Node has no window.
globalThis.addEventListener ??= () => undefined;

import { ALIVE_MS, GONE_MS, GRACE_MS, OutputPlayback, Playback, ROLL_MS, type PlaybackBus, type PlaybackMessage, type Played, type PlayerCommand, type Plays } from '../src/live/playback.ts';

// Where audio and video play (playback.ts): the first output window opened that is still open, else the presenting window.

/** A live channel between windows: a message reaches every other window, a moment later, as a BroadcastChannel's does. */
class Hub {
  private ends = new Set<Set<(m: PlaybackMessage) => void>>();
  end(): PlaybackBus {
    const mine = new Set<(m: PlaybackMessage) => void>();
    this.ends.add(mine);
    return {
      post: (m) => {
        const copy = structuredClone(m);
        for (const other of this.ends) if (other !== mine) for (const fn of other) queueMicrotask(() => fn(copy));
      },
      listen: (fn) => {
        mine.add(fn);
        return () => mine.delete(fn);
      },
    };
  }
}

const SHOWN: LivePointer = { ...IDLE, presentationId: 'P', itemId: 'V', rev: 1 };
const VIDEO = { hash: 'h', type: 'video/mp4' as const, codec: 'h264' as const, itemId: 'V', duration: 60 };

/** A window's player: whether it plays, from where it was told to go on, and what it was told to do. */
class FakePlayer implements Plays {
  playing = false;
  from: Played | undefined;
  commands: PlayerCommand[] = [];
  position = 0;
  private listeners = new Set<() => void>();
  follow(_p: LivePointer, from?: Played) {
    this.playing = true;
    this.from = from;
    this.position = from?.video?.position ?? 0;
    this.notify();
  }
  release(): Played {
    const played = this.played();
    this.playing = false;
    return played;
  }
  played(): Played {
    return { video: this.playing ? { ...VIDEO, playing: true, position: this.position } : null, next: null, audio: null, at: Date.now(), refused: false };
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  command(c: PlayerCommand) {
    this.commands.push(c);
  }
  notify() {
    for (const fn of this.listeners) fn();
  }
}

const live = { pointer: SHOWN, subscribe: (fn: (p: LivePointer) => void) => (fn(SHOWN), () => undefined) };

function presenting(hub: Hub, restored: Played | null = null) {
  const player = new FakePlayer();
  const playback = new Playback(hub.end(), player, restored);
  playback.follow(SHOWN);
  return { player, playback };
}

function output(hub: Hub, id: string) {
  const player = new FakePlayer();
  const playback = new OutputPlayback(hub.end(), id, player, live);
  return { player, playback };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('who plays the audio and video', () => {
  it('the presenting window plays when no output window answers its roll call', async () => {
    const hub = new Hub();
    const operator = presenting(hub);

    await vi.advanceTimersByTimeAsync(ROLL_MS);

    expect(operator.player.playing).toBe(true);
    expect(operator.playback.primaryOutput()).toBeNull();
  });

  it('the first output window opened takes over from where the presenting window was, and the presenting window stops', async () => {
    const hub = new Hub();
    const operator = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    operator.player.position = 12;

    const first = output(hub, 'A');
    hub.end().post({ type: 'hello', id: 'A' });
    await vi.advanceTimersByTimeAsync(0);

    expect(operator.player.playing).toBe(false);
    expect(first.player.playing).toBe(true);
    expect(first.player.from?.video?.position).toBe(12);
    expect(first.playback.isPrimary()).toBe(true);
  });

  it('a second output window follows; when the first closes, the second takes over from the first one’s last report', async () => {
    const hub = new Hub();
    const operator = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    const first = output(hub, 'A');
    hub.end().post({ type: 'hello', id: 'A' });
    await vi.advanceTimersByTimeAsync(0);
    const second = output(hub, 'B');
    hub.end().post({ type: 'hello', id: 'B' });
    await vi.advanceTimersByTimeAsync(0);
    first.player.position = 30;
    first.player.notify();
    await vi.advanceTimersByTimeAsync(0);

    first.playback.close();
    await vi.advanceTimersByTimeAsync(0);

    expect(second.player.playing).toBe(true);
    expect(second.player.from?.video?.position).toBe(30);
    expect(operator.player.playing).toBe(false);
  });

  it('when the only output window closes, the presenting window plays again after a moment, from where the output was', async () => {
    const hub = new Hub();
    const operator = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    const only = output(hub, 'A');
    hub.end().post({ type: 'hello', id: 'A' });
    await vi.advanceTimersByTimeAsync(0);
    only.player.position = 20;
    only.player.notify();
    await vi.advanceTimersByTimeAsync(0);

    only.playback.close();
    await vi.advanceTimersByTimeAsync(GRACE_MS);

    expect(operator.player.playing).toBe(true);
    expect(operator.player.from?.video?.position).toBeGreaterThanOrEqual(20);
  });

  it('an output window that reloads takes over again, and the presenting window never plays meanwhile', async () => {
    const hub = new Hub();
    const operator = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    const before = output(hub, 'A');
    hub.end().post({ type: 'hello', id: 'A' });
    await vi.advanceTimersByTimeAsync(0);
    const follows = vi.spyOn(operator.player, 'follow');

    before.playback.close();
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    const reloaded = output(hub, 'A2');
    hub.end().post({ type: 'hello', id: 'A2' });
    await vi.advanceTimersByTimeAsync(GRACE_MS);

    expect(follows).not.toHaveBeenCalled();
    expect(reloaded.player.playing).toBe(true);
  });

  it('an output window not heard from for a while is taken for closed', async () => {
    const hub = new Hub();
    const operator = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    hub.end().post({ type: 'hello', id: 'GONE' });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(GONE_MS + ALIVE_MS + GRACE_MS);

    expect(operator.playback.primaryOutput()).toBeNull();
    expect(operator.player.playing).toBe(true);
  });

  it('a presenting window that reloads leaves the output that kept playing be, and does not play itself', async () => {
    const hub = new Hub();
    const old = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    const kept = output(hub, 'A');
    hub.end().post({ type: 'hello', id: 'A' });
    await vi.advanceTimersByTimeAsync(0);
    old.playback.close();
    const follows = vi.spyOn(kept.player, 'follow');

    const reloaded = presenting(hub, kept.player.played());
    await vi.advanceTimersByTimeAsync(ROLL_MS);

    expect(reloaded.playback.primaryOutput()).toBe('A');
    expect(reloaded.player.playing).toBe(false);
    expect(follows).not.toHaveBeenCalled();
  });

  it('an output window that thinks it plays, but does not, is told so and stops', async () => {
    const hub = new Hub();
    const operator = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    const first = output(hub, 'A');
    hub.end().post({ type: 'hello', id: 'A' });
    await vi.advanceTimersByTimeAsync(0);
    const stray = output(hub, 'B');
    hub.end().post({ type: 'primary', id: 'B', from: null }); // as an earlier presenting window told it

    await vi.advanceTimersByTimeAsync(ALIVE_MS);

    expect(stray.player.playing).toBe(false);
    expect(first.player.playing).toBe(true);
    expect(operator.playback.primaryOutput()).toBe('A');
  });
});

describe('driving what plays in the primary output', () => {
  it('sends a command to the primary output’s player', async () => {
    const hub = new Hub();
    const operator = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    const first = output(hub, 'A');
    hub.end().post({ type: 'hello', id: 'A' });
    await vi.advanceTimersByTimeAsync(0);

    operator.playback.video.command({ action: 'pause', itemId: 'V' });
    await vi.advanceTimersByTimeAsync(0);

    expect(first.player.commands).toEqual([{ kind: 'video', command: { action: 'pause', itemId: 'V' } }]);
    expect(operator.player.commands).toEqual([]);
  });

  it('shows the primary output’s video where it is now: its report moved on by the time since', async () => {
    const hub = new Hub();
    const operator = presenting(hub);
    await vi.advanceTimersByTimeAsync(ROLL_MS);
    const first = output(hub, 'A');
    hub.end().post({ type: 'hello', id: 'A' });
    await vi.advanceTimersByTimeAsync(0);
    first.player.position = 10;
    first.player.notify();
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(2500);

    expect(operator.playback.video.state()?.position).toBeCloseTo(12.5);
  });
});
