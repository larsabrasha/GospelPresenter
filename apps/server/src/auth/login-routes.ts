// The caller's own logins and session, and looking up an invite.
import type { Hono } from 'hono';
import { LOGIN_PROVIDERS, recoverRequest, renameLoginRequest, type Me } from '@gp/core';
import { THROTTLE } from '../global/index.ts';
import { inviteLink, inviteMail } from '../mail.ts';
import { body, fail, type AuthKit } from './kit.ts';

export function loginRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, withCaller, tooMany, inBackground } = kit;

  // -------------------------------------------------------------- your own logins (never another user's: no user id is taken)

  app.get(
    '/api/auth/logins',
    withCaller(null, async (c, caller) => c.json(await accounts.logins.list(caller.ctx.userId))),
  );

  app.patch(
    '/api/auth/logins/passkey/:id',
    withCaller(null, async (c, caller) => {
      const a = await body(c, renameLoginRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      return (await accounts.logins.renamePasskey(caller.ctx.userId, c.req.param('id')!, a.name)) ? c.json({ ok: true }) : fail(c, 404, 'not-found');
    }),
  );

  /** Removes one of your own logins, never the last one: then only a reset link would let you in. */
  app.delete(
    '/api/auth/logins/:provider/:id',
    withCaller(null, async (c, caller) => {
      // A paired device was signed in by whoever paired it, not by the user: it does not manage their logins.
      if (caller.paired) return fail(c, 403, 'forbidden');
      const provider = c.req.param('provider')!;
      if (!(LOGIN_PROVIDERS as readonly string[]).includes(provider)) return fail(c, 404, 'not-found');
      const r = await accounts.logins.remove(caller.ctx.userId, provider, c.req.param('id')!);
      return r === 'ok' ? c.json({ ok: true }) : r === 'last-login' ? fail(c, 409, 'last-login') : fail(c, 404, 'not-found');
    }),
  );

  app.post(
    '/api/auth/signout',
    withCaller(null, async (c, caller) => {
      await accounts.members.revokeSession(caller.sessionId);
      return c.json({ ok: true });
    }),
  );

  app.get(
    '/api/auth/me',
    withCaller(null, async (c, caller) => {
      const me: Me | null = await accounts.members.me({ sessionId: caller.sessionId, userId: caller.ctx.userId, orgId: caller.orgId, role: caller.ctx.role });
      return me ? c.json(me) : fail(c, 401, 'unauthenticated');
    }),
  );

  // -------------------------------------------------------------- invites (the token travels in a body, not a URL)

  /** What a link is: an invitation, or a reset link. */
  app.post('/api/auth/invites/lookup', async (c) => {
    const raw = (await c.req.json().catch(() => null))?.token;
    const token = typeof raw === 'string' ? raw : '';
    return c.json((await accounts.invitations.lookup(token)) ?? (await accounts.members.invite(token)));
  });

  /**
   * "Glömt hur du loggar in?" (decided on 2026-10-31): a reset link to the user who has confirmed this address, which
   * they use with Google or a new passkey. The answer is the same whether the address has an account or not; every ask
   * counts against the address it came from and the e-mail address it names.
   */
  app.post('/api/auth/recover', async (c) => {
    const mail = deps.mail;
    if (!mail) return fail(c, 503, 'mail-disabled');
    const a = await body(c, recoverRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const keys = [`recover:${deps.clientAddress(c)}`, `recover-email:${a.email}`];
    const locked = await accounts.throttle.count(keys, THROTTLE.recover);
    if (locked) return tooMany(locked);
    inBackground(c, async () => {
      const user = await accounts.members.userByEmail(a.email);
      if (!user) return;
      const token = await accounts.members.createInvite(user.id, user.orgId);
      if (token === 'limit') return;
      await mail.mailer.send(inviteMail('recovery', { to: a.email, name: user.name, orgName: user.orgName, link: inviteLink(mail.appUrl, token) }, a.language));
    });
    return c.json({ ok: true });
  });
}
