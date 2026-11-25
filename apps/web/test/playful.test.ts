// Lekfullt läge (ui/playful.ts): the jokes in place of the plain texts, only while it is on, on this device.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal('window', new EventTarget());

const { fun, funPick, loadingText, playful, setPlayful, PLAYFUL_PAUSED } = await import('../src/ui/playful.ts');
/** The tests of it turned on, while it is paused (PLAYFUL_PAUSED): left out, kept for when it comes back. */
const whileOn = it.skipIf(PLAYFUL_PAUSED);

describe('Lekfullt läge', () => {
  beforeEach(() => store.clear());

  it('is off until it is turned on', () => {
    expect(playful()).toBe(false);
  });

  it('gives the plain text while off', () => {
    expect([fun('Offline', 'Ingen täckning i kryptan'), loadingText()]).toEqual(['Offline', 'Laddar...']);
  });

  whileOn('gives the joke while on', () => {
    setPlayful(true);

    expect(fun('Offline', 'Ingen täckning i kryptan')).toBe('Ingen täckning i kryptan');
  });

  whileOn('waits in a church way while on', () => {
    setPlayful(true);

    expect(['Stämmer gitarren...', 'Letar efter psalmboken...', 'Räknar kollekten...', 'Värmer upp kören...']).toContain(loadingText());
  });

  it('picks the plain text among several jokes while off', () => {
    expect(funPick('Synkad', ['I harmoni', 'Samstämd'])).toBe('Synkad');
  });

  whileOn('picks one of the jokes while on', () => {
    setPlayful(true);

    expect(['I harmoni', 'Samstämd']).toContain(funPick('Synkad', ['I harmoni', 'Samstämd']));
  });

  whileOn('keeps the same joke for ten seconds', () => {
    setPlayful(true);
    vi.useFakeTimers({ now: 20_000 });

    const first = funPick('Synkad', ['I harmoni', 'Samstämd', 'Alla på samma vers']);
    vi.setSystemTime(29_999);
    const later = funPick('Synkad', ['I harmoni', 'Samstämd', 'Alla på samma vers']);
    vi.useRealTimers();

    expect(later).toBe(first);
  });

  it.runIf(PLAYFUL_PAUSED)('stays off while paused, turned on or not', () => {
    setPlayful(true);

    expect([playful(), fun('Offline', 'Ingen täckning i kryptan')]).toEqual([false, 'Offline']);
  });

  it('is off again once turned off', () => {
    setPlayful(true);

    setPlayful(false);

    expect(playful()).toBe(false);
  });
});
