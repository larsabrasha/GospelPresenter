import { and, asc, count, eq, gt, max, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BIBLE_LIMITS, bibleTitle, splitBibleSlides, type BibleItemContent } from '../bible.ts';
import { overlays, presentationItems, presentations, songArrangements, songs } from '../schema.ts';
import { isKnownTheme } from '../themes.ts';
import { id, LIMITS, limit, MutationError, name, optionalText, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ presentations

/** A time of day, `HH:MM`. */
export const eventTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
/** spec 03: `EventLocation` ≤ 100, `EventDescription` ≤ 5000 (PRES-R9). */
export const eventLocation = optionalText(100);
export const eventDescription = optionalText(5000);

/** When and where, and what it is about: the details dialog's fields (spec 03 2a). */
const eventFields = {
  eventDate: z.iso.date().nullable().optional(),
  time: eventTime.optional(),
  location: eventLocation.optional(),
  description: eventDescription.optional(),
};

export const createPresentationArgs = z.object({ id, name, ...eventFields });
export async function createPresentation(tx: Tx, a: z.output<typeof createPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx
    .insert(presentations)
    .values({
      id: a.id,
      name: a.name,
      eventDate: a.eventDate ?? null,
      time: a.time ?? null,
      location: a.location ?? null,
      description: a.description ?? null,
      updatedAt: changedAt(ctx),
    })
    .onConflictDoNothing();
}

export const renamePresentationArgs = z.object({ id, name });
/** Renames a presentation; a template is renamed with `updateTemplate`. */
export async function renamePresentation(tx: Tx, a: z.output<typeof renamePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx
    .update(presentations)
    .set({ name: a.name, updatedAt: changedAt(ctx) })
    .where(and(eq(presentations.id, a.id), eq(presentations.isTemplate, false)));
}

/** A theme the organisation can use; anything else is "Theme not found." (PRES-R6, THEME-R4). */
export function requireTheme(themeId: string) {
  if (!isKnownTheme(themeId)) throw new MutationError('theme-not-found', 'Theme not found.');
}

export const updatePresentationArgs = z.object({
  id,
  name: name.optional(),
  ...eventFields,
  /** The presentation's own theme; null follows the organisation's default (THEME-A5). */
  themeId: id.nullable().optional(),
});
/** The details dialog (spec 03, "Redigera detaljer"): sets the fields it names; a null clears one. */
export async function updatePresentation(tx: Tx, a: z.output<typeof updatePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  if (a.themeId !== undefined) {
    requirePermission(ctx, 'ViewThemes'); // PRES-R6
    if (a.themeId !== null) requireTheme(a.themeId);
  }
  const { id: presentationId, ...fields } = a;
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length)
    await tx
      .update(presentations)
      .set({ ...set, updatedAt: changedAt(ctx) })
      .where(and(eq(presentations.id, presentationId), eq(presentations.isTemplate, false)));
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
export async function insertItem(
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

/** Now, for `updatedAt`: the server's clock when it runs a push, else this device's. */
export function changedAt(ctx: MutatorCtx): number {
  return ctx.now ?? Date.now();
}

/**
 * The presentation whose running order is about to change, or a template,
 * which only those who manage templates may edit (D24, spec 03 Q3); marks it
 * changed now.
 */
export async function changePresentation(tx: Tx, presentationId: string, ctx: MutatorCtx) {
  const [p] = await tx.select({ isTemplate: presentations.isTemplate }).from(presentations).where(eq(presentations.id, presentationId));
  if (!p) throw new MutationError('not-found', 'presentation not found');
  if (p.isTemplate) requirePermission(ctx, 'ManageTemplates');
  await tx.update(presentations).set({ updatedAt: changedAt(ctx) }).where(eq(presentations.id, presentationId));
}

/** The same for an item, by its id: false when the item is gone. */
async function requireItem(tx: Tx, itemId: string, ctx: MutatorCtx): Promise<boolean> {
  const [item] = await tx.select({ presentationId: presentationItems.presentationId }).from(presentationItems).where(eq(presentationItems.id, itemId));
  if (!item) return false;
  await changePresentation(tx, item.presentationId, ctx);
  return true;
}

export const addSongToPresentationArgs = z.object({
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
export async function addSongToPresentation(tx: Tx, a: z.output<typeof addSongToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await changePresentation(tx, a.presentationId, ctx);
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

export const addBibleToPresentationArgs = z.object({
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
export async function addBibleToPresentation(tx: Tx, a: z.output<typeof addBibleToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewBibles');
  await changePresentation(tx, a.presentationId, ctx);
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

export const renameItemArgs = z.object({ itemId: id, title: name });
/** Renames an item; the song keeps its name (PRES-R36). */
export async function renameItem(tx: Tx, a: z.output<typeof renameItemArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  if (!(await requireItem(tx, a.itemId, ctx))) return;
  await tx.update(presentationItems).set({ title: a.title }).where(eq(presentationItems.id, a.itemId));
}

export const setItemArrangementArgs = z.object({ itemId: id, arrangementId: id.nullable() });
/** Chooses the arrangement a song item shows (03 Q13); null is the song's default. */
export async function setItemArrangement(tx: Tx, a: z.output<typeof setItemArrangementArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [item] = await tx
    .select({ songId: presentationItems.sourceId, type: presentationItems.type })
    .from(presentationItems)
    .where(eq(presentationItems.id, a.itemId));
  if (!item) return; // removed meanwhile
  await requireItem(tx, a.itemId, ctx);
  if (item.type !== 'song') throw new MutationError('not-a-song', 'only a song item has an arrangement');
  const arrangementId = await ownArrangement(tx, item.songId, a.arrangementId);
  if (a.arrangementId !== null && arrangementId === null) throw new MutationError('not-found', 'arrangement not found');
  await tx.update(presentationItems).set({ arrangementId }).where(eq(presentationItems.id, a.itemId));
}

export const setItemOverlayArgs = z.object({ itemId: id, overlayId: id.nullable() });
/**
 * Chooses the overlay an item carries (TODO.md "Overlays"): it switches on
 * when the item goes live and off when it leaves. Null for none.
 */
export async function setItemOverlay(tx: Tx, a: z.output<typeof setItemOverlayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewOverlays');
  if (!(await requireItem(tx, a.itemId, ctx))) return;
  if (a.overlayId !== null) {
    const [o] = await tx.select({ id: overlays.id }).from(overlays).where(eq(overlays.id, a.overlayId));
    if (!o) throw new MutationError('not-found', 'overlay not found');
  }
  await tx.update(presentationItems).set({ overlayId: a.overlayId }).where(eq(presentationItems.id, a.itemId));
}

export const reorderItemsArgs = z.object({ presentationId: id, itemIds: z.array(id).max(1000) });
/** Puts the named items first, in the given order; other items keep their order after them. */
export async function reorderItems(tx: Tx, a: z.output<typeof reorderItemsArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await changePresentation(tx, a.presentationId, ctx);
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

export const moveItemArgs = z.object({ itemId: id, by: z.number().int().min(-1000).max(1000) });
/** Moves an item `by` places in the order as it is where this runs (↑ is -1), stopping at the ends. */
export async function moveItem(tx: Tx, a: z.output<typeof moveItemArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [item] = await tx.select({ presentationId: presentationItems.presentationId }).from(presentationItems).where(eq(presentationItems.id, a.itemId));
  if (!item) return;
  await changePresentation(tx, item.presentationId, ctx);
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

export const removeItemArgs = z.object({ itemId: id });
/** Deletes exactly the named item; a no-op if it is already gone. */
export async function removeItem(tx: Tx, a: z.output<typeof removeItemArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  if (!(await requireItem(tx, a.itemId, ctx))) return;
  await tx.delete(presentationItems).where(eq(presentationItems.id, a.itemId));
}

// The trash of presentations and that of templates are two (PRES-R24): each
// mutator touches only its own kind, so a presentation's delete never trashes
// a template, and the other way round.

export const trashPresentationArgs = z.object({ id, at: z.number().int() });
export async function trashPresentation(tx: Tx, a: z.output<typeof trashPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await setDeletedAt(tx, a.id, false, a.at);
}

export const restorePresentationArgs = z.object({ id });
export async function restorePresentation(tx: Tx, a: z.output<typeof restorePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await setDeletedAt(tx, a.id, false, null);
}

export const purgePresentationArgs = z.object({ id });
/** Permanent delete (D14): only of a presentation that is in the trash where this runs. */
export async function purgePresentation(tx: Tx, a: z.output<typeof purgePresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await purgeRows(tx, a.id, false);
}

export async function setDeletedAt(tx: Tx, presentationId: string, isTemplate: boolean, deletedAt: number | null) {
  await tx
    .update(presentations)
    .set({ deletedAt })
    .where(and(eq(presentations.id, presentationId), eq(presentations.isTemplate, isTemplate)));
}

/** Deletes a trashed presentation or template and its items; its slide decks' pages go with the next clean-up. */
export async function purgeRows(tx: Tx, presentationId: string, isTemplate: boolean) {
  const [p] = await tx
    .select({ deletedAt: presentations.deletedAt })
    .from(presentations)
    .where(and(eq(presentations.id, presentationId), eq(presentations.isTemplate, isTemplate)));
  if (!p) return; // already gone (or of the other kind): nothing to do
  if (p.deletedAt === null) throw new MutationError('not-in-trash', `${isTemplate ? 'template' : 'presentation'} is not in the trash`);
  await tx.delete(presentationItems).where(eq(presentationItems.presentationId, presentationId));
  await tx.delete(presentations).where(eq(presentations.id, presentationId));
}
