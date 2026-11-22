import type { Action } from '../../db/pageCore.ts';
import type { Route } from '../../ui/router.ts';

/**
 * Where an item's Redigera opens, the same from every menu on a computer and a phone, as the core says
 * (`itemActionsView`'s `opens`): a song's page, alone in Inställningar, or a custom slideshow's editor
 * (docs/custom-slides.md); none where the menu offers no Redigera (not a song, or its song in the trash).
 */
export function editRoute(edit: Action | undefined): Route | undefined {
  const opens = edit?.opens;
  if (!opens || opens.page === 'images') return undefined;
  return opens.page === 'customSlide' ? { page: 'customSlide', id: opens.id } : { page: 'song', id: opens.id };
}
