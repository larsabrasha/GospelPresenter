import { afterEach, describe, expect, it, vi } from 'vitest';

// The presenting window's sound (live/audio.ts) on an element made here: Node has no <audio>.
class FakeAudio {
  src = '';
  currentTime = 0;
  duration = 60;
  paused = true;
  volume = 1;
  muted = false;
  preload = '';
  addEventListener() {}
  pause() {
    this.paused = true;
  }
  async play() {
    this.paused = false;
  }
}
const listening = new Set<string>();
vi.stubGlobal('Audio', FakeAudio);
vi.stubGlobal('addEventListener', (type: string) => listening.add(type));
vi.stubGlobal('removeEventListener', (type: string) => listening.delete(type));
const { AudioEngine } = await import('../src/live/audio.ts');

afterEach(() => vi.useRealTimers());

describe('an audio item whose file is not on the device yet', () => {
  it('plays once the file is there, while the item is still live: it is asked for again', async () => {
    vi.useFakeTimers();
    let here = false;
    const engine = new AudioEngine(async (itemId) => (here ? `blob:${itemId}` : null));

    await engine.show('A1');
    here = true;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(engine.state()).toMatchObject({ itemId: 'A1', playing: true });
  });
});

describe('an audio engine let go of', () => {
  it("takes away what it listens for on the window, so a preview left behind keeps nothing", () => {
    const engine = new AudioEngine(async () => null);

    engine.dispose();

    expect([...listening]).toEqual([]);
  });
});
