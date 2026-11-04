import { count, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { blankPage, customPageSchema } from '../custom-slides.ts';
import { OVERLAY_LIMITS } from '../live.ts';
import { overlays, presentationItems } from '../schema.ts';
import { id, limit, name, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ overlays (docs/custom-slides.md, spec 04 LIVE-R15)

/** An overlay's page, as stored: a custom slide's page, its background none. */
const page = customPageSchema.transform((p) => JSON.stringify({ ...p, background: null, backgroundImageId: null }));

export const createOverlayArgs = z.object({ id, title: name, page: page.optional(), at: z.number().int() });
/** Creates an overlay last in the list, a blank page unless one is given (PRES-R10: at most 200). */
export async function createOverlay(tx: Tx, a: z.output<typeof createOverlayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOverlays');
  const [existing] = await tx.select({ id: overlays.id }).from(overlays).where(eq(overlays.id, a.id));
  if (existing) return;
  const [n] = await tx.select({ n: count(), last: max(overlays.sort) }).from(overlays);
  limit((n?.n ?? 0) >= OVERLAY_LIMITS.overlays, 'overlays');
  await tx.insert(overlays).values({ id: a.id, title: a.title, content: a.page ?? JSON.stringify(blankPage()), imageId: null, sort: (n?.last ?? -1) + 1, updatedAt: a.at });
}

export const updateOverlayArgs = z.object({ id, title: name.optional(), page: page.optional(), at: z.number().int() });
/** Its name, its page, or both; the page is written whole, as a custom slide's pages are. */
export async function updateOverlay(tx: Tx, a: z.output<typeof updateOverlayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOverlays');
  const set = { updatedAt: a.at, ...(a.title !== undefined ? { title: a.title } : {}), ...(a.page !== undefined ? { content: a.page } : {}) };
  await tx.update(overlays).set(set).where(eq(overlays.id, a.id));
}

export const deleteOverlayArgs = z.object({ id });
/** Permanent, no trash (PRES-R29). Items that carried it carry none. */
export async function deleteOverlay(tx: Tx, a: z.output<typeof deleteOverlayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOverlays');
  await tx.update(presentationItems).set({ overlayId: null }).where(eq(presentationItems.overlayId, a.id));
  await tx.delete(overlays).where(eq(overlays.id, a.id));
}
