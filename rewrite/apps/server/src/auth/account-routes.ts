// Your own account (docs/accounts-and-roles.md): your name and address under Mina inställningar, the link that
// confirms an address, and superadminläge.
import type { Hono } from 'hono';
import { ACCOUNT_LIMITS, changeEmailRequest, confirmEmailRequest, superModeRequest, updateMeRequest, type ChangeEmailResponse, type SuperModeResponse } from '@gp/core';
import { THROTTLE } from '../global/index.ts';
import { confirmEmailLink, emailMail } from '../mail.ts';
import { credentials } from './caller.ts';
import { body, fail, type AuthKit } from './kit.ts';

export function accountRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, withCaller, tooMany, inBackground, fresh } = kit;

  app.patch(
    '/api/auth/me',
    withCaller(null, async (c, caller) => {
      const a = await body(c, updateMeRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      if (caller.paired) return fail(c, 403, 'forbidden');
      await accounts.members.updateUser(caller.ctx.userId, { name: a.name });
      return c.json({ ok: true });
    }),
  );

  /**
   * A new address, or yours as it is to confirm it: a link goes to it, and the address becomes yours, confirmed, when
   * the link is opened. When another account has confirmed it, the mail says someone tried instead; the answer is the
   * same, and comes before the mail goes. Without mail (a desktop host) the address is set at once, unconfirmed.
   */
  app.post(
    '/api/auth/email',
    withCaller(null, async (c, caller) => {
      const a = await body(c, changeEmailRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      if (caller.paired) return fail(c, 403, 'forbidden');
      const mail = deps.mail;
      if (!mail) {
        await accounts.members.updateUser(caller.ctx.userId, { email: a.email });
        return c.json({ changed: true } satisfies ChangeEmailResponse);
      }
      const keys = [`email:${deps.clientAddress(c)}`, `email-to:${a.email}`];
      const locked = await accounts.throttle.count(keys, THROTTLE.recover);
      if (locked) return tooMany(locked);
      const me = await accounts.members.me({ sessionId: caller.sessionId, userId: caller.ctx.userId, orgId: caller.orgId, role: caller.ctx.role });
      inBackground(c, async () => {
        const token = await accounts.emails.startConfirm(caller.ctx.userId, a.email);
        await mail.mailer.send(emailMail({ to: a.email, name: me?.name ?? '', link: token && confirmEmailLink(mail.appUrl, token), appUrl: mail.appUrl }, a.language));
      });
      return c.json({ sent: true } satisfies ChangeEmailResponse);
    }),
  );

  /** The confirming link's page sends its token here; it needs no session, since the link may be opened anywhere. */
  app.post('/api/auth/email/confirm', async (c) => {
    const a = await body(c, confirmEmailRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const r = await accounts.emails.confirm(a.token);
    if (r === 'invalid') return fail(c, 400, 'invite-invalid');
    if (r === 'email-taken') return fail(c, 409, 'email-taken');
    return c.json({ ok: true });
  });

  /**
   * Superadminläge, as GitLab's admin mode: a Superadmin's powers wait behind it. A sign-in of their own from the last
   * few minutes turns it on, for an hour; turning it off in an organisation they are not a member of takes them home.
   * The session is read here rather than through `withCaller`: once the hour is up in such an organisation the session
   * has no role there, and turning it off must still take them home.
   */
  app.post('/api/auth/superadmin', async (c) => {
    const { token } = credentials(c.req.raw);
    const s = token ? await accounts.members.session(token) : null;
    if (!s) return fail(c, 401, 'unauthenticated');
    const a = await body(c, superModeRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const userId = s.userId;
    if (!(await accounts.members.isSuperAdmin(userId))) return fail(c, 403, 'forbidden');
    if (a.on) {
      if (!fresh({ paired: s.paired, signedInAt: s.createdAt })) return fail(c, 403, 'reauth-required');
      await accounts.members.setSuperMode(s.sessionId, accounts.now() + ACCOUNT_LIMITS.superModeMs);
      const me = await accounts.members.me({ sessionId: s.sessionId, userId, orgId: s.orgId, role: 'superAdmin' });
      return me ? c.json({ me } satisfies SuperModeResponse) : fail(c, 404, 'not-found');
    }
    await accounts.members.setSuperMode(s.sessionId, null);
    const role = await accounts.members.roleIn(userId, s.orgId);
    if (role) {
      const me = await accounts.members.me({ sessionId: s.sessionId, userId, orgId: s.orgId, role });
      return me ? c.json({ me } satisfies SuperModeResponse) : fail(c, 404, 'not-found');
    }
    const home = await accounts.signIn.signedInAs(userId);
    if (home === 'not-a-member') return fail(c, 403, 'not-a-member');
    const moved = await accounts.members.switchOrg(s.sessionId, userId, home.orgId);
    if (moved === 'not-a-member') return fail(c, 403, 'not-a-member');
    await accounts.members.revokeSession(s.sessionId);
    const me = await accounts.members.me({ sessionId: moved.sessionId, userId, orgId: home.orgId, role: (await accounts.members.roleIn(userId, home.orgId))! });
    return me ? c.json({ token: moved.token, me } satisfies SuperModeResponse) : fail(c, 404, 'not-found');
  });
}
