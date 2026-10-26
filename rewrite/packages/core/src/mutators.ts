import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, max, ne, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { labelDefaults, labelId } from './labels.ts';
import { can, type Permission, type Role } from './permissions.ts';
import { labels, presentationItems, presentations, songArrangements, songParts, songs } from './schema.ts';
import { parsePartIds } from './slides.ts';
import { TRASH_RETENTION_MS } from './trash.ts';

/**
 * The transaction a mutator runs in. It is a plain Drizzle SQLite database:
 * better-sqlite3, node:sqlite and DO SQLite (sync drivers) on the server,
 * wa-sqlite through sqlite-proxy (async driver) on the client. Every Drizzle
 * query is awaitable on both, so one async mutator body serves all of them.
 * The caller makes the run atomic (see the adapters' `transaction`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = BaseSQLiteDatabase<'sync' | 'async', any, any>;

export interface MutatorCtx {
  userId: string;
  role: Role;
  /**
   * The server's clock when it runs a push; absent on clients. Only used to
   * keep a client's clock from purging the trash early (`purgeExpiredTrash`).
   */
  now?: number;
}

/** Thrown for an expected refusal; the server records `code` and moves on. */
export class MutationError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

function requirePermission(ctx: MutatorCtx, permission: Permission) {
  if (!can(ctx.role, permission)) throw new MutationError('forbidden', `${ctx.role} may not ${permission}`);
}

// Mutators must be deterministic: ids and timestamps arrive as arguments, and
// they read only through `tx`. Each one sets only the fields it names, so two
// edits to different fields both land (ADR 0007, decision 2).

/** Limits of spec 02 and 03 (SONG-R7–R9, PRES-R10). Trashed rows do not count. */
export const LIMITS = { songs: 5000, partsPerSong: 50, arrangementsPerSong: 10, itemsPerPresentation: 100 } as const;

function limit(reached: boolean, what: string) {
  if (reached) throw new MutationError('limit', `the maximum number of ${what} has been reached`);
}

const id = z.string().min(1).max(100);
/** Trimmed and non-blank, as the UI requires (spec 02, 03). */
const name = z.string().trim().min(1).max(200);
/** Optional text: blank is stored as null. */
const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((s) => (s === '' ? null : s))
    .nullable();

// ------------------------------------------------------------------ songs

const createSongArgs = z.object({ id, name, author: optionalText(200).optional() });
async function createSong(tx: Tx, a: z.output<typeof createSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [n] = await tx.select({ n: count() }).from(songs).where(isNull(songs.deletedAt));
  limit((n?.n ?? 0) >= LIMITS.songs, 'songs');
  await tx
    .insert(songs)
    .values({ id: a.id, name: a.name, author: a.author ?? null })
    .onConflictDoNothing();
}

const updateSongArgs = z.object({
  id,
  name: name.optional(),
  author: optionalText(200).optional(),
  publisher: optionalText(200).optional(),
  year: z.number().int().min(0).max(9999).nullable().optional(),
  ccli: optionalText(20).optional(),
});
async function updateSong(tx: Tx, a: z.output<typeof updateSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const { id: songId, ...fields } = a;
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) await tx.update(songs).set(set).where(eq(songs.id, songId));
}

const trashSongArgs = z.object({ id, at: z.number().int() });
async function trashSong(tx: Tx, a: z.output<typeof trashSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.update(songs).set({ deletedAt: a.at }).where(eq(songs.id, a.id));
}

const restoreSongArgs = z.object({ id });
async function restoreSong(tx: Tx, a: z.output<typeof restoreSongArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.update(songs).set({ deletedAt: null }).where(eq(songs.id, a.id));
}

/** Deletes a song with its parts and arrangements. Presentation items that use it stay, and say the song is gone. */
async function deleteSongRows(tx: Tx, songId: string) {
  await tx.delete(songArrangements).where(eq(songArrangements.songId, songId));
  await tx.delete(songParts).where(eq(songParts.songId, songId));
  await tx.delete(songs).where(eq(songs.id, songId));
}

