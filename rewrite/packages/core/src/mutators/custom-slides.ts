import { count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { CUSTOM_LIMITS, customPagesSchema } from '../custom-slides.ts';
import { customSlides } from '../schema.ts';
import { id, limit, MutationError, name, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { changePresentation, insertItem } from './presentations.ts';

// ------------------------------------------------------------------ custom slides (docs/custom-slides.md)

/** The pages as stored: written whole, as the editor saves them. */
const pages = customPagesSchema.transform((p) => JSON.stringify(p));

export const createCustomSlideArgs = z.object({ id, name, pages, at: z.number().int() });
/** A new slide in the library, at most CUSTOM_LIMITS.slides of them, the trash not counted. */
export async function createCustomSlide(tx: Tx, a: z.output<typeof createCustomSlideArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const [existing] = await tx.select({ id: customSlides.id }).from(customSlides).where(eq(customSlides.id, a.id));
  if (existing) return; // a replay of a create that already landed
  const [n] = await tx.select({ n: count() }).from(customSlides).where(isNull(customSlides.deletedAt));
  limit((n?.n ?? 0) >= CUSTOM_LIMITS.slides, 'custom-slides');
  await tx.insert(customSlides).values({ id: a.id, name: a.name, pages: a.pages, createdAt: a.at, updatedAt: a.at, deletedAt: null });
}

export const updateCustomSlideArgs = z.object({ id, name: name.optional(), pages: pages.optional(), at: z.number().int() });
/** Its name, its pages, or both; the pages are written whole, so the last of two devices' saves wins them. */
export async function updateCustomSlide(tx: Tx, a: z.output<typeof updateCustomSlideArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const set = { updatedAt: a.at, ...(a.name !== undefined ? { name: a.name } : {}), ...(a.pages !== undefined ? { pages: a.pages } : {}) };
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
