import { count, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { OVERLAY_LIMITS } from '../live.ts';
import { images, overlays, presentationItems } from '../schema.ts';
import { id, limit, MutationError, name, optionalText, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ overlays (spec 03 §4, spec 04 LIVE-R15)

/** A library picture, or not-found. A trashed one may be chosen: it still shows (MEDIA-R8). */
async function requireImage(tx: Tx, imageId: string | null | undefined) {
  if (!imageId) return;
  const [i] = await tx.select({ id: images.id }).from(images).where(eq(images.id, imageId));
  if (!i) throw new MutationError('not-found', 'image not found');
}

const overlayContent = optionalText(OVERLAY_LIMITS.content);

export const createOverlayArgs = z.object({ id, title: name, content: overlayContent.optional(), imageId: id.nullable().optional() });
/** Creates an overlay last in the list (PRES-R10: at most 200). */
export async function createOverlay(tx: Tx, a: z.output<typeof createOverlayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOverlays');
  const [existing] = await tx.select({ id: overlays.id }).from(overlays).where(eq(overlays.id, a.id));
  if (existing) return;
  const [n] = await tx.select({ n: count(), last: max(overlays.sort) }).from(overlays);
  limit((n?.n ?? 0) >= OVERLAY_LIMITS.overlays, 'overlays');
  await requireImage(tx, a.imageId);
  await tx.insert(overlays).values({ id: a.id, title: a.title, content: a.content ?? null, imageId: a.imageId ?? null, sort: (n?.last ?? -1) + 1 });
}

export const updateOverlayArgs = z.object({ id, title: name.optional(), content: overlayContent.optional(), imageId: id.nullable().optional() });
/** Sets only the fields it names, so a title and a text edited on two devices both land. */
export async function updateOverlay(tx: Tx, a: z.output<typeof updateOverlayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOverlays');
  await requireImage(tx, a.imageId);
  const { id: overlayId, ...fields } = a;
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) await tx.update(overlays).set(set).where(eq(overlays.id, overlayId));
}

export const deleteOverlayArgs = z.object({ id });
/** Permanent, no trash (PRES-R29). Items that carried it carry none. */
export async function deleteOverlay(tx: Tx, a: z.output<typeof deleteOverlayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOverlays');
  await tx.update(presentationItems).set({ overlayId: null }).where(eq(presentationItems.overlayId, a.id));
  await tx.delete(overlays).where(eq(overlays.id, a.id));
}
