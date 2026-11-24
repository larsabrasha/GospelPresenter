import type { CustomPage } from '@gp/core';
import type { ReadDb } from './share.ts';

// Custom slides (docs/custom-slides.md): the library's rows, and their pages with the pictures they draw found.

export interface LibraryCustomSlide {
  id: string;
  name: string;
  pages: CustomPage[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** The library, by name, without the trash (customSlidesView); pages that do not read are one blank page. */
export const listCustomSlides = (db: ReadDb): Promise<LibraryCustomSlide[]> => db.view<LibraryCustomSlide[]>('customSlidesView', {});

/** A slide by id, trashed or not: a trashed one still shows where a presentation uses it (customSlideView). */
export const getCustomSlide = (db: ReadDb, id: string): Promise<LibraryCustomSlide | null> => db.view<LibraryCustomSlide | null>('customSlideView', { id });
