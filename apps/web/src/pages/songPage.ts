import type { Song } from '@gp/core';
import { useEffect, useEffectEvent } from 'react';
import { replaceRoute, type Route } from '../ui/router.ts';

/** Puts `to` in place of this page once what it shows is `gone`, here or on another device. */
export function useGoneTo(gone: boolean, to: Route): void {
  const leave = useEffectEvent(() => replaceRoute(to));
  useEffect(() => {
    if (gone) leave();
  }, [gone]);
}

/**
 * Whether a page pushed in from a song's page (Historik, Arrangemang, Noter och länkar) has lost its song, gone or in
 * the trash; the list then takes its place.
 */
export function useGoneSong(loaded: boolean, song: Song | null | undefined): boolean {
  const missing = loaded && (!song || song.deletedAt !== null);
  useGoneTo(missing, { page: 'songs' });
  return missing;
}