const purgeSongArgs = z.object({ id });
/** Permanent delete (SONG-R27, D14): only of a song that is in the trash where this runs. */
async function purgeSong(tx: Tx, a: z.output<typeof purgeSongArgs>, ctx: MutatorCtx) {
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

async function partIdsInOrder(tx: Tx, songId: string): Promise<string[]> {
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

const addSongPartArgs = z.object({ id, songId: id, labelText, content: partContent });
/** Appends a part to a song. */
async function addSongPart(tx: Tx, a: z.output<typeof addSongPartArgs>, ctx: MutatorCtx) {
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

const updateSongPartArgs = z.object({ id, content: partContent.optional(), labelText: labelText.optional() });
async function updateSongPart(tx: Tx, a: z.output<typeof updateSongPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const set: { content?: string; labelId?: string | null } = {};
  if (a.content !== undefined) set.content = a.content;
  if (a.labelText !== undefined) set.labelId = await ensureLabel(tx, a.labelText);
  if (Object.keys(set).length) await tx.update(songParts).set(set).where(eq(songParts.id, a.id));
}

const removeSongPartArgs = z.object({ id });
/**
 * Deletes exactly the named part, closes the gap, and takes every occurrence
 * of it out of the song's arrangements (SONG-R14; all of them, 02 Q7). A
 * no-op if it is already gone.
 */
async function removeSongPart(tx: Tx, a: z.output<typeof removeSongPartArgs>, ctx: MutatorCtx) {
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

const moveSongPartArgs = z.object({ id, toIndex: z.number().int().min(0) });
/** Moves a part to an index among the song's parts as they are where this runs. */
async function moveSongPart(tx: Tx, a: z.output<typeof moveSongPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [p] = await tx.select({ songId: songParts.songId }).from(songParts).where(eq(songParts.id, a.id));
  if (!p) return;
  const order = (await partIdsInOrder(tx, p.songId)).filter((x) => x !== a.id);
  order.splice(Math.min(a.toIndex, order.length), 0, a.id);
  await renumberParts(tx, order);
}

// ------------------------------------------------------------------ arrangements

/** Trimmed; blank is no name (SONG-R16). */
const arrangementName = optionalText(100);
const partIdList = z.array(id).max(500);

/** The ids that are parts of the song, in the given order with repeats (SONG-R15). */
async function ownPartIds(tx: Tx, songId: string, partIds: string[]): Promise<string[]> {
  const own = new Set(await partIdsInOrder(tx, songId));
  return partIds.filter((p) => own.has(p));
}

const createArrangementArgs = z.object({ id, songId: id, name: arrangementName.optional(), partIds: partIdList });
/** Adds an arrangement after the song's others. */
async function createArrangement(tx: Tx, a: z.output<typeof createArrangementArgs>, ctx: MutatorCtx) {
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

const updateArrangementArgs = z.object({ id, name: arrangementName.optional(), partIds: partIdList.optional() });
/** Sets the name, the part order, or both. The order replaces the whole list. */
async function updateArrangement(tx: Tx, a: z.output<typeof updateArrangementArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [arr] = await tx.select({ songId: songArrangements.songId }).from(songArrangements).where(eq(songArrangements.id, a.id));
  if (!arr) return; // deleted meanwhile: nothing to edit
  const set: { name?: string | null; partIds?: string } = {};
  if (a.name !== undefined) set.name = a.name;
  if (a.partIds !== undefined) set.partIds = JSON.stringify(await ownPartIds(tx, arr.songId, a.partIds));
  if (Object.keys(set).length) await tx.update(songArrangements).set(set).where(eq(songArrangements.id, a.id));
}

const removeArrangementArgs = z.object({ id });
/** Deletes exactly the named arrangement. Items that chose it fall back to all parts (SONG-R18). */
async function removeArrangement(tx: Tx, a: z.output<typeof removeArrangementArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.delete(songArrangements).where(eq(songArrangements.id, a.id));
}

// ------------------------------------------------------------------ presentations

const createPresentationArgs = z.object({ id, name, eventDate: z.iso.date().nullable().optional() });
async function createPresentation(tx: Tx, a: z.output<typeof createPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx
    .insert(presentations)
    .values({ id: a.id, name: a.name, eventDate: a.eventDate ?? null })
    .onConflictDoNothing();
}

const renamePresentationArgs = z.object({ id, name });
async function renamePresentation(tx: Tx, a: z.output<typeof renamePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.update(presentations).set({ name: a.name }).where(eq(presentations.id, a.id));
}

const updatePresentationArgs = z.object({ id, name: name.optional(), eventDate: z.iso.date().nullable().optional() });
/** The details dialog (spec 03, "Redigera detaljer"): sets the fields it names; a null date clears it. */
async function updatePresentation(tx: Tx, a: z.output<typeof updatePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const { id: presentationId, ...fields } = a;
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) await tx.update(presentations).set(set).where(eq(presentations.id, presentationId));
}

/** The arrangement if it is one of the song's, else null: the item then shows the song's default. */
async function ownArrangement(tx: Tx, songId: string, arrangementId: string | null | undefined): Promise<string | null> {
  if (!arrangementId) return null;
  const [arr] = await tx
    .select({ id: songArrangements.id })
    .from(songArrangements)
    .where(and(eq(songArrangements.id, arrangementId), eq(songArrangements.songId, songId)));
  return arr ? arr.id : null;
}

const addSongToPresentationArgs = z.object({
  itemId: id,
  presentationId: id,
  songId: id,
  arrangementId: id.nullable().optional(),
  /** Insert right after this item (spec 03 2d); appended when absent or gone. */
  afterItemId: id.nullable().optional(),
});
/**
 * Adds a song item. The title is the song's name at add time (spec 03). An
 * arrangement that is no longer the song's is dropped rather than refusing
 * the add, so the item survives a concurrent arrangement delete.
 */
async function addSongToPresentation(tx: Tx, a: z.output<typeof addSongToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [p] = await tx.select({ id: presentations.id }).from(presentations).where(eq(presentations.id, a.presentationId));
  if (!p) throw new MutationError('not-found', 'presentation not found');
  const [s] = await tx.select({ name: songs.name }).from(songs).where(eq(songs.id, a.songId));
  if (!s) throw new MutationError('not-found', 'song not found');
  const [existing] = await tx.select({ id: presentationItems.id }).from(presentationItems).where(eq(presentationItems.id, a.itemId));
  if (existing) return; // a replay of an add that already landed
  const [n] = await tx
    .select({ n: count(), last: max(presentationItems.sort) })
    .from(presentationItems)
    .where(eq(presentationItems.presentationId, a.presentationId));
  limit((n?.n ?? 0) >= LIMITS.itemsPerPresentation, 'items');
  let sort = (n?.last ?? -1) + 1;
  if (a.afterItemId) {
    const [after] = await tx
      .select({ sort: presentationItems.sort })
      .from(presentationItems)
      .where(and(eq(presentationItems.id, a.afterItemId), eq(presentationItems.presentationId, a.presentationId)));
    if (after) {
      sort = after.sort + 1;
      await tx
        .update(presentationItems)
        .set({ sort: sql`${presentationItems.sort} + 1` })
        .where(and(eq(presentationItems.presentationId, a.presentationId), gt(presentationItems.sort, after.sort)));
    }
  }
  await tx.insert(presentationItems).values({
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'song',
    title: s.name,
    sourceId: a.songId,
    sort,
    arrangementId: await ownArrangement(tx, a.songId, a.arrangementId),
  });
}

const renameItemArgs = z.object({ itemId: id, title: name });
/** Renames an item; the song keeps its name (PRES-R36). */
async function renameItem(tx: Tx, a: z.output<typeof renameItemArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.update(presentationItems).set({ title: a.title }).where(eq(presentationItems.id, a.itemId));
}

const setItemArrangementArgs = z.object({ itemId: id, arrangementId: id.nullable() });
/** Chooses the arrangement a song item shows (03 Q13); null is the song's default. */
async function setItemArrangement(tx: Tx, a: z.output<typeof setItemArrangementArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [item] = await tx.select({ songId: presentationItems.sourceId }).from(presentationItems).where(eq(presentationItems.id, a.itemId));
  if (!item) return; // removed meanwhile
  const arrangementId = await ownArrangement(tx, item.songId, a.arrangementId);
  if (a.arrangementId !== null && arrangementId === null) throw new MutationError('not-found', 'arrangement not found');
  await tx.update(presentationItems).set({ arrangementId }).where(eq(presentationItems.id, a.itemId));
}

const reorderItemsArgs = z.object({ presentationId: id, itemIds: z.array(id).max(1000) });
/** Puts the named items first, in the given order; other items keep their order after them. */
async function reorderItems(tx: Tx, a: z.output<typeof reorderItemsArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const current = await tx
    .select({ id: presentationItems.id })
    .from(presentationItems)
    .where(eq(presentationItems.presentationId, a.presentationId))
    .orderBy(asc(presentationItems.sort), asc(presentationItems.id));
  const existing = new Set(current.map((r) => r.id));
  const named = a.itemIds.filter((x) => existing.has(x));
  const rest = current.map((r) => r.id).filter((x) => !named.includes(x));
  for (const [i, itemId] of [...named, ...rest].entries()) {
    await tx
      .update(presentationItems)
      .set({ sort: i })
      .where(and(eq(presentationItems.id, itemId), ne(presentationItems.sort, i)));
  }
}

const removeItemArgs = z.object({ itemId: id });
/** Deletes exactly the named item; a no-op if it is already gone. */
async function removeItem(tx: Tx, a: z.output<typeof removeItemArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.delete(presentationItems).where(eq(presentationItems.id, a.itemId));
}

const trashPresentationArgs = z.object({ id, at: z.number().int() });
async function trashPresentation(tx: Tx, a: z.output<typeof trashPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.update(presentations).set({ deletedAt: a.at }).where(eq(presentations.id, a.id));
}

const restorePresentationArgs = z.object({ id });
async function restorePresentation(tx: Tx, a: z.output<typeof restorePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.update(presentations).set({ deletedAt: null }).where(eq(presentations.id, a.id));
}

const purgePresentationArgs = z.object({ id });
/** Permanent delete (D14): only of a presentation that is in the trash where this runs. */
async function purgePresentation(tx: Tx, a: z.output<typeof purgePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [p] = await tx.select({ deletedAt: presentations.deletedAt }).from(presentations).where(eq(presentations.id, a.id));
  if (!p) return; // already gone: nothing to do
  if (p.deletedAt === null) throw new MutationError('not-in-trash', 'presentation is not in the trash');
  await tx.delete(presentationItems).where(eq(presentationItems.presentationId, a.id));
  await tx.delete(presentations).where(eq(presentations.id, a.id));
}

// ------------------------------------------------------------------ trash

const purgeExpiredTrashArgs = z.object({ now: z.number().int() });
/**
 * Purges what has been in the trash longer than the retention (SONG-R28,
 * PRES-R26), of the kinds the caller manages. Sent when the trash opens. On
 * the server the earlier of the client's and the server's clock counts, so a
 * client clock that runs ahead never purges early.
 */
async function purgeExpiredTrash(tx: Tx, a: z.output<typeof purgeExpiredTrashArgs>, ctx: MutatorCtx) {
  const cutoff = Math.min(a.now, ctx.now ?? a.now) - TRASH_RETENTION_MS;
  if (can(ctx.role, 'ManageSongs')) {
    const expired = await tx.select({ id: songs.id }).from(songs).where(and(isNotNull(songs.deletedAt), lte(songs.deletedAt, cutoff)));
    for (const s of expired) await deleteSongRows(tx, s.id);
  }
  if (can(ctx.role, 'ManagePresentations')) {
    const expired = await tx
      .select({ id: presentations.id })
      .from(presentations)
      .where(and(isNotNull(presentations.deletedAt), lte(presentations.deletedAt, cutoff)));
    const ids = expired.map((p) => p.id);
    if (ids.length) {
      await tx.delete(presentationItems).where(inArray(presentationItems.presentationId, ids));
      await tx.delete(presentations).where(inArray(presentations.id, ids));
    }
  }
}

// ------------------------------------------------------------------ test probe

const probeArgs = z.object({ songId: id });
/**
 * Writes, awaits more reads, then always throws, so it never changes anything.
 * The sync tests use it to prove that a mutator's earlier writes are rolled
 * back on every database.
 */
async function probeWriteThenThrow(tx: Tx, a: z.output<typeof probeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.insert(songs).values({ id: a.songId, name: 'should never be seen' });
  await tx.select().from(songs).where(eq(songs.id, a.songId));
  await tx.update(songs).set({ name: 'still never seen' }).where(eq(songs.id, a.songId));
  throw new MutationError('probe-failure', 'thrown after writing');
}

// ------------------------------------------------------------------ registry

export interface Mutator<S extends z.ZodType = z.ZodType> {
  /** Current version. */
  v: number;
  /** Oldest version the server still accepts. */
  minV: number;
  args: S;
  run: (tx: Tx, args: z.output<S>, ctx: MutatorCtx) => Promise<void>;
}

const m = <S extends z.ZodType>(args: S, run: Mutator<S>['run']): Mutator<S> => ({ v: 1, minV: 1, args, run });

/** Every mutator. Arguments are validated with `args` on both ends before `run`. */
export const mutators = {
  createSong: m(createSongArgs, createSong),
  updateSong: m(updateSongArgs, updateSong),
  trashSong: m(trashSongArgs, trashSong),
  restoreSong: m(restoreSongArgs, restoreSong),
  purgeSong: m(purgeSongArgs, purgeSong),
  addSongPart: m(addSongPartArgs, addSongPart),
  updateSongPart: m(updateSongPartArgs, updateSongPart),
  removeSongPart: m(removeSongPartArgs, removeSongPart),
  moveSongPart: m(moveSongPartArgs, moveSongPart),
  createArrangement: m(createArrangementArgs, createArrangement),
  updateArrangement: m(updateArrangementArgs, updateArrangement),
  removeArrangement: m(removeArrangementArgs, removeArrangement),
  createPresentation: m(createPresentationArgs, createPresentation),
  renamePresentation: m(renamePresentationArgs, renamePresentation),
  updatePresentation: m(updatePresentationArgs, updatePresentation),
  addSongToPresentation: m(addSongToPresentationArgs, addSongToPresentation),
  renameItem: m(renameItemArgs, renameItem),
  setItemArrangement: m(setItemArrangementArgs, setItemArrangement),
  reorderItems: m(reorderItemsArgs, reorderItems),
  removeItem: m(removeItemArgs, removeItem),
  trashPresentation: m(trashPresentationArgs, trashPresentation),
  restorePresentation: m(restorePresentationArgs, restorePresentation),
  purgePresentation: m(purgePresentationArgs, purgePresentation),
  purgeExpiredTrash: m(purgeExpiredTrashArgs, purgeExpiredTrash),
  probeWriteThenThrow: m(probeArgs, probeWriteThenThrow),
};

export type Mutators = typeof mutators;
export type MutatorName = keyof Mutators;
/** What a caller passes: the schema's input, before trimming and defaults. */
export type MutatorArgs<N extends MutatorName> = z.input<Mutators[N]['args']>;

export function getMutator(mutatorName: string): Mutator | undefined {
  return Object.hasOwn(mutators, mutatorName) ? (mutators[mutatorName as MutatorName] as unknown as Mutator) : undefined;
}

/** Validates the arguments and runs the mutator. Invalid arguments are a refusal, not a crash. */
export async function runMutator(mutator: Mutator, tx: Tx, rawArgs: unknown, ctx: MutatorCtx): Promise<void> {
  const parsed = mutator.args.safeParse(rawArgs);
  if (!parsed.success) throw new MutationError('invalid-args', parsed.error.message);
  await mutator.run(tx, parsed.data, ctx);
}
