import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DISPLAY_CODE, MAX_DISPLAYS } from '../displays.ts';
import { displays } from '../schema.ts';
import { id, limit, MutationError, name, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ outputs (spec 04 §7)

const displayCode = z.string().regex(DISPLAY_CODE);

async function requireFreeCode(tx: Tx, code: string, exceptId: string | null) {
  const [taken] = await tx.select({ id: displays.id }).from(displays).where(eq(displays.code, code));
  if (taken && taken.id !== exceptId) throw new MutationError('code-taken', 'the code is in use');
}

export const createDisplayArgs = z.object({ id, name, code: displayCode, kind: z.enum(['public', 'screen']) });
/** Creates an output (LIVE-R30). The code comes from the caller; the server registers it globally after the push. */
export async function createDisplay(tx: Tx, a: z.output<typeof createDisplayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageRemoteDisplays');
  const [existing] = await tx.select({ id: displays.id }).from(displays).where(eq(displays.id, a.id));
  if (existing) return;
  const [n] = await tx.select({ n: count() }).from(displays);
  limit((n?.n ?? 0) >= MAX_DISPLAYS, 'outputs');
  await requireFreeCode(tx, a.code, null);
  await tx.insert(displays).values({ id: a.id, name: a.name, code: a.code, kind: a.kind });
}

export const newDisplayCodeArgs = z.object({ id, code: displayCode });
/** "Ny kod": the old code stops working at once, and everyone watching is disconnected (spec 04 §7). */
export async function newDisplayCode(tx: Tx, a: z.output<typeof newDisplayCodeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageRemoteDisplays');
  await requireFreeCode(tx, a.code, a.id);
  await tx.update(displays).set({ code: a.code }).where(eq(displays.id, a.id));
}

export const deleteDisplayArgs = z.object({ id });
/** No trash (spec 04 §7). A no-op if it is gone. */
export async function deleteDisplay(tx: Tx, a: z.output<typeof deleteDisplayArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageRemoteDisplays');
  await tx.delete(displays).where(eq(displays.id, a.id));
}

/** The mutators that change which codes an organisation has: after a push with one, the server registers them. */
export const DISPLAY_MUTATORS: readonly string[] = ['createDisplay', 'newDisplayCode', 'deleteDisplay'];
