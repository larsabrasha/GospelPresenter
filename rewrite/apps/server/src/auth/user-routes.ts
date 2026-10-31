// The organisation's users: list, create, one user (the detail page), change
// name, e-mail and role, remove, invite, and an admin's view of a user's logins.
import type { Hono } from 'hono';
import { createUserRefusal, createUserRequest, inviteRefusal, removeUserRefusal, roleChangeRefusal, updateUserRequest, userEditRefusal } from '@gp/core';
import { inviteLink, inviteMail } from '../mail.ts';
import { body, fail, type AuthKit } from './kit.ts';

export function userRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, withCaller, target, actor, log } = kit;

  // -------------------------------------------------------------- the organisation's users

  app.get(
    '/api/users',
    withCaller('ViewUsers', async (c, caller) => c.json(await accounts.members.listUsers(caller.orgId))),
  );

  app.post(
    '/api/users',
    withCaller('ManageUsers', async (c, caller) => {
      const a = await body(c, createUserRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const refusal = createUserRefusal(caller.ctx.role, a.role);
      if (refusal) return fail(c, 403, refusal);
      const r = await accounts.members.createUser(caller.orgId, a);
      if (typeof r === 'string') return fail(c, 409, r);
      return c.json(r);
    }),
  );

  app.get(
    '/api/users/:id',
    withCaller('ViewUsers', async (c, caller) => {
      const u = await accounts.members.user(c.req.param('id')!, caller.orgId);
      return u ? c.json(u) : fail(c, 404, 'not-found');
    }),
  );

  // Every field given is checked before any is written, so a refused role leaves the name as it was.
  app.patch(
    '/api/users/:id',
    withCaller('ManageUsers', async (c, caller) => {
      const a = await body(c, updateUserRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      const refusal =
        (a.role !== undefined ? roleChangeRefusal(actor(caller), t, a.role) : null) ??
        (a.name !== undefined || a.email !== undefined ? userEditRefusal(actor(caller), t) : null);
      if (refusal) return fail(c, 403, refusal);
      if (a.name !== undefined || a.email !== undefined) {
        if ((await accounts.members.updateUser(t.id, { name: a.name, email: a.email })) === 'email-taken') return fail(c, 409, 'email-taken');
      }
      if (a.role !== undefined) await accounts.members.setRole(t.id, caller.orgId, a.role);
      return c.json({ ok: true });
    }),
  );

  app.delete(
    '/api/users/:id',
    withCaller('ManageUsers', async (c, caller) => {
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      const refusal = removeUserRefusal(actor(caller), t);
      if (refusal) return fail(c, 403, refusal);
      await accounts.members.removeMember(t.id, caller.orgId);
      return c.json({ ok: true });
    }),
  );

  app.post(
    '/api/users/:id/invites',
    withCaller('ManageUsers', async (c, caller) => {
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      const refusal = inviteRefusal(actor(caller), t);
      if (refusal) return fail(c, 403, refusal);
      const token = await accounts.members.createInvite(t.id, caller.orgId);
      if (token === 'limit') return fail(c, 409, 'limit');
      return c.json({ inviteToken: token });
    }),
  );

  /** A new invite, mailed to the user's e-mail address ("Skicka via e-post"); its token is answered too, as for one made here. */
  app.post(
    '/api/users/:id/invites/email',
    withCaller('ManageUsers', async (c, caller) => {
      const mail = deps.mail;
      if (!mail) return fail(c, 503, 'mail-disabled');
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      const refusal = inviteRefusal(actor(caller), t);
      if (refusal) return fail(c, 403, refusal);
      const user = await accounts.members.user(t.id, caller.orgId);
      if (!user?.email) return fail(c, 409, 'no-email');
      const token = await accounts.members.createInvite(t.id, caller.orgId);
      if (token === 'limit') return fail(c, 409, 'limit');
      const me = await accounts.members.me({ sessionId: caller.sessionId, userId: caller.ctx.userId, orgId: caller.orgId, role: caller.ctx.role });
      try {
        await mail.mailer.send(inviteMail('invite', { to: user.email, name: user.name, orgName: me?.orgName ?? '', link: inviteLink(mail.appUrl, token) }));
      } catch (e) {
        log({ event: 'mail-failed', reason: String(e) });
        return fail(c, 503, 'mail-failed');
      }
      return c.json({ inviteToken: token });
    }),
  );

  app.delete(
    '/api/users/:id/invites',
    withCaller('ManageUsers', async (c, caller) => {
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      const refusal = inviteRefusal(actor(caller), t);
      if (refusal) return fail(c, 403, refusal);
      await accounts.members.deleteInvites(t.id, caller.orgId);
      return c.json({ ok: true });
    }),
  );

  // -------------------------------------------------------------- a user's logins, for an admin (D21)

  app.get(
    '/api/users/:id/logins',
    withCaller('ViewUsers', async (c, caller) => {
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      return c.json(await accounts.logins.list(t.id));
    }),
  );

  // Your own last login stays, as under Inloggningsmetoder; another user's may go (spec 01 E9: a new invite lets them back).
  app.delete(
    '/api/users/:id/logins/:provider/:login',
    withCaller('ManageUsers', async (c, caller) => {
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      const refusal = userEditRefusal(actor(caller), t);
      if (refusal) return fail(c, 403, refusal);
      const { provider, login } = c.req.param() as { provider: string; login: string };
      const r = t.id === caller.ctx.userId ? await accounts.logins.remove(t.id, provider, login) : await accounts.logins.removeOthers(t.id, provider, login);
      if (r === 'not-found') return fail(c, 404, 'not-found');
      if (r === 'last-login') return fail(c, 409, 'last-login');
      return c.json({ ok: true });
    }),
  );
}
