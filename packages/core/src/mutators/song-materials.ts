import { count, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { AUDIO_TYPES, MEDIA_HASH, MEDIA_LIMITS } from '../media.ts';
import { mediaBlobs, songMaterials, songs } from '../schema.ts';
import { id, limit, MutationError, name, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ sheet music and links on a song (spec 02 "Song material")

/** How many pieces of material a song may have. */
const MATERIALS_PER_SONG = 30;

/** A link: http or https only, with a host and no spaces, so a link can never run script where it is opened. */
const webAddress = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https?:\/\/[^\s/?#]+[^\s]*$/i, 'not a web address');

/** The song, if it is there, and the next place after its material. */
async function nextPlace(tx: Tx, songId: string): Promise<number> {
  const [s] = await tx.select({ id: songs.id }).from(songs).where(eq(songs.id, songId));
  if (!s) throw new MutationError('not-found', 'song not found');
  const [n] = await tx.select({ n: count(), last: max(songMaterials.sort) }).from(songMaterials).where(eq(songMaterials.songId, songId));
  limit((n?.n ?? 0) >= MATERIALS_PER_SONG, 'pieces of material');
  return (n?.last ?? -1) + 1;
}

export const addSongFileArgs = z.object({
  id,
  songId: id,
  title: name,
  hash: z.string().regex(MEDIA_HASH),
  /** As the server recognised it when the file was uploaded: sheet music, or a recording to practise with. */
  contentType: z.enum(['application/pdf', ...AUDIO_TYPES]),
  size: z.number().int().min(1).max(Math.max(MEDIA_LIMITS.pdfBytes, MEDIA_LIMITS.audioBytes)),
  createdAt: z.number().int(),
});
/** Adds a file, a PDF of sheet music or a recording, after the song's other material: its blob must be known where this runs. */
export async function addSongFile(tx: Tx, a: z.output<typeof addSongFileArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [existing] = await tx.select({ id: songMaterials.id }).from(songMaterials).where(eq(songMaterials.id, a.id));
  if (existing) return;
  const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, a.hash));
  if (!blob) throw new MutationError('media-missing', 'the file has not been uploaded');
  const sort = await nextPlace(tx, a.songId);
  await tx.insert(songMaterials).values({ id: a.id, songId: a.songId, kind: 'file', title: a.title, url: null, hash: a.hash, contentType: a.contentType, size: a.size, sort, createdAt: a.createdAt });
}

export const addSongLinkArgs = z.object({ id, songId: id, title: name, url: webAddress, createdAt: z.number().int() });
/** Adds a link (Spotify, YouTube or any web address) after the song's other material. */
export async function addSongLink(tx: Tx, a: z.output<typeof addSongLinkArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [existing] = await tx.select({ id: songMaterials.id }).from(songMaterials).where(eq(songMaterials.id, a.id));
  if (existing) return;
  const sort = await nextPlace(tx, a.songId);
  await tx.insert(songMaterials).values({ id: a.id, songId: a.songId, kind: 'link', title: a.title, url: a.url, hash: null, contentType: null, size: null, sort, createdAt: a.createdAt });
}

export const renameSongMaterialArgs = z.object({ id, title: name });
export async function renameSongMaterial(tx: Tx, a: z.output<typeof renameSongMaterialArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.update(songMaterials).set({ title: a.title }).where(eq(songMaterials.id, a.id));
}

export const removeSongMaterialArgs = z.object({ id });
/** Removes a piece of material; a PDF's blob goes when nothing names it any more (ORPHAN_BLOBS_SQL). */
export async function removeSongMaterial(tx: Tx, a: z.output<typeof removeSongMaterialArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.delete(songMaterials).where(eq(songMaterials.id, a.id));
}
