import { describe, expect, it } from 'vitest';
import type { Presentation } from '@gp/core';
import { dateLabel, groupPresentations, localToday } from '../src/pages/dashboard.ts';

const p = (name: string, eventDate: string | null, more: Partial<Presentation> = {}): Presentation => ({
  id: name,
  name,
  eventDate,
  deletedAt: null,
  themeId: null,
  isTemplate: false,
  weekday: null,
  time: null,
  location: null,
  description: null,
  updatedAt: null,
  lastUsedAt: null,
  ...more,
});

describe('the start page', () => {
  it('splits into today by time, upcoming soonest first, and the rest last changed first', () => {
    const all = [
      p('Gammal', '2026-01-04', { updatedAt: 300 }),
      p('Utan datum', null, { updatedAt: 200 }),
      p('Nästa vecka', '2026-11-03'),
      p('Kväll', '2026-10-27', { time: '18:00' }),
      p('Imorgon', '2026-10-28'),
      p('Förmiddag', '2026-10-27', { time: '10:00' }),
      p('Igår', '2026-10-26', { updatedAt: 100 }),
      p('Aldrig ändrad', '2026-10-01'),
    ];
    const g = groupPresentations(all, '2026-10-27');
    expect(g.today.map((x) => x.name)).toEqual(['Förmiddag', 'Kväll']);
    expect(g.upcoming.map((x) => x.name)).toEqual(['Imorgon', 'Nästa vecka']);
    expect(g.rest.map((x) => x.name)).toEqual(['Gammal', 'Utan datum', 'Igår', 'Aldrig ändrad']);
  });

  it('says Idag and Imorgon, else the short date as the current app writes it', () => {
    expect(dateLabel('2026-10-27', '2026-10-27', true)).toBe('Idag');
    expect(dateLabel('2026-10-28', '2026-10-27', false)).toBe('Imorgon');
    expect(dateLabel('2026-05-04', '2026-10-27', true)).toBe('mån 4 maj 2026');
    expect(dateLabel('2026-11-05', '2026-10-27', false)).toBe('tors 5 november');
  });

  it("today is the device's own date, not UTC's", () => {
    expect(localToday(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });
});
