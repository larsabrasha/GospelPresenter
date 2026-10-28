import { and, asc, count, eq, isNull, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import { labelDefaults, labelId } from '../labels.ts';
import { labels, songArrangements, songParts, songs } from '../schema.ts';
import { parsePartIds } from '../slides.ts';
import { id, LIMITS, limit, MutationError, name, optionalText, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ songs

export const createSongArgs = z.object({ id, name, author: optionalText(200).optional() });
export async function createSong(tx: Tx, a: z.output<typeof createSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [n] = await tx.select({ n: count() }).from(songs).where(isNull(songs.deletedAt));
  limit((n?.n ?? 0) >= LIMITS.songs, 'songs');
  await tx
    .insert(songs)
    .values({ id: a.id, name: a.name, author: a.author ?? null })
    .onConflictDoNothing();
}

export const updateSongArgs = z.object({
  id,
  name: name.optional(),
  author: optionalText(200).optional(),
  publisher: optionalText(200).optional(),
  year: z.number().int().min(0).max(9999).nullable().optional(),
  ccli: optionalText(20).optional(),
});
export async function updateSong(tx: Tx, a: z.output<typeof updateSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const { id: songId, ...fields } = a;
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) await tx.update(songs).set(set).where(eq(songs.id, songId));
}

export const trashSongArgs = z.object({ id, at: z.number().int() });
export async function trashSong(tx: Tx, a: z.output<typeof trashSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.update(songs).set({ deletedAt: a.at }).where(eq(songs.id, a.id));
}

export const restoreSongArgs = z.object({ id });
export async function restoreSong(tx: Tx, a: z.output<typeof restoreSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.update(songs).set({ deletedAt: null }).where(eq(songs.id, a.id));
}

/** Deletes a song with its parts and arrangements. Presentation items that use it stay, and say the song is gone. */
export async function deleteSongRows(tx: Tx, songId: string) {
  await tx.delete(songArrangements).where(eq(songArrangements.songId, songId));
  await tx.delete(songParts).where(eq(songParts.songId, songId));
  await tx.delete(songs).where(eq(songs.id, songId));
}

export const purgeSongArgs = z.object({ id });
/** Permanent delete (SONG-R27, D14): only of a song that is in the trash where this runs. */
export async function purgeSong(tx: Tx, a: z.output<typeof purgeSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [s] = await tx.select({ deletedAt: songs.deletedAt }).from(songs).where(eq(songs.id, a.id));
  if (!s) return; // already gone: nothing to do
  if (s.deletedAt === null) throw new MutationError('not-in-trash', 'song is not in the trash');
  await deleteSongRows(tx, a.id);
}

/** Makes sure the label exists; its id comes from the text, so duplicates converge. */
async function ensureLabel(tx: Tx, text: string | null | undefined): Promise<string | null> {
  if (!text?.trim()) return null;
  const lid = labelId(text);
  await tx
    .insert(labels)
    .values({ id: lid, text: text.trim(), ...labelDefaults(text) })
    .onConflictDoNothing();
  return lid;
}

export async function partIdsInOrder(tx: Tx, songId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: songParts.id })
    .from(songParts)
    .where(eq(songParts.songId, songId))
    .orderBy(asc(songParts.sort), asc(songParts.id));
  return rows.map((r) => r.id);
}

/** Writes 0..n-1 as the sort of the given part ids, touching only rows that change. */
async function renumberParts(tx: Tx, order: string[]) {
  for (const [i, partId] of order.entries()) {
    await tx
      .update(songParts)
      .set({ sort: i })
      .where(and(eq(songParts.id, partId), ne(songParts.sort, i)));
  }
}

const partContent = z.string().max(5000);
const labelText = z.string().trim().max(50).nullable();

export const addSongPartArgs = z.object({ id, songId: id, labelText, content: partContent });
/** Appends a part to a song. */
export async function addSongPart(tx: Tx, a: z.output<typeof addSongPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [s] = await tx.select({ id: songs.id }).from(songs).where(eq(songs.id, a.songId));
  if (!s) throw new MutationError('not-found', 'song not found');
  const [n] = await tx.select({ n: count() }).from(songParts).where(eq(songParts.songId, a.songId));
  limit((n?.n ?? 0) >= LIMITS.partsPerSong, 'parts');
  const [top] = await tx.select({ last: max(songParts.sort) }).from(songParts).where(eq(songParts.songId, a.songId));
  await tx
    .insert(songParts)
    .values({
      id: a.id,
      songId: a.songId,
      sort: (top?.last ?? -1) + 1,
      labelId: await ensureLabel(tx, a.labelText),
      content: a.content,
    })
    .onConflictDoNothing();
}

export const updateSongPartArgs = z.object({ id, content: partContent.optional(), labelText: labelText.optional() });
export async function updateSongPart(tx: Tx, a: z.output<typeof updateSongPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const set: { content?: string; labelId?: string | null } = {};
  if (a.content !== undefined) set.content = a.content;
  if (a.labelText !== undefined) set.labelId = await ensureLabel(tx, a.labelText);
  if (Object.keys(set).length) await tx.update(songParts).set(set).where(eq(songParts.id, a.id));
}

export const removeSongPartArgs = z.object({ id });
/**
 * Deletes exactly the named part, closes the gap, and takes every occurrence
 * of it out of the song's arrangements (SONG-R14; all of them, 02 Q7). A
 * no-op if it is already gone.
 */
export async function removeSongPart(tx: Tx, a: z.output<typeof removeSongPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [p] = await tx.select({ songId: songParts.songId }).from(songParts).where(eq(songParts.id, a.id));
  if (!p) return;
  await tx.delete(songParts).where(eq(songParts.id, a.id));
  await renumberParts(tx, await partIdsInOrder(tx, p.songId));
  const arrangements = await tx
    .select({ id: songArrangements.id, partIds: songArrangements.partIds })
    .from(songArrangements)
    .where(eq(songArrangements.songId, p.songId));
  for (const arr of arrangements) {
    const ids = parsePartIds(arr.partIds);
    if (ids.includes(a.id)) {
      await tx
        .update(songArrangements)
        .set({ partIds: JSON.stringify(ids.filter((x) => x !== a.id)) })
        .where(eq(songArrangements.id, arr.id));
    }
  }
}

export const moveSongPartArgs = z.object({ id, toIndex: z.number().int().min(0) });
/** Moves a part to an index among the song's parts as they are where this runs. */
export async function moveSongPart(tx: Tx, a: z.output<typeof moveSongPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [p] = await tx.select({ songId: songParts.songId }).from(songParts).where(eq(songParts.id, a.id));
  if (!p) return;
  const order = (await partIdsInOrder(tx, p.songId)).filter((x) => x !== a.id);
  order.splice(Math.min(a.toIndex, order.length), 0, a.id);
  await renumberParts(tx, order);
}
