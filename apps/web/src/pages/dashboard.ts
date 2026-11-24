// The start page's dates (spec 03 screen 1), apart from the page so they can be tested; its lists are the core's
// (`startPageView`, db/views.ts), the same for every shell.
import { locale, t } from '../i18n.ts';

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
  const parts = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).formatToParts(dateOf(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return [part('weekday').replace(/\.$/, ''), part('day'), part('month'), withYear ? part('year') : ''].filter(Boolean).join(' ');
}

/** "måndag 4 maj 2026", for the tooltip; without the year in Kommande, as the row (PresentationRow.razor). */
export function fullDate(iso: string, withYear = true): string {
  return dateOf(iso).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
}

/** A row's date: "Idag", "Imorgon", or the short date (Components/Presentations/PresentationRow.razor). */
export function dateLabel(date: string, today: string, withYear: boolean): string {
  if (date === today) return t('presentations.today');
  if (date === addDays(today, 1)) return t('presentations.tomorrow');
  return shortDate(date, withYear);
}
