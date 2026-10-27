import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, max, ne, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { BIBLE_LIMITS, bibleId, bibleTitle, splitBibleSlides, type BibleItemContent } from './bible.ts';
import { labelDefaults, labelId } from './labels.ts';
import { can, type Permission, type Role } from './permissions.ts';
import { DISPLAY_CODE, MAX_DISPLAYS } from './displays.ts';
import { MEDIA_LIMITS } from './media.ts';
import { audios, bibleBlobs, bibles, bibleTexts, displays, images, labels, mediaBlobs, orgSettings, presentationItems, presentations, songArrangements, songParts, songs } from './schema.ts';
import { isKnownTheme } from './themes.ts';
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
// edits to different fields both land (ADR 0007, decision 2). Upserts
// (onConflictDoUpdate, onConflictDoNothing) are fine; replacing a row is not,
// as the client's undo triggers never see the row it deletes (sync-sql.ts).
// `pnpm lint` refuses one here (scripts/check-mutator-sql.mjs).

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

const appendArrangementPartArgs = z.object({ id, partId: id });
/** Appends a part to an arrangement ("Lägg till del"). */
async function appendArrangementPart(tx: Tx, a: z.output<typeof appendArrangementPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const arr = await arrangementParts(tx, a.id);
  if (!arr) return;
  if (!(await ownPartIds(tx, arr.songId, [a.partId])).length) return; // not (or no longer) a part of the song
  if (arr.ids.length >= 500) throw new MutationError('limit', 'the maximum number of parts in an arrangement has been reached');
  await setArrangementParts(tx, a.id, [...arr.ids, a.partId]);
}

const removeArrangementPartArgs = z.object({ id, index: z.number().int().min(0), partId: id });
/** Takes one chip out of an arrangement (×). */
async function removeArrangementPart(tx: Tx, a: z.output<typeof removeArrangementPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const arr = await arrangementParts(tx, a.id);
  if (!arr) return;
  const at = chipAt(arr.ids, a.index, a.partId);
  if (at !== -1) await setArrangementParts(tx, a.id, arr.ids.toSpliced(at, 1));
}

