import type { LibraryImage } from '@gp/core';
import type { ReadDb } from './share.ts';

type Row = Record<string, unknown>;

// The library's pictures (spec 05 "Media"), and an edited one's original (MEDIA-R19).

/** A row of `images` as the page uses it; the trash's list reads them too. */
export const libraryImage = (r: Row): LibraryImage => ({
  id: String(r.id),
  fileName: String(r.file_name),
  contentType: r.content_type === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
  fullHash: String(r.full_hash),
  thumbHash: String(r.thumb_hash),
  width: Number(r.width),
  height: Number(r.height),
  createdAt: Number(r.created_at),
  deletedAt: (r.deleted_at as number | null) ?? null,
  originalFullHash: (r.original_full_hash as string | null) ?? null,
  originalThumbHash: (r.original_thumb_hash as string | null) ?? null,
  originalWidth: (r.original_width as number | null) ?? null,
  originalHeight: (r.original_height as number | null) ?? null,
  edit: (r.edit as string | null) ?? null,
});

/** The library, newest first, without the trash (MEDIA-R7). */
export async function listImages(db: ReadDb): Promise<LibraryImage[]> {
  return (await db.query('SELECT * FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC, id')).map(libraryImage);
}

/** An image by id, trashed or not: a trashed picture still shows in the presentations that use it (MEDIA-R8). */
export async function getImage(db: ReadDb, id: string): Promise<LibraryImage | null> {
  const [r] = await db.query('SELECT * FROM images WHERE id = ?', [id]);
  return r ? libraryImage(r) : null;
}

