import type { PresentationItem, Song } from '@gp/core';
import type { Route } from '../../ui/router.ts';

/**
 * Where an item's Redigera opens its song, the same from every menu on a computer and a phone: the song's page, alone
 * in Inställningar; none for an item that is not a song, or whose song is in the trash.
 */
export function songPage(item: PresentationItem, songs: Map<string, Song>): Route | undefined {
  // A custom slide opens its editor as a song opens its page (docs/custom-slides.md).
  if (item.type === 'custom') return { page: 'customSlide', id: item.sourceId };
  return item.type === 'song' && songs.get(item.sourceId)?.deletedAt === null ? { page: 'song', id: item.sourceId } : undefined;
}
