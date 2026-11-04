import { count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { MEDIA_LIMITS } from '../media.ts';
import { mediaBlobs, slideDecks } from '../schema.ts';
import { MAX_SLIDE_DECKS, slideDeckPagesSchema, type SlidePage } from '../slides.ts';
import { id, limit, MutationError, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { changePresentation, insertItem } from './presentations.ts';

// ------------------------------------------------------------------ slide decks (PRES-R11, D29, docs/media-and-files.md)

const name = z.string().trim().min(1).max(MEDIA_LIMITS.fileName);

/** Every page's two pictures must be known where this runs: on the server the uploads recorded them, on the importing device the import did. */
async function requirePages(tx: Tx, pages: SlidePage[]) {
  for (const hash of new Set(pages.flatMap((p) => [p.full, p.thumb]))) {
    const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, hash));
    if (!blob) throw new MutationError('media-missing', 'a page has not been uploaded');
  }
}

async function insertDeck(tx: Tx, a: { id: string; name: string; pages: SlidePage[]; at: number }) {
  const [existing] = await tx.select({ id: slideDecks.id }).from(slideDecks).where(eq(slideDecks.id, a.id));
  if (existing) return; // a replay of an add that already landed
  const [n] = await tx.select({ n: count() }).from(slideDecks).where(isNull(slideDecks.deletedAt));
  limit((n?.n ?? 0) >= MAX_SLIDE_DECKS, 'slide-decks');
  await requirePages(tx, a.pages);
  await tx.insert(slideDecks).values({ id: a.id, name: a.name, pages: JSON.stringify(a.pages), createdAt: a.at, updatedAt: a.at, deletedAt: null });
}

export const addSlideDeckArgs = z.object({ id, name, pages: slideDeckPagesSchema, at: z.number().int() });
/** A PDF's pages, rendered at import, as a deck of the library (PRES-R11). */
export async function addSlideDeck(tx: Tx, a: z.output<typeof addSlideDeckArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await insertDeck(tx, a);
}

export const addSlidesArgs = z.object({
  itemId: id,
  presentationId: id,
  /** The deck's id; the item's where it is not given (the builds before decks had a library). */
  deckId: id.optional(),
  fileName: name,
  pages: slideDeckPagesSchema,
  afterItemId: id.nullable().optional(),
  at: z.number().int().optional(),
});
/**
 * Imports a PDF into a presentation (Lägg till): the deck goes into the library and an item names it, in one step.
 * The title is the file name (PRES-R11).
 */
export async function addSlides(tx: Tx, a: z.output<typeof addSlidesArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await changePresentation(tx, a.presentationId, ctx);
  const deckId = a.deckId ?? a.itemId;
  await insertDeck(tx, { id: deckId, name: a.fileName, pages: a.pages, at: a.at ?? 0 });
  await insertItem(tx, a.afterItemId, { id: a.itemId, presentationId: a.presentationId, type: 'slides', title: a.fileName, sourceId: deckId, arrangementId: null, content: null });
}

export const updateSlideDeckArgs = z.object({ id, name: name.optional(), pages: slideDeckPagesSchema.optional(), at: z.number().int() });
/** Its name, or its pages from a new PDF: every presentation that shows it shows the new ones. */
export async function updateSlideDeck(tx: Tx, a: z.output<typeof updateSlideDeckArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  if (a.pages) await requirePages(tx, a.pages);
  const set = { updatedAt: a.at, ...(a.name !== undefined ? { name: a.name } : {}), ...(a.pages !== undefined ? { pages: JSON.stringify(a.pages) } : {}) };
  await tx.update(slideDecks).set(set).where(eq(slideDecks.id, a.id));
}

export const trashSlideDeckArgs = z.object({ id, at: z.number().int() });
/** To the trash: items that show it keep showing it, as a trashed picture's do. */
export async function trashSlideDeck(tx: Tx, a: z.output<typeof trashSlideDeckArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.update(slideDecks).set({ deletedAt: a.at }).where(eq(slideDecks.id, a.id));
}

export const restoreSlideDeckArgs = z.object({ id });
export async function restoreSlideDeck(tx: Tx, a: z.output<typeof restoreSlideDeckArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.update(slideDecks).set({ deletedAt: null }).where(eq(slideDecks.id, a.id));
}

export const purgeSlideDeckArgs = z.object({ id });
/** For good: only one in the trash. Items that named it say it is gone. */
export async function purgeSlideDeck(tx: Tx, a: z.output<typeof purgeSlideDeckArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [d] = await tx.select({ deletedAt: slideDecks.deletedAt }).from(slideDecks).where(eq(slideDecks.id, a.id));
  if (!d) return;
  if (d.deletedAt === null) throw new MutationError('not-in-trash', 'slide deck is not in the trash');
  await tx.delete(slideDecks).where(eq(slideDecks.id, a.id));
}

export const addSlideDeckToPresentationArgs = z.object({ itemId: id, presentationId: id, deckId: id, afterItemId: id.nullable().optional() });
/** A deck of the library as an item, a reference: it shows the deck's pages as they are now. */
export async function addSlideDeckToPresentation(tx: Tx, a: z.output<typeof addSlideDeckToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await changePresentation(tx, a.presentationId, ctx);
  const [d] = await tx.select({ name: slideDecks.name }).from(slideDecks).where(eq(slideDecks.id, a.deckId));
  if (!d) throw new MutationError('not-found', 'slide deck not found');
  await insertItem(tx, a.afterItemId, { id: a.itemId, presentationId: a.presentationId, type: 'slides', title: d.name, sourceId: a.deckId, arrangementId: null, content: null });
}
