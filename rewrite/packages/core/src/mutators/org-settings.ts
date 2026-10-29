import { z } from 'zod';
import { orgSettings } from '../schema.ts';
import { requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ remote control

export const REMOTE_CONTROL_SETTING = 'remoteControl';

/**
 * Remote control for the whole organisation (TODO.md "Remote control for the
 * whole organisation"): never, the presenter's own toggle (LIVE-R39), or always.
 */
export const remoteControlPolicySchema = z.enum(['never', 'presenter', 'always']);
export type RemoteControlPolicy = z.output<typeof remoteControlPolicySchema>;

/** The policy a stored value stands for; no row, or a value this build does not know, is the presenter's choice. */
export function remoteControlPolicy(value: string | null | undefined): RemoteControlPolicy {
  const parsed = remoteControlPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : 'presenter';
}

/** Whether a session may be driven: the policy first, the window's toggle only when the policy leaves it to the presenter. */
export function remoteControlAllowed(policy: RemoteControlPolicy, toggle: boolean): boolean {
  return policy === 'always' || (policy === 'presenter' && toggle);
}

/** The pushes after which the live hub tells everyone again whether each session may be driven. */
export const REMOTE_CONTROL_MUTATORS: readonly string[] = ['setRemoteControl'];

export const setRemoteControlArgs = z.object({ policy: remoteControlPolicySchema });
/** The organisation's remote control policy: the live hub applies it at once, whatever a window reports. */
export async function setRemoteControl(tx: Tx, a: z.output<typeof setRemoteControlArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOrganizationSettings');
  await tx
    .insert(orgSettings)
    .values({ id: REMOTE_CONTROL_SETTING, value: a.policy })
    .onConflictDoUpdate({ target: orgSettings.id, set: { value: a.policy } });
}
