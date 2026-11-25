// Lekfullt läge (Lars, 2026-11-25): small jokes here and there in the app, for whoever turns it on under Mina
// inställningar, on this device only (as Språk, in the browser's storage). Never on an output: a joke is the operator's,
// the church on the screens sees the service.
import { useSyncExternalStore } from 'react';
import { t } from '../i18n.ts';

const KEY = 'gp.playful';
const CHANGED = 'gp-playful';

/** Whether Lekfullt läge is on on this device. */
export function playful(): boolean {
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
 * "Laddar...", or while Lekfullt läge is on one of a few things a church does while it waits: the same one for ten
 * seconds, so a page that draws again does not change it under the eye.
 */
export function loadingText(): string {
  if (!playful()) return t('common.loading');
  const jokes = [t('fun.loading1'), t('fun.loading2'), t('fun.loading3'), t('fun.loading4')];
  return jokes[Math.floor(Date.now() / 10_000) % jokes.length]!;
}
