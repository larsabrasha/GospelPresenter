import { count, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { songArrangements, songs } from '../schema.ts';
import { parsePartIds } from '../slides.ts';
import { id, LIMITS, limit, MutationError, optionalText, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { partIdsInOrder } from './songs.ts';

// ------------------------------------------------------------------ arrangements

/** Trimmed; blank is no name (SONG-R16). */
const arrangementName = optionalText(100);
const partIdList = z.array(id).max(500);

/** The ids that are parts of the song, in the given order with repeats (SONG-R15). */
async function ownPartIds(tx: Tx, songId: string, partIds: string[]): Promise<string[]> {
  const own = new Set(await partIdsInOrder(tx, songId));
  return partIds.filter((p) => own.has(p));
}

export const createArrangementArgs = z.object({ id, songId: id, name: arrangementName.optional(), partIds: partIdList });
/** Adds an arrangement after the song's others. */
export async function createArrangement(tx: Tx, a: z.output<typeof createArrangementArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [s] = await tx.select({ id: songs.id }).from(songs).where(eq(songs.id, a.songId));
  if (!s) throw new MutationError('not-found', 'song not found');
  const [n] = await tx.select({ n: count(), last: max(songArrangements.sort) }).from(songArrangements).where(eq(songArrangements.songId, a.songId));
  limit((n?.n ?? 0) >= LIMITS.arrangementsPerSong, 'arrangements');
  await tx
    .insert(songArrangements)
    .values({
      id: a.id,
      songId: a.songId,
      name: a.name ?? null,
      partIds: JSON.stringify(await ownPartIds(tx, a.songId, a.partIds)),
      sort: (n?.last ?? -1) + 1,
    })
    .onConflictDoNothing();
}

export const updateArrangementArgs = z.object({ id, name: arrangementName.optional(), partIds: partIdList.optional() });
/** Sets the name, the part order, or both. The order replaces the whole list. */
export async function updateArrangement(tx: Tx, a: z.output<typeof updateArrangementArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [arr] = await tx.select({ songId: songArrangements.songId }).from(songArrangements).where(eq(songArrangements.id, a.id));
  if (!arr) return; // deleted meanwhile: nothing to edit
  const set: { name?: string | null; partIds?: string } = {};
  if (a.name !== undefined) set.name = a.name;
  if (a.partIds !== undefined) set.partIds = JSON.stringify(await ownPartIds(tx, arr.songId, a.partIds));
  if (Object.keys(set).length) await tx.update(songArrangements).set(set).where(eq(songArrangements.id, a.id));
}

/** The arrangement's song and part ids where this runs, or null if it is gone. */
async function arrangementParts(tx: Tx, arrangementId: string): Promise<{ songId: string; ids: string[] } | null> {
  const [arr] = await tx
    .select({ songId: songArrangements.songId, partIds: songArrangements.partIds })
    .from(songArrangements)
    .where(eq(songArrangements.id, arrangementId));
  return arr ? { songId: arr.songId, ids: parsePartIds(arr.partIds) } : null;
}

/**
 * The index of the chip the user meant: `index` if it still holds `partId`,
 * else the nearest occurrence of `partId`, else -1. Chip edits name both, so
 * an edit made on an older view of the list still hits the right part.
 */
function chipAt(ids: string[], index: number, partId: string): number {
  if (ids[index] === partId) return index;
  let best = -1;
  for (const [i, x] of ids.entries()) if (x === partId && (best === -1 || Math.abs(i - index) < Math.abs(best - index))) best = i;
  return best;
}

async function setArrangementParts(tx: Tx, arrangementId: string, ids: string[]) {
  await tx.update(songArrangements).set({ partIds: JSON.stringify(ids) }).where(eq(songArrangements.id, arrangementId));
}

// The chip edits below change the list as it is where they run, so quick
// edits in a row, and edits from two devices, compose instead of replacing
// each other's list.

export const appendArrangementPartArgs = z.object({ id, partId: id });
/** Appends a part to an arrangement ("Lägg till del"). */
export async function appendArrangementPart(tx: Tx, a: z.output<typeof appendArrangementPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const arr = await arrangementParts(tx, a.id);
  if (!arr) return;
  if (!(await ownPartIds(tx, arr.songId, [a.partId])).length) return; // not (or no longer) a part of the song
  if (arr.ids.length >= 500) throw new MutationError('limit', 'the maximum number of parts in an arrangement has been reached');
  await setArrangementParts(tx, a.id, [...arr.ids, a.partId]);
}

export const removeArrangementPartArgs = z.object({ id, index: z.number().int().min(0), partId: id });
/** Takes one chip out of an arrangement (×). */
export async function removeArrangementPart(tx: Tx, a: z.output<typeof removeArrangementPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const arr = await arrangementParts(tx, a.id);
  if (!arr) return;
  const at = chipAt(arr.ids, a.index, a.partId);
  if (at !== -1) await setArrangementParts(tx, a.id, arr.ids.toSpliced(at, 1));
}

export const moveArrangementPartArgs = z.object({ id, index: z.number().int().min(0), partId: id, by: z.number().int().min(-500).max(500) });
/** Moves one chip `by` places (↑ is -1, ↓ is 1), stopping at the ends. */
export async function moveArrangementPart(tx: Tx, a: z.output<typeof moveArrangementPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const arr = await arrangementParts(tx, a.id);
  if (!arr) return;
  const at = chipAt(arr.ids, a.index, a.partId);
  if (at === -1) return;
  const to = Math.max(0, Math.min(arr.ids.length - 1, at + a.by));
  if (to !== at) await setArrangementParts(tx, a.id, arr.ids.toSpliced(at, 1).toSpliced(to, 0, a.partId));
}

export const removeArrangementArgs = z.object({ id });
/** Deletes exactly the named arrangement. Items that chose it fall back to all parts (SONG-R18). */
export async function removeArrangement(tx: Tx, a: z.output<typeof removeArrangementArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.delete(songArrangements).where(eq(songArrangements.id, a.id));
}
