import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CcliEntry, LivePointer } from '@gp/core';
import { CcliCounter, CCLI_SHOWN_MS, localDate } from '../src/live/ccli.ts';
import { ccliCards, matchesFilter } from '../src/pages/ccliReport.ts';

const at = (o: Partial<LivePointer> = {}): LivePointer => ({ presentationId: 'P', itemId: 'I', partIndex: 0, black: false, overlayId: null, rev: 1, ...o });

describe('counting a song shown live', () => {
  let counted: LivePointer[];
  let counter: CcliCounter;
  beforeEach(() => {
    vi.useFakeTimers();
    counted = [];
    counter = new CcliCounter((p) => counted.push(p));
  });
  afterEach(() => vi.useRealTimers());

  it('SONG-R48: counts a slide shown for 10 seconds', () => {
    counter.see(at());

    vi.advanceTimersByTime(CCLI_SHOWN_MS);

    expect(counted).toHaveLength(1);
  });

  it('SONG-A35: does not count a slide left after 5 seconds, and starts over on the next', () => {
    counter.see(at());
    vi.advanceTimersByTime(5_000);

    counter.see(at({ partIndex: 1, rev: 2 }));
    vi.advanceTimersByTime(CCLI_SHOWN_MS - 1);

    expect(counted).toEqual([]);
  });

  it('does not start over when the same slide is sent again or an overlay changes', () => {
    counter.see(at());
    vi.advanceTimersByTime(5_000);

    counter.see(at({ rev: 2, overlayId: 'O' }));
    vi.advanceTimersByTime(5_000);

    expect(counted).toHaveLength(1);
  });

  it('counts nothing on the black screen or with nothing presented', () => {
    counter.see(at({ black: true }));
    vi.advanceTimersByTime(CCLI_SHOWN_MS);
    counter.see(at({ presentationId: null, itemId: null }));
    vi.advanceTimersByTime(CCLI_SHOWN_MS);

    expect(counted).toEqual([]);
  });

  it('counts nothing once stopped', () => {
    counter.see(at());

    counter.stop();
    vi.advanceTimersByTime(CCLI_SHOWN_MS);

    expect(counted).toEqual([]);
  });
});

describe('the day an entry is for', () => {
  it("is this device's own day, YYYY-MM-DD", () => {
    expect(localDate(new Date(2026, 10, 1, 23, 30))).toBe('2026-11-01');
  });
});

describe('the report', () => {
  const entry = (o: Partial<CcliEntry>): CcliEntry => ({ id: 'x', songId: 'S', songName: 'A', ccli: '1', presentationId: 'P', presentationName: 'Gudstjänst', date: '2026-11-01', reportedAt: null, ...o });

  it('gives two presentations of the same name on the same day a card each', () => {
    const cards = ccliCards([entry({ id: '1' }), entry({ id: '2', presentationId: 'P2' }), entry({ id: '3' })]);

    expect(cards.map((c) => c.entries.map((e) => e.id))).toEqual([['1', '3'], ['2']]);
  });

  it('filters reported and unreported entries', () => {
    const reported = entry({ reportedAt: 5 });

    expect([matchesFilter(reported, 'all'), matchesFilter(reported, 'reported'), matchesFilter(reported, 'unreported')]).toEqual([true, true, false]);
  });
});
