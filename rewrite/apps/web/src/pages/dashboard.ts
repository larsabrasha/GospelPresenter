// The start page's dates and lists (spec 03 screen 1), apart from the page so they can be tested.
import type { Presentation } from '@gp/core';
import { byLastChanged } from '../db/queries.ts';
import { t } from '../i18n.ts';

/** Today's date on this device, `YYYY-MM-DD`, as event dates are stored. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function dateOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function addDays(iso: string, days: number): string {
  const d = dateOf(iso);
  d.setDate(d.getDate() + days);
  return localToday(d);
}

/** "mån 4 maj", with the year when asked: the current app's "ddd d MMMM [yyyy]". */
function shortDate(iso: string, withYear: boolean): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).formatToParts(dateOf(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return [part('weekday').replace(/\.$/, ''), part('day'), part('month'), withYear ? part('year') : ''].filter(Boolean).join(' ');
}

/** "måndag 4 maj 2026", for the tooltip; without the year in Kommande, as the row (PresentationRow.razor). */
export function fullDate(iso: string, withYear = true): string {
  return dateOf(iso).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
}

/**
 * The start page's three lists (spec 03 screen 1, PresentationService.cs):
 * today by time (no time last), upcoming soonest first, and the rest, past and
 * undated alike, last changed first.
 */
export function groupPresentations(all: Presentation[], today: string): { today: Presentation[]; upcoming: Presentation[]; rest: Presentation[] } {
  const byTime = (a: Presentation, b: Presentation) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99');
  const byId = (a: Presentation, b: Presentation) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    today: all.filter((p) => p.eventDate === today).toSorted((a, b) => byTime(a, b) || byLastChanged(a, b) || byId(a, b)),
    upcoming: all.filter((p) => p.eventDate !== null && p.eventDate > today).toSorted((a, b) => a.eventDate!.localeCompare(b.eventDate!) || byTime(a, b) || byId(a, b)),
    // Id last, so the order is total (two saved in the same tick would otherwise swap).
    rest: all.filter((p) => p.eventDate === null || p.eventDate < today).toSorted((a, b) => byLastChanged(a, b) || byId(a, b)),
  };
}

/** A row's date: "Idag", "Imorgon", or the short date (Components/Presentations/PresentationRow.razor). */
export function dateLabel(date: string, today: string, withYear: boolean): string {
  if (date === today) return t('presentations.today');
  if (date === addDays(today, 1)) return t('presentations.tomorrow');
  return shortDate(date, withYear);
}
