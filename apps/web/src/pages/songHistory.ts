import { DEFAULT_LABEL_COLOR, parseSongSnapshot, type Slide, type SongVersion } from '@gp/core';
import { locale, t } from '../i18n.ts';

// What the history page shows of a version (SongHistory.razor): when it is from, and its parts as slides.

const DAY_MS = 24 * 60 * 60 * 1000;
const clock = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' });

/** Which day a version is from: today, yesterday, or before, in this device's time zone. */
function dayOf(at: number, now: number): 'today' | 'yesterday' | 'before' {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (at >= startOfToday) return 'today';
  if (at >= new Date(startOfToday - DAY_MS / 2).setHours(0, 0, 0, 0)) return 'yesterday';
  return 'before';
}

/** "Idag 14:05", "Igår 09:30", else "3 okt. 2026 14:05", in this device's time zone. */
export function versionTime(at: number, now = Date.now()): string {
  const time = clock.format(at);
  const day = dayOf(at, now);
  if (day === 'today') return t('history.today', { time });
  if (day === 'yesterday') return t('history.yesterday', { time });
  return `${date.format(at)} ${time}`;
}

/** The heading of a version's day in the list: "Idag", "Igår", else "3 okt. 2026". */
export function versionDay(at: number, now = Date.now()): string {
  const day = dayOf(at, now);
  return day === 'today' ? t('history.todayHeading') : day === 'yesterday' ? t('history.yesterdayHeading') : date.format(at);
}

/** A version's time of day, under its day's heading: "14:05". */
export function versionClock(at: number): string {
  return clock.format(at);
}

/** The version's name and author, and a slide per part in order, with its label as it was then. */
export function versionSlides(v: SongVersion): { name: string; author: string | null; slides: Slide[] } {
  const s = parseSongSnapshot(v.data);
  return {
    name: s.name,
    author: s.author,
    slides: s.parts.map((p) => ({
      key: p.id,
      kind: 'song',
      text: p.content,
      verses: null,
      image: null,
      label: p.labelText ? { text: p.labelText, color: p.labelColor ?? DEFAULT_LABEL_COLOR } : null,
      credits: null,
    })),
  };
}
