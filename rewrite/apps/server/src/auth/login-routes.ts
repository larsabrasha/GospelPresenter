// The caller's own logins and session, and looking up an invite.
import type { Hono } from 'hono';
import { LOGIN_PROVIDERS, renameLoginRequest, type Me } from '@gp/core';
import { body, fail, type AuthKit } from './kit.ts';

export function loginRoutes(app: Hono, kit: AuthKit) {
  const { accounts, withCaller } = kit;

  // -------------------------------------------------------------- your own logins (never another user's: no user id is taken)

  app.get(
    '/api/auth/logins',
    withCaller(null, async (c, caller) => c.json(await accounts.logins(caller.ctx.userId))),
  );

  app.patch(
    '/api/auth/logins/passkey/:id',
    withCaller(null, async (c, caller) => {
      const a = await body(c, renameLoginRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      return (await accounts.renamePasskey(caller.ctx.userId, c.req.param('id')!, a.name)) ? c.json({ ok: true }) : fail(c, 404, 'not-found');
    }),
  );

  /** Removes one of your own logins, never the last one: then only an admin's new invite would let you in. */
  app.delete(
    '/api/auth/logins/:provider/:id',
    withCaller(null, async (c, caller) => {
      // A paired device was signed in by whoever paired it, not by the user: it does not manage their logins.
      if (caller.paired) return fail(c, 403, 'forbidden');
      const provider = c.req.param('provider')!;
      if (!(LOGIN_PROVIDERS as readonly string[]).includes(provider)) return fail(c, 404, 'not-found');
      const r = await accounts.removeLogin(caller.ctx.userId, provider, c.req.param('id')!);
      return r === 'ok' ? c.json({ ok: true }) : r === 'last-login' ? fail(c, 409, 'last-login') : fail(c, 404, 'not-found');
    }),
  );

  app.post(
    '/api/auth/signout',
    withCaller(null, async (c, caller) => {
      await accounts.revokeSession(caller.sessionId);
      return c.json({ ok: true });
    }),
  );

  app.get(
    '/api/auth/me',
    withCaller(null, async (c, caller) => {
      const me: Me | null = await accounts.me({ sessionId: caller.sessionId, userId: caller.ctx.userId, orgId: caller.orgId, role: caller.ctx.role });
      return me ? c.json(me) : fail(c, 401, 'unauthenticated');
    }),
  );

  // -------------------------------------------------------------- invites (the token travels in a body, not a URL)

  app.post('/api/auth/invites/lookup', async (c) => {
    const token = (await c.req.json().catch(() => null))?.token;
    return c.json(await accounts.invite(typeof token === 'string' ? token : ''));
  });
}
