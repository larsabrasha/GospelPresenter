import { describe, expect, it } from 'vitest';
import type { WatchEvent } from '@gp/core';
import { followStream, type StreamSource } from '../src/live/watch-stream.ts';

class FakeSource implements StreamSource {
  readyState = 0;
  closed = false;
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  fire(type: string, data?: WatchEvent) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

function setup(status: () => number | null) {
  const sources: FakeSource[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const events: WatchEvent[] = [];
  let notFound = 0;
  const stop = followStream(
    '/api/watch/abcdefg/stream?v=0123456789abcdef',
    { event: (e) => events.push(e), notFound: () => notFound++ },
    {
      open: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
      exists: async () => status(),
      later: (fn, ms) => timers.push({ fn, ms }),
    },
  );
  return { sources, timers, events, stop, notFound: () => notFound };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('following a public output', () => {
  it('reconnects itself after the browser gave up on an error answer, with the LIVE-R51 backoff', async () => {
    const t = setup(() => 200);
    const first = t.sources[0]!;
    first.readyState = 2; // a 502: EventSource does not try again
    first.fire('error');
    await tick();
    expect(t.timers.map((x) => x.ms)).toEqual([0]);
    t.timers.shift()!.fn();
    expect(t.sources).toHaveLength(2);
    t.sources[1]!.readyState = 2;
    t.sources[1]!.fire('error');
    await tick();
    expect(t.timers.map((x) => x.ms)).toEqual([2000]);
    // Once it is up again, the next failure starts the backoff over.
    t.timers.shift()!.fn();
    t.sources[2]!.fire('open');
    t.sources[2]!.readyState = 2;
    t.sources[2]!.fire('error');
    await tick();
    expect(t.timers.map((x) => x.ms)).toEqual([0]);
  });

  it('leaves a network error to the browser, which retries by itself', async () => {
    const t = setup(() => null);
    t.sources[0]!.readyState = 0; // connecting again
    t.sources[0]!.fire('error');
    await tick();
    expect(t.timers).toEqual([]);
    expect(t.sources).toHaveLength(1);
    expect(t.sources[0]!.closed).toBe(false);
  });

  it('stops for good when the code does not exist, or no longer does', async () => {
    const t = setup(() => 404);
    t.sources[0]!.fire('error');
    await tick();
    expect(t.notFound()).toBe(1);
    expect(t.sources[0]!.closed).toBe(true);
    expect(t.timers).toEqual([]);
  });

  it('passes events on, and stops when the output is full', () => {
    const t = setup(() => 200);
    t.sources[0]!.fire('slide', { type: 'slide', slide: { kind: 'song', text: 'A', verses: null, image: null, credits: null, themeId: 'classic', overlay: null } });
    t.sources[0]!.fire('full', { type: 'full' });
    expect(t.events.map((e) => e.type)).toEqual(['slide', 'full']);
    expect(t.sources[0]!.closed).toBe(true);
  });
});