const moveArrangementPartArgs = z.object({ id, index: z.number().int().min(0), partId: id, by: z.number().int().min(-500).max(500) });
/** Moves one chip `by` places (↑ is -1, ↓ is 1), stopping at the ends. */
async function moveArrangementPart(tx: Tx, a: z.output<typeof moveArrangementPartArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const arr = await arrangementParts(tx, a.id);
  if (!arr) return;
  const at = chipAt(arr.ids, a.index, a.partId);
  if (at === -1) return;
  const to = Math.max(0, Math.min(arr.ids.length - 1, at + a.by));
  if (to !== at) await setArrangementParts(tx, a.id, arr.ids.toSpliced(at, 1).toSpliced(to, 0, a.partId));
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

/** A theme the organisation can use; anything else is "Theme not found." (PRES-R6, THEME-R4). */
function requireTheme(themeId: string) {
  if (!isKnownTheme(themeId)) throw new MutationError('theme-not-found', 'Theme not found.');
}

const updatePresentationArgs = z.object({
  id,
  name: name.optional(),
  eventDate: z.iso.date().nullable().optional(),
  /** The presentation's own theme; null follows the organisation's default (THEME-A5). */
  themeId: id.nullable().optional(),
});
/** The details dialog (spec 03, "Redigera detaljer"): sets the fields it names; a null date clears it. */
async function updatePresentation(tx: Tx, a: z.output<typeof updatePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  if (a.themeId !== undefined) {
    requirePermission(ctx, 'ViewThemes'); // PRES-R6
    if (a.themeId !== null) requireTheme(a.themeId);
  }
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

/**
 * Inserts an item right after `afterItemId` (spec 03 2d), or last when that
 * is absent or gone, moving the items after it down by one. False if the
 * item already exists: a replay of an add that already landed.
 */
async function insertItem(
  tx: Tx,
  afterItemId: string | null | undefined,
  item: Omit<typeof presentationItems.$inferInsert, 'sort'>,
): Promise<boolean> {
  const [existing] = await tx.select({ id: presentationItems.id }).from(presentationItems).where(eq(presentationItems.id, item.id));
  if (existing) return false;
  const [n] = await tx
    .select({ n: count(), last: max(presentationItems.sort) })
    .from(presentationItems)
    .where(eq(presentationItems.presentationId, item.presentationId));
  limit((n?.n ?? 0) >= LIMITS.itemsPerPresentation, 'items');
  let sort = (n?.last ?? -1) + 1;
  if (afterItemId) {
    const [after] = await tx
      .select({ sort: presentationItems.sort })
      .from(presentationItems)
      .where(and(eq(presentationItems.id, afterItemId), eq(presentationItems.presentationId, item.presentationId)));
    if (after) {
      sort = after.sort + 1;
      await tx
        .update(presentationItems)
        .set({ sort: sql`${presentationItems.sort} + 1` })
        .where(and(eq(presentationItems.presentationId, item.presentationId), gt(presentationItems.sort, after.sort)));
    }
  }
  await tx.insert(presentationItems).values({ ...item, sort });
  return true;
}

async function requirePresentation(tx: Tx, presentationId: string) {
  const [p] = await tx.select({ id: presentations.id }).from(presentations).where(eq(presentations.id, presentationId));
  if (!p) throw new MutationError('not-found', 'presentation not found');
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
  await requirePresentation(tx, a.presentationId);
  const [s] = await tx.select({ name: songs.name }).from(songs).where(eq(songs.id, a.songId));
  if (!s) throw new MutationError('not-found', 'song not found');
  await insertItem(tx, a.afterItemId, {
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'song',
    title: s.name,
    sourceId: a.songId,
    arrangementId: await ownArrangement(tx, a.songId, a.arrangementId),
    content: null,
  });
}

/** The add-item tab adds at most this many verses (BIBLE-R14, D13). */
export const MAX_VERSES_PER_ITEM = 500;

const verseArg = z.object({
  b: z.string().regex(/^[0-9A-Z]{3}$/),
  c: z.number().int().min(0).max(999),
  v: z.number().int().min(0).max(999),
  t: z.string().max(BIBLE_LIMITS.verseLength),
});

const addBibleToPresentationArgs = z.object({
  itemId: id,
  presentationId: id,
  /** The translation the verses came from, and its abbreviation as it was: the item keeps it (D12). */
  bibleId: id,
  translation: z.string().trim().min(1).max(50),
  verses: z.array(verseArg).min(1).max(MAX_VERSES_PER_ITEM),
  afterItemId: id.nullable().optional(),
});
/**
 * Adds a Bible passage. It is split into slides here, once, and frozen
 * (BIBLE-R12): re-importing or deleting the translation leaves it as it is
 * (BIBLE-A3, A7). Stored as data, never HTML (D25). The title is the
 * reference with Swedish book names (BIBLE-R13).
 */
async function addBibleToPresentation(tx: Tx, a: z.output<typeof addBibleToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewBibles');
  await requirePresentation(tx, a.presentationId);
  const content: BibleItemContent = { translation: a.translation, slides: splitBibleSlides(a.verses) };
  await insertItem(tx, a.afterItemId, {
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'bible',
    title: bibleTitle(a.verses).slice(0, 200),
    sourceId: a.bibleId,
    arrangementId: null,
    content: JSON.stringify(content),
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
  const [item] = await tx
    .select({ songId: presentationItems.sourceId, type: presentationItems.type })
    .from(presentationItems)
    .where(eq(presentationItems.id, a.itemId));
  if (!item) return; // removed meanwhile
  if (item.type !== 'song') throw new MutationError('not-a-song', 'only a song item has an arrangement');
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

const moveItemArgs = z.object({ itemId: id, by: z.number().int().min(-1000).max(1000) });
/** Moves an item `by` places in the order as it is where this runs (↑ is -1), stopping at the ends. */
async function moveItem(tx: Tx, a: z.output<typeof moveItemArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [item] = await tx.select({ presentationId: presentationItems.presentationId }).from(presentationItems).where(eq(presentationItems.id, a.itemId));
  if (!item) return;
  const order = (
    await tx
      .select({ id: presentationItems.id })
      .from(presentationItems)
      .where(eq(presentationItems.presentationId, item.presentationId))
      .orderBy(asc(presentationItems.sort), asc(presentationItems.id))
  ).map((r) => r.id);
  const at = order.indexOf(a.itemId);
  const to = Math.max(0, Math.min(order.length - 1, at + a.by));
  const next = order.toSpliced(at, 1).toSpliced(to, 0, a.itemId);
  for (const [i, itemId] of next.entries()) {
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

// ------------------------------------------------------------------ images (spec 05 "Media")

const mediaHash = z.string().regex(/^[0-9a-f]{64}$/);

const addImageArgs = z.object({
  id,
  fileName: z.string().trim().min(1).max(MEDIA_LIMITS.fileName),
  contentType: z.enum(['image/jpeg', 'image/webp']),
  /** The two blobs, uploaded first (`PUT /media/{hash}`) and recorded in `media_blobs` where this runs. */
  fullHash: mediaHash,
  thumbHash: mediaHash,
  width: z.number().int().min(1).max(1920),
  height: z.number().int().min(1).max(1080),
  createdAt: z.number().int(),
});
/**
 * Adds a picture to the library (MEDIA-R3, R6). Both blobs must be known
 * where this runs: on the server the uploads recorded them, on the importing
 * device the import did. Bytes first, then the row, so a refused add leaves
 * only blobs a clean-up removes. At most 1 000 pictures, the trash not counted.
 */
async function addImage(tx: Tx, a: z.output<typeof addImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageImages');
  const [existing] = await tx.select({ id: images.id }).from(images).where(eq(images.id, a.id));
  if (existing) return; // a replay of an add that already landed
  for (const hash of new Set([a.fullHash, a.thumbHash])) {
    const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, hash));
    if (!blob) throw new MutationError('media-missing', 'a picture has not been uploaded');
  }
  const [n] = await tx.select({ n: count() }).from(images).where(isNull(images.deletedAt));
  limit((n?.n ?? 0) >= MEDIA_LIMITS.images, 'images');
  await tx.insert(images).values({
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    fullHash: a.fullHash,
    thumbHash: a.thumbHash,
    width: a.width,
    height: a.height,
    createdAt: a.createdAt,
    deletedAt: null,
  });
}

const trashImageArgs = z.object({ id, at: z.number().int() });
/** Soft delete (MEDIA-R8): still served, so presentations that use it keep working. */
async function trashImage(tx: Tx, a: z.output<typeof trashImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageImages');
  await tx.update(images).set({ deletedAt: a.at }).where(eq(images.id, a.id));
}

const restoreImageArgs = z.object({ id });
/** Restoring may exceed the maximum (MEDIA-R8). */
async function restoreImage(tx: Tx, a: z.output<typeof restoreImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageImages');
  await tx.update(images).set({ deletedAt: null }).where(eq(images.id, a.id));
}

const purgeImageArgs = z.object({ id });
/** Permanent delete: only of an image in the trash where this runs. Its blobs go with the next clean-up. */
async function purgeImage(tx: Tx, a: z.output<typeof purgeImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageImages');
  const [i] = await tx.select({ deletedAt: images.deletedAt }).from(images).where(eq(images.id, a.id));
  if (!i) return;
  if (i.deletedAt === null) throw new MutationError('not-in-trash', 'image is not in the trash');
  await tx.delete(images).where(eq(images.id, a.id));
}

const addImageToPresentationArgs = z.object({
  itemId: id,
  presentationId: id,
  imageId: id,
  afterItemId: id.nullable().optional(),
});
/**
 * Adds a library picture as an item: one slide showing it. Like a song it is
 * a reference, so a trashed picture still shows (MEDIA-R8) and a purged one
 * leaves an item that says so. The title is the file name at add time.
 */
async function addImageToPresentation(tx: Tx, a: z.output<typeof addImageToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewImages');
  await requirePresentation(tx, a.presentationId);
  const [i] = await tx.select({ fileName: images.fileName }).from(images).where(eq(images.id, a.imageId));
  if (!i) throw new MutationError('not-found', 'image not found');
  await insertItem(tx, a.afterItemId, {
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'image',
    title: i.fileName,
    sourceId: a.imageId,
    arrangementId: null,
    content: null,
  });
}

// ------------------------------------------------------------------ audio (spec 05 "Media")

const addAudioArgs = z.object({
  id,
  fileName: z.string().trim().min(1).max(MEDIA_LIMITS.fileName),
  /** As the server recognised it when the file was uploaded. */
  contentType: z.enum(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm', 'audio/x-m4a']),
  hash: mediaHash,
  size: z.number().int().min(1).max(MEDIA_LIMITS.audioBytes),
  createdAt: z.number().int(),
});
/** Adds an audio file (MEDIA-R3, R5): its blob must be known where this runs. At most 500, the trash not counted. */
async function addAudio(tx: Tx, a: z.output<typeof addAudioArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageAudios');
  const [existing] = await tx.select({ id: audios.id }).from(audios).where(eq(audios.id, a.id));
  if (existing) return;
  const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, a.hash));
  if (!blob) throw new MutationError('media-missing', 'the audio file has not been uploaded');
  const [n] = await tx.select({ n: count() }).from(audios).where(isNull(audios.deletedAt));
  limit((n?.n ?? 0) >= MEDIA_LIMITS.audios, 'audio files');
  await tx.insert(audios).values({ id: a.id, fileName: a.fileName, contentType: a.contentType, hash: a.hash, size: a.size, createdAt: a.createdAt, deletedAt: null });
}

const trashAudioArgs = z.object({ id, at: z.number().int() });
async function trashAudio(tx: Tx, a: z.output<typeof trashAudioArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageAudios');
  await tx.update(audios).set({ deletedAt: a.at }).where(eq(audios.id, a.id));
}

const restoreAudioArgs = z.object({ id });
async function restoreAudio(tx: Tx, a: z.output<typeof restoreAudioArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageAudios');
  await tx.update(audios).set({ deletedAt: null }).where(eq(audios.id, a.id));
}

const purgeAudioArgs = z.object({ id });
/** Permanent delete: only of a file in the trash where this runs. Its blob goes with the next clean-up. */
async function purgeAudio(tx: Tx, a: z.output<typeof purgeAudioArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageAudios');
  const [f] = await tx.select({ deletedAt: audios.deletedAt }).from(audios).where(eq(audios.id, a.id));
  if (!f) return;
  if (f.deletedAt === null) throw new MutationError('not-in-trash', 'audio file is not in the trash');
  await tx.delete(audios).where(eq(audios.id, a.id));
}

const addAudioToPresentationArgs = z.object({ itemId: id, presentationId: id, audioId: id, afterItemId: id.nullable().optional() });
/**
 * Adds an audio file as an item (spec 03): it has no slides, and selecting it
 * live plays it on the presenting computer without changing what is shown
 * (LIVE-R6). A reference, like a picture: a trashed file still plays.
 */
async function addAudioToPresentation(tx: Tx, a: z.output<typeof addAudioToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewAudios');
  await requirePresentation(tx, a.presentationId);
  const [f] = await tx.select({ fileName: audios.fileName }).from(audios).where(eq(audios.id, a.audioId));
  if (!f) throw new MutationError('not-found', 'audio file not found');
  await insertItem(tx, a.afterItemId, {
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'audio',
    title: f.fileName,
    sourceId: a.audioId,
    arrangementId: null,
    content: null,
  });
}

// ------------------------------------------------------------------ bibles

/** Drops a stored text that no translation names any more. */
async function dropUnusedText(tx: Tx, hash: string) {
  const [used] = await tx.select({ id: bibles.id }).from(bibles).where(eq(bibles.contentHash, hash));
  if (used) return;
  await tx.delete(bibleBlobs).where(eq(bibleBlobs.hash, hash));
  await tx.delete(bibleTexts).where(eq(bibleTexts.hash, hash));
}

const importBibleArgs = z.object({
  name: z.string().trim().min(1).max(200),
  abbreviation: z.string().trim().min(1).max(50),
  language: z.string().trim().max(20).nullable(),
  /** The text, uploaded first (`PUT /bibles/{hash}`) and stored where this runs. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
/**
 * Imports a translation, or replaces the one with the same abbreviation
 * (BIBLE-R5): its id comes from the abbreviation, so the row is kept and its
 * name, text and count change. At most 10, counted only for a new one. The
 * text must be stored here already: on the server the upload put it there, on
 * the importing device the import did. The verse count is the text's own.
 */
async function importBible(tx: Tx, a: z.output<typeof importBibleArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageBibles'); // D24
  const [text] = await tx.select({ verseCount: bibleBlobs.verseCount }).from(bibleBlobs).where(eq(bibleBlobs.hash, a.contentHash));
  if (!text) throw new MutationError('bible-text-missing', 'the text of this translation has not been uploaded');
  const bid = bibleId(a.abbreviation);
  const [existing] = await tx.select({ contentHash: bibles.contentHash }).from(bibles).where(eq(bibles.id, bid));
  if (!existing) {
    const [n] = await tx.select({ n: count() }).from(bibles);
    limit((n?.n ?? 0) >= BIBLE_LIMITS.bibles, 'Bibles');
  }
  const row = { name: a.name, abbreviation: a.abbreviation, language: a.language, verseCount: text.verseCount, contentHash: a.contentHash };
  if (existing) await tx.update(bibles).set(row).where(eq(bibles.id, bid));
  else await tx.insert(bibles).values({ id: bid, ...row });
  if (existing && existing.contentHash !== a.contentHash) await dropUnusedText(tx, existing.contentHash);
}

const deleteBibleArgs = z.object({ id });
/** Deletes a translation (BIBLE-R7): no trash, and items made from it keep their text. A no-op if it is gone. */
async function deleteBible(tx: Tx, a: z.output<typeof deleteBibleArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageBibles'); // D24
  const [b] = await tx.select({ contentHash: bibles.contentHash }).from(bibles).where(eq(bibles.id, a.id));
  if (!b) return;
  await tx.delete(bibles).where(eq(bibles.id, a.id));
  await dropUnusedText(tx, b.contentHash);
}

// ------------------------------------------------------------------ themes

export const DEFAULT_THEME_SETTING = 'defaultThemeId';

const setDefaultThemeArgs = z.object({ themeId: id });
/** The organisation's default theme (THEME-R4): presentations without their own follow it at once (THEME-R6). */
async function setDefaultTheme(tx: Tx, a: z.output<typeof setDefaultThemeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageThemes');
  requireTheme(a.themeId);
  await tx
    .insert(orgSettings)
    .values({ id: DEFAULT_THEME_SETTING, value: a.themeId })
    .onConflictDoUpdate({ target: orgSettings.id, set: { value: a.themeId } });
}

// ------------------------------------------------------------------ outputs (spec 04 §7)

const displayCode = z.string().regex(DISPLAY_CODE);

async function requireFreeCode(tx: Tx, code: string, exceptId: string | null) {
  const [taken] = await tx.select({ id: displays.id }).from(displays).where(eq(displays.code, code));
  if (taken && taken.id !== exceptId) throw new MutationError('code-taken', 'the code is in use');
}

const createDisplayArgs = z.object({ id, name, code: displayCode, kind: z.enum(['public']) });
/** Creates an output (LIVE-R30). The code comes from the caller; the server registers it globally after the push. */
async function createDisplay(tx: Tx, a: z.output<typeof createDisplayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageRemoteDisplays');
  const [existing] = await tx.select({ id: displays.id }).from(displays).where(eq(displays.id, a.id));
  if (existing) return;
  const [n] = await tx.select({ n: count() }).from(displays);
  limit((n?.n ?? 0) >= MAX_DISPLAYS, 'outputs');
  await requireFreeCode(tx, a.code, null);
  await tx.insert(displays).values({ id: a.id, name: a.name, code: a.code, kind: a.kind });
}

const newDisplayCodeArgs = z.object({ id, code: displayCode });
/** "Ny kod": the old code stops working at once, and everyone watching is disconnected (spec 04 §7). */
async function newDisplayCode(tx: Tx, a: z.output<typeof newDisplayCodeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageRemoteDisplays');
  await requireFreeCode(tx, a.code, a.id);
  await tx.update(displays).set({ code: a.code }).where(eq(displays.id, a.id));
}

const deleteDisplayArgs = z.object({ id });
/** No trash (spec 04 §7). A no-op if it is gone. */
async function deleteDisplay(tx: Tx, a: z.output<typeof deleteDisplayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageRemoteDisplays');
  await tx.delete(displays).where(eq(displays.id, a.id));
}

/** The mutators that change which codes an organisation has: after a push with one, the server registers them. */
export const DISPLAY_MUTATORS: readonly string[] = ['createDisplay', 'newDisplayCode', 'deleteDisplay'];

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
  if (can(ctx.role, 'ManageImages')) {
    await tx.delete(images).where(and(isNotNull(images.deletedAt), lte(images.deletedAt, cutoff)));
  }
  if (can(ctx.role, 'ManageAudios')) {
    await tx.delete(audios).where(and(isNotNull(audios.deletedAt), lte(audios.deletedAt, cutoff)));
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
  appendArrangementPart: m(appendArrangementPartArgs, appendArrangementPart),
  removeArrangementPart: m(removeArrangementPartArgs, removeArrangementPart),
  moveArrangementPart: m(moveArrangementPartArgs, moveArrangementPart),
  createPresentation: m(createPresentationArgs, createPresentation),
  renamePresentation: m(renamePresentationArgs, renamePresentation),
  updatePresentation: m(updatePresentationArgs, updatePresentation),
  addSongToPresentation: m(addSongToPresentationArgs, addSongToPresentation),
  addBibleToPresentation: m(addBibleToPresentationArgs, addBibleToPresentation),
  addImageToPresentation: m(addImageToPresentationArgs, addImageToPresentation),
  addAudioToPresentation: m(addAudioToPresentationArgs, addAudioToPresentation),
  renameItem: m(renameItemArgs, renameItem),
  setItemArrangement: m(setItemArrangementArgs, setItemArrangement),
  reorderItems: m(reorderItemsArgs, reorderItems),
  moveItem: m(moveItemArgs, moveItem),
  removeItem: m(removeItemArgs, removeItem),
  trashPresentation: m(trashPresentationArgs, trashPresentation),
  restorePresentation: m(restorePresentationArgs, restorePresentation),
  purgePresentation: m(purgePresentationArgs, purgePresentation),
  purgeExpiredTrash: m(purgeExpiredTrashArgs, purgeExpiredTrash),
  importBible: m(importBibleArgs, importBible),
  deleteBible: m(deleteBibleArgs, deleteBible),
  setDefaultTheme: m(setDefaultThemeArgs, setDefaultTheme),
  addImage: m(addImageArgs, addImage),
  trashImage: m(trashImageArgs, trashImage),
  restoreImage: m(restoreImageArgs, restoreImage),
  purgeImage: m(purgeImageArgs, purgeImage),
  addAudio: m(addAudioArgs, addAudio),
  trashAudio: m(trashAudioArgs, trashAudio),
  restoreAudio: m(restoreAudioArgs, restoreAudio),
  purgeAudio: m(purgeAudioArgs, purgeAudio),
  createDisplay: m(createDisplayArgs, createDisplay),
  newDisplayCode: m(newDisplayCodeArgs, newDisplayCode),
  deleteDisplay: m(deleteDisplayArgs, deleteDisplay),
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
