import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { songs } from '../schema.ts';
import { id, MutationError, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ test probe

export const probeArgs = z.object({ songId: id });
/**
 * Writes, awaits more reads, then always throws, so it never changes anything.
 * The sync tests use it to prove that a mutator's earlier writes are rolled
 * back on every database.
 */
export async function probeWriteThenThrow(tx: Tx, a: z.output<typeof probeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.insert(songs).values({ id: a.songId, name: 'should never be seen' });
  await tx.select().from(songs).where(eq(songs.id, a.songId));
  await tx.update(songs).set({ name: 'still never seen' }).where(eq(songs.id, a.songId));
  throw new MutationError('probe-failure', 'thrown after writing');
}
