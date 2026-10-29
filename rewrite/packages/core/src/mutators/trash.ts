import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { can } from '../permissions.ts';
import { audios, images, presentationItems, presentations, songs } from '../schema.ts';
import { TRASH_RETENTION_MS } from '../trash.ts';
import type { MutatorCtx, Tx } from './base.ts';
import { deleteSongRows } from './songs.ts';

// ------------------------------------------------------------------ trash

export const purgeExpiredTrashArgs = z.object({ now: z.number().int() });
/**
 * Purges what has been in the trash longer than the retention (SONG-R28,
 * PRES-R26), of the kinds the caller manages. Sent when the trash opens. On
 * the server the earlier of the client's and the server's clock counts, so a
 * client clock that runs ahead never purges early.
 */
export async function purgeExpiredTrash(tx: Tx, a: z.output<typeof purgeExpiredTrashArgs>, ctx: MutatorCtx) {
  await purgeTrashedUntil(tx, Math.min(a.now, ctx.now ?? a.now) - TRASH_RETENTION_MS, ctx);
}

export const emptyTrashArgs = z.object({});
/** "Töm papperskorgen": everything in the trash of the kinds the caller manages, in one change (Trash.razor's EmptyAsync). */
export async function emptyTrash(tx: Tx, _a: z.output<typeof emptyTrashArgs>, ctx: MutatorCtx) {
  await purgeTrashedUntil(tx, Number.MAX_SAFE_INTEGER, ctx);
}

/** Purges what went to the trash at or before `cutoff`, of the kinds the caller manages. */
async function purgeTrashedUntil(tx: Tx, cutoff: number, ctx: MutatorCtx) {
  if (can(ctx.role, 'ManageSongs')) {
    const expired = await tx.select({ id: songs.id }).from(songs).where(and(isNotNull(songs.deletedAt), lte(songs.deletedAt, cutoff)));
    for (const s of expired) await deleteSongRows(tx, s.id);
  }
  // Presentations and templates are separate kinds, each purged by those who manage it (PRES-R24, R28).
  for (const [isTemplate, permission] of [
    [false, 'ManagePresentations'],
    [true, 'ManageTemplates'],
  ] as const) {
    if (!can(ctx.role, permission)) continue;
    const expired = await tx
      .select({ id: presentations.id })
      .from(presentations)
      .where(and(eq(presentations.isTemplate, isTemplate), isNotNull(presentations.deletedAt), lte(presentations.deletedAt, cutoff)));
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
