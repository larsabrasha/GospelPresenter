import { count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { CUSTOM_LIMITS, customPageBlobs, customPagesSchema, pdfPages, type CustomPage } from '../custom-slides.ts';
import { MEDIA_LIMITS } from '../media.ts';
import { customSlides, mediaBlobs } from '../schema.ts';
import { slideDeckPagesSchema } from '../slides.ts';
import { id, limit, MutationError, name, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { changePresentation, insertItem } from './presentations.ts';

// ------------------------------------------------------------------ slideshows (Bildspel, docs/custom-slides.md)

/**
 * Every PDF page `pages` draw must be known where this runs, as a picture's blobs for `addImage`: on the server the
 * uploads recorded them, on the importing device the import did.
 */
async function requirePdfPages(tx: Tx, pages: CustomPage[]) {
  for (const hash of new Set(customPageBlobs(pages))) {
    const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, hash));
    if (!blob) throw new MutationError('media-missing', 'a page has not been uploaded');
  }
}

async function insertSlide(tx: Tx, a: { id: string; name: string; pages: CustomPage[]; at: number }) {
  const [existing] = await tx.select({ id: customSlides.id }).from(customSlides).where(eq(customSlides.id, a.id));
  if (existing) return; // a replay of a create that already landed
  const [n] = await tx.select({ n: count() }).from(customSlides).where(isNull(customSlides.deletedAt));
  limit((n?.n ?? 0) >= CUSTOM_LIMITS.slides, 'custom-slides');
  await requirePdfPages(tx, a.pages);
  await tx.insert(customSlides).values({ id: a.id, name: a.name, pages: JSON.stringify(a.pages), createdAt: a.at, updatedAt: a.at, deletedAt: null });
}

export const createCustomSlideArgs = z.object({ id, name, pages: customPagesSchema, at: z.number().int() });
/** A new slideshow in the library, made here or a PDF's, at most CUSTOM_LIMITS.slides of them, the trash not counted. */
export async function createCustomSlide(tx: Tx, a: z.output<typeof createCustomSlideArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await insertSlide(tx, a);
}

export const updateCustomSlideArgs = z.object({ id, name: name.optional(), pages: customPagesSchema.optional(), at: z.number().int() });
/** Its name, its pages (a new PDF's too), or both; the pages are written whole, so the last of two devices' saves wins them. */
export async function updateCustomSlide(tx: Tx, a: z.output<typeof updateCustomSlideArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  if (a.pages) await requirePdfPages(tx, a.pages);
  const set = { updatedAt: a.at, ...(a.name !== undefined ? { name: a.name } : {}), ...(a.pages !== undefined ? { pages: JSON.stringify(a.pages) } : {}) };
  await tx.update(customSlides).set(set).where(eq(customSlides.id, a.id));
}

export const trashCustomSlideArgs = z.object({ id, at: z.number().int() });
/** To the trash: items that show it keep showing it, as a trashed picture's do. */
export async function trashCustomSlide(tx: Tx, a: z.output<typeof trashCustomSlideArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.update(customSlides).set({ deletedAt: a.at }).where(eq(customSlides.id, a.id));
}

export const restoreCustomSlideArgs = z.object({ id });
export async function restoreCustomSlide(tx: Tx, a: z.output<typeof restoreCustomSlideArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await tx.update(customSlides).set({ deletedAt: null }).where(eq(customSlides.id, a.id));
}

export const purgeCustomSlideArgs = z.object({ id });
/** For good: only one in the trash. Items that named it say it is gone. */
export async function purgeCustomSlide(tx: Tx, a: z.output<typeof purgeCustomSlideArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [s] = await tx.select({ deletedAt: customSlides.deletedAt }).from(customSlides).where(eq(customSlides.id, a.id));
  if (!s) return;
  if (s.deletedAt === null) throw new MutationError('not-in-trash', 'custom slide is not in the trash');
  await tx.delete(customSlides).where(eq(customSlides.id, a.id));
}

export const addCustomSlideToPresentationArgs = z.object({ itemId: id, presentationId: id, slideId: id, afterItemId: id.nullable().optional() });
/** The slide as an item, a reference as a song is: it shows the slide as it is in the library now. */
export async function addCustomSlideToPresentation(tx: Tx, a: z.output<typeof addCustomSlideToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await changePresentation(tx, a.presentationId, ctx);
  const [s] = await tx.select({ name: customSlides.name }).from(customSlides).where(eq(customSlides.id, a.slideId));
  if (!s) throw new MutationError('not-found', 'custom slide not found');
  await insertItem(tx, a.afterItemId, { id: a.itemId, presentationId: a.presentationId, type: 'custom', title: s.name, sourceId: a.slideId, arrangementId: null, content: null });
}

export const addSlidesArgs = z.object({
  itemId: id,
  presentationId: id,
  /** The slideshow's id; the item's where it is not given (the builds before PDFs were in a library). */
  deckId: id.optional(),
  fileName: z.string().trim().min(1).max(MEDIA_LIMITS.fileName),
  /** Each page's two pictures, uploaded first (`PUT /media/{hash}`) and recorded in `media_blobs` where this runs. */
  pages: slideDeckPagesSchema,
  afterItemId: id.nullable().optional(),
  at: z.number().int().optional(),
});
/**
 * Imports a PDF into a presentation (Lägg till, PRES-R11): its pages become a slideshow of the library (`pdfPages`)
 * and an item names it, in one step. Named by the file.
 */
export async function addSlides(tx: Tx, a: z.output<typeof addSlidesArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await changePresentation(tx, a.presentationId, ctx);
  const slideId = a.deckId ?? a.itemId;
  await insertSlide(tx, { id: slideId, name: a.fileName, pages: pdfPages(a.pages), at: a.at ?? 0 });
  await insertItem(tx, a.afterItemId, { id: a.itemId, presentationId: a.presentationId, type: 'custom', title: a.fileName, sourceId: slideId, arrangementId: null, content: null });
}
