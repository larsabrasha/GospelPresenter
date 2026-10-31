import { DEFAULT_LABEL_COLOR, parseSongSnapshot, type Slide, type SongVersion } from '@gp/core';
import { locale, t } from '../i18n.ts';

// What the history page shows of a version (SongHistory.razor): when it is from, and its parts as slides.

const DAY_MS = 24 * 60 * 60 * 1000;
const clock = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' });

/** "Idag 14:05", "Igår 09:30", else "3 okt. 2026 14:05", in this device's time zone. */
export function versionTime(at: number, now = Date.now()): string {
  const time = clock.format(at);
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (at >= startOfToday) return t('history.today', { time });
  if (at >= new Date(startOfToday - DAY_MS / 2).setHours(0, 0, 0, 0)) return t('history.yesterday', { time });
  return `${date.format(at)} ${time}`;
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
