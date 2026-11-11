import { parseCustomPages, type CustomPage } from '@gp/core';
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

const customSlide = (r: Record<string, unknown>): LibraryCustomSlide => ({
  id: String(r.id),
  name: String(r.name),
  pages: parseCustomPages(r.pages as string | null),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  deletedAt: (r.deleted_at as number | null) ?? null,
});

/** The library, by name, without the trash. */
export async function listCustomSlides(db: ReadDb): Promise<LibraryCustomSlide[]> {
  return (await db.query('SELECT * FROM custom_slides WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id')).map(customSlide);
}

/** A slide by id, trashed or not: a trashed one still shows where a presentation uses it. */
export async function getCustomSlide(db: ReadDb, id: string): Promise<LibraryCustomSlide | null> {
  const [r] = await db.query('SELECT * FROM custom_slides WHERE id = ?', [id]);
  return r ? customSlide(r) : null;
}
