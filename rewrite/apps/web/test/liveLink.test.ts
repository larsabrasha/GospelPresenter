import { afterEach, describe, expect, it, vi } from 'vitest';

// The organisation's live socket (live/remote.ts) on a socket made here, under a clock the test moves.
class FakeSocket extends EventTarget {
  static OPEN = 1;
  static made: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  constructor() {
    super();
    FakeSocket.made.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  answer(m: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(m) }));
  }
}
vi.stubGlobal('WebSocket', FakeSocket);
vi.stubGlobal('location', { origin: 'http://kyrkan.local' });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const { LIVE_PING_MS, LIVE_PONG_MS, LiveLink } = await import('../src/live/remote.ts');

afterEach(() => {
  FakeSocket.made = [];
  vi.useRealTimers();
});

describe('the live socket', () => {
  it('pings while open, and opens again when no answer comes: a router that lost its state, never closed', async () => {
    vi.useFakeTimers();
    const link = new LiveLink([]);
    FakeSocket.made[0]!.open();

    await vi.advanceTimersByTimeAsync(LIVE_PING_MS + LIVE_PONG_MS + 1);
    await vi.advanceTimersByTimeAsync(10_000); // past the reconnect's first wait

    expect([FakeSocket.made[0]!.sent, FakeSocket.made.length]).toEqual([[{ type: 'ping' }], 2]);
    link.close();
  });

  it('stays open while the server answers', async () => {
    vi.useFakeTimers();
    const link = new LiveLink([]);
    const socket = FakeSocket.made[0]!;
    socket.open();

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(LIVE_PING_MS);
      socket.answer({ type: 'pong' });
    }

    expect([FakeSocket.made.length, link.connected]).toEqual([1, true]);
    link.close();
  });
});
