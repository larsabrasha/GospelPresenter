import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryVideo } from '@gp/core';

// The presenting window's video (live/video.ts) on elements made here: Node has no <video>.
class FakeVideo {
  src = '';
  currentTime = 0;
  duration = 60;
  paused = true;
  ended = false;
  muted = false;
  preload = '';
  playsInline = false;
  addEventListener() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  pause() {
    this.paused = true;
  }
  async play() {
    this.paused = false;
  }
}
vi.stubGlobal('document', { createElement: () => new FakeVideo(), addEventListener: () => undefined, hidden: false });
const { VideoEngine } = await import('../src/live/video.ts');

const video = (hash: string): LibraryVideo =>
  ({ id: hash, hash, contentType: 'video/mp4', codec: 'h264', duration: 60_000, fileName: `${hash}.mp4`, size: 1, width: 16, height: 9, stillHash: 's', thumbHash: 't', createdAt: 0, deletedAt: null }) as LibraryVideo;

afterEach(() => vi.useRealTimers());

describe('a video item whose file cannot be had for the moment', () => {
  it("shows nothing of the video before it, and plays its own once it can be had: it is asked for again", async () => {
    vi.useFakeTimers();
    let online = true;
    const engine = new VideoEngine(async (hash) => (online ? `blob:${hash}` : null));
    await engine.show({ itemId: 'I1', video: video('first') });
    online = false;

    await engine.show({ itemId: 'I2', video: video('second') });
    const meanwhile = [engine.state()?.hash ?? null, engine.picture()];
    online = true;
    await vi.advanceTimersByTimeAsync(5_000);

    expect([meanwhile, engine.state()?.hash]).toEqual([[null, null], 'second']);
  });
});
