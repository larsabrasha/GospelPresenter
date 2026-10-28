// Pairing a device with a desktop host: the status anyone may ask for, and,
// on a host, claiming a code, making codes and managing paired devices.
import type { Context, Hono } from 'hono';
import { ACCOUNT_LIMITS, inviteRefusal, pairClaimRequest, pairCodeRequest, type PairClaimResponse, type PairStatus } from '@gp/core';
import { newDigits } from '../crypto.ts';
import { THROTTLE } from '../global/index.ts';
import type { Caller } from './caller.ts';
import { body, fail, type AuthKit } from './kit.ts';
import { deviceOf } from './pairing-guard.ts';

export function pairingRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, tooMany, signedIn, withCaller, target, actor } = kit;

  // -------------------------------------------------------------- pairing

  const pairing = deps.pairing;
  app.get('/api/pair/status', async (c) => {
    const device = pairing ? await deviceOf(c.req.raw, accounts, pairing) : null;
    return c.json({ required: !!pairing, paired: !!device, host: device === 'host' } satisfies PairStatus);
  });

  if (pairing) {
    /** The code buys the device its token and a session as the user the host chose: on a host, pairing is how a device signs in. */
    app.post('/api/pair/claim', async (c) => {
      const a = await body(c, pairClaimRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const address = `address:${deps.clientAddress(c)}`;
      const locked = await accounts.lockedUntil([address]);
      if (locked) return tooMany(c, locked);
      const claimed = await accounts.claimPairCode(a.code, a.name, ACCOUNT_LIMITS.pairCodeAttempts);
      if (!claimed) {
        await accounts.fail(address, THROTTLE.address);
        return fail(c, 400, 'pair-code-invalid');
      }
      const session = await signedIn(claimed.userId, claimed.orgId, a.name, claimed.deviceId);
      if (!session) {
        // The user was removed while the code waited.
        await accounts.revokeDevice(claimed.deviceId);
        return fail(c, 400, 'pair-code-invalid');
      }
      return c.json({ device: claimed.token, session } satisfies PairClaimResponse);
    });

    /** Only the host's own window, signed in with ManageUsers: whoever pairs a device is at the host. */
    const atHost = (fn: (c: Context, caller: Caller) => Promise<Response>) =>
      withCaller('ManageUsers', async (c, caller) => ((await deviceOf(c.req.raw, accounts, pairing)) === 'host' ? fn(c, caller) : fail(c, 403, 'forbidden')));

    /** A code that signs the device in as a member: the caller, or someone they may make an invite for (D20, D21). */
    app.post(
      '/api/pair/code',
      atHost(async (c, caller) => {
        const a = await body(c, pairCodeRequest);
        if (!a) return fail(c, 400, 'invalid-request');
        const t = await target(caller, a.userId ?? caller.ctx.userId);
        if (!t) return fail(c, 404, 'not-found');
        const refusal = inviteRefusal(actor(caller), t);
        if (refusal) return fail(c, 403, refusal);
        const code = newDigits(6);
        return c.json({ code, expiresAt: await accounts.newPairCode(code, ACCOUNT_LIMITS.pairCodeTtlMs, t.id, caller.orgId) });
      }),
    );
    app.get(
      '/api/pair/devices',
      atHost(async (c) => c.json(await accounts.pairedDevices())),
    );
    app.delete(
      '/api/pair/devices/:id',
      atHost(async (c) => ((await accounts.revokeDevice(c.req.param('id')!)) ? c.json({ ok: true }) : fail(c, 404, 'not-found'))),
    );
  }
}
