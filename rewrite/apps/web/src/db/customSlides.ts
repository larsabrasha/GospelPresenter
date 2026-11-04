import { customPageImageIds, parseCustomPages, type CustomPage, type ShownPage } from '@gp/core';
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

/** `pages` with the hashes of the pictures they draw, trashed pictures too; a purged one is left out. */
export async function shownPages(db: ReadDb, pages: CustomPage[]): Promise<ShownPage[]> {
  const ids = [...new Set(pages.flatMap(customPageImageIds))];
  const rows = ids.length ? await db.query(`SELECT id, full_hash, thumb_hash FROM images WHERE id IN (${ids.map(() => '?').join(', ')})`, ids) : [];
  const images = Object.fromEntries(rows.map((r) => [String(r.id), { full: String(r.full_hash), thumb: String(r.thumb_hash) }]));
  return pages.map((page) => ({ page, images }));
}
