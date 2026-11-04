import { parseSlideDeckPages, type SlidePage } from '@gp/core';
import type { ReadDb } from './share.ts';

// Slide decks (docs/media-and-files.md "Slide decks"): the library's rows, their pages as rendered at import.

export interface LibrarySlideDeck {
  id: string;
  name: string;
  pages: SlidePage[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

const slideDeck = (r: Record<string, unknown>): LibrarySlideDeck => ({
  id: String(r.id),
  name: String(r.name),
  pages: parseSlideDeckPages(r.pages as string | null),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  deletedAt: (r.deleted_at as number | null) ?? null,
});

/** The library, by name, without the trash. */
export async function listSlideDecks(db: ReadDb): Promise<LibrarySlideDeck[]> {
  return (await db.query('SELECT * FROM slide_decks WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id')).map(slideDeck);
}

/** A deck by id, trashed or not: a trashed one still shows where a presentation uses it. */
export async function getSlideDeck(db: ReadDb, id: string): Promise<LibrarySlideDeck | null> {
  const [r] = await db.query('SELECT * FROM slide_decks WHERE id = ?', [id]);
  return r ? slideDeck(r) : null;
}
