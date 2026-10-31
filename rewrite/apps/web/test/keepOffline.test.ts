import { describe, expect, it } from 'vitest';
import { videosToDrop, type KeptVideo } from '@gp/sync/client';
import { keptByComing } from '../src/ui/KeepOffline.tsx';
import { formatBytes } from '../src/pages/Storage.tsx';

// Keeping presentations offline (TODO.md "Video, and which files a device fetches").

const file = (hash: string, size: number, usedAt: number, received = size): KeptVideo => ({ hash, size, received, usedAt });

describe('which kept videos go', () => {
  it('never drops a video a presentation kept offline needs, whatever the budget', () => {
    expect(videosToDrop([file('a', 100, 1)], new Set(['a']), 0)).toEqual([]);
  });

  it('keeps the videos nothing keeps any more as cache, while they fit in the room left', () => {
    expect(videosToDrop([file('a', 100, 1), file('b', 100, 2)], new Set(), 200)).toEqual([]);
  });

  it('drops the oldest cached videos first until the rest fits', () => {
    expect(videosToDrop([file('new', 100, 3), file('old', 100, 1), file('mid', 100, 2)], new Set(), 150)).toEqual(['old', 'mid']);
  });

  it('drops a part of a video nothing keeps at once', () => {
    expect(videosToDrop([file('half', 100, 1, 50)], new Set(), 1000)).toEqual(['half']);
  });
});

describe('the coming days the setting keeps offline', () => {
  const p = (eventDate: string | null, over: { isTemplate?: boolean; deletedAt?: number | null } = {}) => ({ eventDate, isTemplate: false, deletedAt: null, ...over });

  it('keeps today and the seven days after, when the setting is on', () => {
    expect(keptByComing(p('2026-11-01'), true, '2026-11-01')).toBe(true);
    expect(keptByComing(p('2026-11-08'), true, '2026-11-01')).toBe(true);
  });

  it('keeps nothing later, earlier, undated, a template, or while the setting is off', () => {
    expect(keptByComing(p('2026-11-09'), true, '2026-11-01')).toBe(false);
    expect(keptByComing(p('2026-10-31'), true, '2026-11-01')).toBe(false);
    expect(keptByComing(p(null), true, '2026-11-01')).toBe(false);
    expect(keptByComing(p('2026-11-02', { isTemplate: true }), true, '2026-11-01')).toBe(false);
    expect(keptByComing(p('2026-11-02'), false, '2026-11-01')).toBe(false);
  });
});

describe('sizes on the storage page', () => {
  it('reads as a Swede writes them, decimal units with a comma', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(12_345)).toBe('12 kB');
    expect(formatBytes(1_250_000)).toBe('1,3 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2,1 GB');
  });
});
