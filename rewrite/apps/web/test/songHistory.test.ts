import { describe, expect, it } from 'vitest';
import type { SongVersion } from '@gp/core';
import { versionSlides, versionTime } from '../src/pages/songHistory.ts';

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime();

describe('when a version is from', () => {
  const now = at(2026, 10, 31, 15, 0);

  it('says Idag and the time for a version from today', () => {
    expect(versionTime(at(2026, 10, 31, 0, 5), now)).toBe('Idag 00:05');
  });

  it('says Igår and the time for a version from yesterday', () => {
    expect(versionTime(at(2026, 10, 30, 23, 59), now)).toBe('Igår 23:59');
  });

  it('gives the date and the time for an older version', () => {
    expect(versionTime(at(2026, 10, 29, 9, 30), now)).toMatch(/^29 okt\.? 2026 09:30$/);
  });
});

describe("a version's slides", () => {
  const version = (data: unknown): SongVersion => ({ id: 'V', songId: 'S', userId: 'u', createdAt: 0, name: 'Ett', data: JSON.stringify(data) });
  const snapshot = {
    name: 'Ett',
    author: 'A',
    publisher: null,
    year: null,
    ccli: null,
    parts: [
      { id: 'P1', labelId: 'label:verse', labelText: 'Verse', labelColor: '#123456', content: 'Första' },
      { id: 'P2', labelId: null, labelText: null, labelColor: null, content: 'Andra' },
    ],
    arrangements: [],
  };

  it('is one song slide per part, in order, with the label as it was then', () => {
    const { slides } = versionSlides(version(snapshot));

    expect(slides.map((s) => [s.key, s.kind, s.text, s.label])).toEqual([
      ['P1', 'song', 'Första', { text: 'Verse', color: '#123456' }],
      ['P2', 'song', 'Andra', null],
    ]);
  });
});
