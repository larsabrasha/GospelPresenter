// The start page's dates and lists (spec 03 screen 1), apart from the page so they can be tested.
import type { Presentation } from '@gp/core';
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

/** "måndag 4 maj 2026", for the tooltip. */
export function fullDate(iso: string): string {
  return dateOf(iso).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The start page's three lists (spec 03 screen 1): today, upcoming (soonest
 * first), and the rest, past and undated. The rest is newest date first, as
 * a presentation has no time it was last changed.
 */
export function groupPresentations(all: Presentation[], today: string): { today: Presentation[]; upcoming: Presentation[]; rest: Presentation[] } {
  const byName = (a: Presentation, b: Presentation) => a.name.localeCompare(b.name, 'sv');
  return {
    today: all.filter((p) => p.eventDate === today).toSorted(byName),
    upcoming: all.filter((p) => p.eventDate !== null && p.eventDate > today).toSorted((a, b) => a.eventDate!.localeCompare(b.eventDate!) || byName(a, b)),
    rest: all
      .filter((p) => p.eventDate === null || p.eventDate < today)
      .toSorted((a, b) => (a.eventDate === null ? 1 : 0) - (b.eventDate === null ? 1 : 0) || (b.eventDate ?? '').localeCompare(a.eventDate ?? '') || byName(a, b)),
  };
}

/** A row's date: "Idag", "Imorgon", or the short date (Components/Presentations/PresentationRow.razor). */
export function dateLabel(date: string, today: string, withYear: boolean): string {
  if (date === today) return t('presentations.today');
  if (date === addDays(today, 1)) return t('presentations.tomorrow');
  return shortDate(date, withYear);
}
