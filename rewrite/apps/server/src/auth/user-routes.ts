// The organisation's users: list, one user (the detail page), their role, removing them, and what only a Superadmin
// may do to someone else's account (docs/accounts-and-roles.md): their name and address, their logins, and a link
// that replaces their logins (on a desktop host also an Admin, for someone whose only membership is the host's).
import type { Context, Hono } from 'hono';
import { accountRefusal, createUserRequest, mailInviteRequest, removeUserRefusal, roleChangeRefusal, updateUserRequest } from '@gp/core';
import type { Caller } from './caller.ts';
import { inviteLink, inviteMail } from '../mail.ts';
import { body, fail, type AuthKit } from './kit.ts';

/** What the Superadmins' log records. */
type AuditAction = 'account-changed' | 'reset-link' | 'login-removed';

export function userRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, withCaller, target, actor, mayMakeAdmin, log } = kit;

  /** The member `:id`, and why the caller may not change their account (null if they may). */
  async function account(c: Context, caller: Caller) {
    const t = await target(caller, c.req.param('id')!);
    if (!t) return null;
    const refusal = t.id === caller.ctx.userId ? null : accountRefusal(actor(caller), { hostOnly: !!deps.pairing && t.hostOnly, superAdmin: t.superAdmin });
    return { t, refusal };
  }

  /** Logs what a Superadmin did to someone else's account. */
  const audit = (caller: Caller, action: AuditAction, targetId: string, detail: string | null = null) =>
    caller.ctx.role === 'superAdmin' && targetId !== caller.ctx.userId ? accounts.emails.audit(caller.ctx.userId, action, targetId, caller.orgId, detail) : Promise.resolve();

  app.get(
    '/api/users',
    withCaller('ViewUsers', async (c, caller) => c.json(await accounts.members.listUsers(caller.orgId))),
  );

  /** A person at a desktop host, to pair devices as (`createUserRequest`); elsewhere people are invited. */
  app.post(
    '/api/users',
    withCaller('ManageUsers', async (c, caller) => {
      if (!deps.pairing) return fail(c, 403, 'forbidden');
      const a = await body(c, createUserRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      if (a.role === 'admin' && !(await mayMakeAdmin(c, caller))) return fail(c, 403, 'reauth-required');
      const r = await accounts.members.createLocalUser(caller.orgId, { name: a.name, email: a.email ?? null, role: a.role });
      return r === 'limit' ? fail(c, 409, 'limit') : c.json(r);
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
        (a.role !== undefined ? roleChangeRefusal(actor(caller), t, a.role, await accounts.members.adminCount(caller.orgId)) : null) ??
        // Your own name and address are under Mina inställningar; someone else's only in superadminläge.
        (a.name !== undefined || a.email !== undefined ? (caller.ctx.role === 'superAdmin' ? null : 'super-admin-only') : null);
      if (refusal) return fail(c, 403, refusal);
      // Making someone Admin hands out power: it asks for a sign-in of your own from the last few minutes.
      if (a.role === 'admin' && t.role !== 'admin' && !(await mayMakeAdmin(c, caller))) return fail(c, 403, 'reauth-required');
      if (a.name !== undefined || a.email !== undefined) {
        await accounts.members.updateUser(t.id, { name: a.name, email: a.email });
        await audit(caller, 'account-changed', t.id, [a.name !== undefined && 'name', a.email !== undefined && 'email'].filter(Boolean).join(','));
      }
      if (a.role !== undefined && (await accounts.members.setRole(t.id, caller.orgId, a.role)) === 'last-admin') return fail(c, 403, 'last-admin');
      return c.json({ ok: true });
    }),
  );

  app.delete(
    '/api/users/:id',
    withCaller('ManageUsers', async (c, caller) => {
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      const refusal = removeUserRefusal(actor(caller), t, await accounts.members.adminCount(caller.orgId));
      if (refusal) return fail(c, 403, refusal);
      if ((await accounts.members.removeMember(t.id, caller.orgId)) === 'last-admin') return fail(c, 403, 'last-admin');
      return c.json({ ok: true });
    }),
  );

  // -------------------------------------------------------------- a link that replaces someone's logins

  app.post(
    '/api/users/:id/invites',
    withCaller('ManageUsers', async (c, caller) => {
      const r = await account(c, caller);
      if (!r) return fail(c, 404, 'not-found');
      if (r.refusal) return fail(c, 403, r.refusal);
      const token = await accounts.members.createInvite(r.t.id, caller.orgId);
      if (token === 'limit') return fail(c, 409, 'limit');
      await audit(caller, 'reset-link', r.t.id);
      return c.json({ inviteToken: token });
    }),
  );

  /** A new reset link, mailed to the user's address ("Skicka via e-post"); its token is answered too, as for one made here. */
  app.post(
    '/api/users/:id/invites/email',
    withCaller('ManageUsers', async (c, caller) => {
      const mail = deps.mail;
      if (!mail) return fail(c, 503, 'mail-disabled');
      const r = await account(c, caller);
      if (!r) return fail(c, 404, 'not-found');
      if (r.refusal) return fail(c, 403, r.refusal);
      const user = await accounts.members.user(r.t.id, caller.orgId);
      if (!user?.email) return fail(c, 409, 'no-email');
      const token = await accounts.members.createInvite(r.t.id, caller.orgId);
      if (token === 'limit') return fail(c, 409, 'limit');
      await audit(caller, 'reset-link', r.t.id, 'mailed');
      const me = await accounts.members.me({ sessionId: caller.sessionId, userId: caller.ctx.userId, orgId: caller.orgId, role: caller.ctx.role });
      try {
        await mail.mailer.send(inviteMail('reset', { to: user.email, name: user.name, orgName: me?.orgName ?? '', link: inviteLink(mail.appUrl, token) }, (await body(c, mailInviteRequest))?.language));
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
      const r = await account(c, caller);
      if (!r) return fail(c, 404, 'not-found');
      if (r.refusal) return fail(c, 403, r.refusal);
      await accounts.members.deleteInvites(r.t.id, caller.orgId);
      return c.json({ ok: true });
    }),
  );

  // -------------------------------------------------------------- someone's logins, for a Superadmin (or a host's Admin)

  app.get(
    '/api/users/:id/logins',
    withCaller('ViewUsers', async (c, caller) => {
      const r = await account(c, caller);
      if (!r) return fail(c, 404, 'not-found');
      if (r.refusal) return fail(c, 403, r.refusal);
      return c.json(await accounts.logins.list(r.t.id));
    }),
  );

  // Your own last login stays, as under Inloggningsmetoder; another user's may go (spec 01 E9: a reset link lets them back).
  app.delete(
    '/api/users/:id/logins/:provider/:login',
    withCaller('ManageUsers', async (c, caller) => {
      const r = await account(c, caller);
      if (!r) return fail(c, 404, 'not-found');
      if (r.refusal) return fail(c, 403, r.refusal);
      if (caller.paired) return fail(c, 403, 'forbidden');
      const { provider, login } = c.req.param() as { provider: string; login: string };
      const res = r.t.id === caller.ctx.userId ? await accounts.logins.remove(r.t.id, provider, login) : await accounts.logins.removeOthers(r.t.id, provider, login);
      if (res === 'not-found') return fail(c, 404, 'not-found');
      if (res === 'last-login') return fail(c, 409, 'last-login');
      await audit(caller, 'login-removed', r.t.id, provider);
      return c.json({ ok: true });
    }),
  );
}
