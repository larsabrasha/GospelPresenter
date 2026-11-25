// Lekfullt läge (Lars, 2026-11-25): small jokes here and there in the app, for whoever turns it on under Mina
// inställningar, on this device only (as Språk, in the browser's storage). Never on an output: a joke is the operator's,
// the church on the screens sees the service.
import { useSyncExternalStore } from 'react';
import { t } from '../i18n.ts';

const KEY = 'gp.playful';
const CHANGED = 'gp-playful';

/**
 * Paused (Lars, 2026-11-25: kept, not taken away): off on every device, a switch on or not, and its switch in Mina
 * inställningar not shown. False brings both back as they were.
 */
export const PLAYFUL_PAUSED = true;

/** Whether Lekfullt läge is on on this device. */
export function playful(): boolean {
  if (PLAYFUL_PAUSED) return false;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setPlayful(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: it stays as it was
  }
  window.dispatchEvent(new Event(CHANGED));
}

const subscribe = (fn: () => void) => {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
};

/** Lekfullt läge, read again when it is switched. */
export const usePlayful = () => useSyncExternalStore(subscribe, playful);

/** `joke` in place of `plain` while Lekfullt läge is on. */
export const fun = (plain: string, joke: string) => (playful() ? joke : plain);

/**
 * `plain`, or while Lekfullt läge is on one of `jokes`, as Carrot Weather says a thing a new way each time: the same one
 * for ten seconds, so a page that draws again does not change it under the eye.
 */
export function funPick(plain: string, jokes: readonly string[]): string {
  if (!playful() || !jokes.length) return plain;
  return jokes[Math.floor(Date.now() / 10_000) % jokes.length]!;
}

/** "Laddar...", or one of a few things a church does while it waits. */
export const loadingText = () => funPick(t('common.loading'), [t('fun.loading1'), t('fun.loading2'), t('fun.loading3'), t('fun.loading4')]);

/** "Något gick fel. Försök igen.", or a wrong note. */
export const errorText = () => funPick(t('common.error'), [t('fun.error1'), t('fun.error2')]);

/** "{name} flyttad till papperskorgen" (`plain`), or a word on where it rests now. */
export const trashedText = (plain: string, name: string) => funPick(plain, [t('fun.trashed1', { name }), t('fun.trashed2', { name })]);

/** "Inga sånger hittades", or a song not even the organist knows. */
export const songsNoHitsText = () => funPick(t('songs.noHits'), [t('fun.songsNoHits1'), t('fun.songsNoHits2'), t('fun.songsNoHits3')]);

/** An empty song library's heading. */
export const songsEmptyText = () => funPick(t('songs.emptyTitle'), [t('fun.songsEmpty1'), t('fun.songsEmpty2'), t('fun.songsEmpty3')]);
