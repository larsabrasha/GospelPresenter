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

/** A date tile's three lines: "sön", "15" and "nov". */
export function tileOf(date: string): { weekday: string; day: string; month: string } {
  const d = dateOf(date);
  const short = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(locale(), o).replace(/\.$/, '');
  return { weekday: short({ weekday: 'short' }), day: String(d.getDate()), month: short({ month: 'short' }) };
}

/** A table cell's date: "27 nov", with the year when it is not today's ("4 maj 2025"). */
export function cellDate(date: string, today: string): string {
  const other = date.slice(0, 4) !== today.slice(0, 4);
  return dateOf(date).toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(other ? { year: 'numeric' } : {}) }).replace('.', '');
}

/** A month's caption, `YYYY-MM`: "November", with the year when it is not today's ("December 2025") or `withYear`. */
export function monthTitle(month: string, today: string, withYear = false): string {
  const year = withYear || month.slice(0, 4) !== today.slice(0, 4);
  const name = dateOf(`${month}-01`).toLocaleDateString(locale(), { month: 'long', ...(year ? { year: 'numeric' } : {}) });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The month `by` months from `month`, `YYYY-MM`. */
export function addMonths(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const n = y! * 12 + (m! - 1) + by;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}

/** A month's calendar, `YYYY-MM`, Monday first: six weeks of dates, `YYYY-MM-DD`, those of other months included. */
export function calendarDays(month: string): string[] {
  const first = dateOf(`${month}-01`);
  const back = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays(`${month}-01`, i - back));
}
