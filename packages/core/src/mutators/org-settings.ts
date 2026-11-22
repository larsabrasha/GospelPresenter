import { z } from 'zod';
import { REMOTE_CONTROL_SETTING } from '../mutation.ts';
import { orgSettings } from '../schema.ts';
import { requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ remote control

const remoteControlPolicySchema = z.enum(['never', 'presenter', 'always']);

export const setRemoteControlArgs = z.object({ policy: remoteControlPolicySchema });
/** The organisation's remote control policy: the live hub applies it at once, whatever a window reports. */
export async function setRemoteControl(tx: Tx, a: z.output<typeof setRemoteControlArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOrganizationSettings');
  await tx
    .insert(orgSettings)
    .values({ id: REMOTE_CONTROL_SETTING, value: a.policy })
    .onConflictDoUpdate({ target: orgSettings.id, set: { value: a.policy } });
}
