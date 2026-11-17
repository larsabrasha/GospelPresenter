import type { LibraryImage } from '@gp/core';
import type { ReadDb } from './share.ts';

// The library's pictures (spec 05 "Media"), and an edited one's original (MEDIA-R19).

/** The library, newest first, without the trash (MEDIA-R7), from the core (imagesView). */
export const listImages = (db: ReadDb): Promise<LibraryImage[]> => db.view<LibraryImage[]>('imagesView', {});

