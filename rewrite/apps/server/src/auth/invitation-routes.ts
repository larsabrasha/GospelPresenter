// Invitations (docs/accounts-and-roles.md): Användare → Bjud in, the list of those not yet accepted, withdrawing one,
// and the users a 1.x import brings, who are invited rather than given accounts.
import type { Hono } from 'hono';
import { ACCOUNT_LIMITS, inviteRequest, legacyUsersSchema, type InvitationResponse } from '@gp/core';
import type { LegacyUserOutcome } from '../global/legacy-users.ts';
import { inviteLink, inviteMail } from '../mail.ts';
import { body, fail, type AuthKit } from './kit.ts';

export function invitationRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, withCaller, mayMakeAdmin, log } = kit;

  app.get(
    '/api/invitations',
    withCaller('ViewUsers', async (c, caller) => c.json(await accounts.invitations.list(caller.orgId))),
  );

  /**
   * An invitation of an address. Where the server sends mail the link goes only by mail, and is not answered: opening
   * it then confirms the address, which a link the Admin could copy would not. The answer is the same whether the
   * address has an account or not.
   */
  app.post(
    '/api/invitations',
    withCaller('ManageUsers', async (c, caller) => {
      // Only a desktop host's own window signs in, so its invitations could not be accepted: it makes people instead.
      if (deps.pairing) return fail(c, 403, 'forbidden');
      const a = await body(c, inviteRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      if (a.role === 'admin' && !(await mayMakeAdmin(c, caller))) return fail(c, 403, 'reauth-required');
      const mail = deps.mail;
      // A mailed one replaces an older invitation to the address only once its mail has gone.
      const r = await accounts.invitations.create(caller.orgId, { email: a.email, role: a.role, mailed: !!mail, byUserId: caller.ctx.userId, keepOthers: !!mail });
      if (typeof r === 'string') return fail(c, 409, r);
      if (!mail) return c.json({ id: r.id, mailed: false, inviteToken: r.token } satisfies InvitationResponse);
      const me = await accounts.members.me({ sessionId: caller.sessionId, userId: caller.ctx.userId, orgId: caller.orgId, role: caller.ctx.role });
      try {
        await mail.mailer.send(inviteMail('invite', { to: a.email, name: '', orgName: me?.orgName ?? '', link: inviteLink(mail.appUrl, r.token) }, a.language));
      } catch (e) {
        log({ event: 'mail-failed', reason: String(e) });
        await accounts.invitations.remove(caller.orgId, r.id);
        return fail(c, 503, 'mail-failed');
      }
      await accounts.invitations.replaceOthers(caller.orgId, r.id);
      return c.json({ id: r.id, mailed: true } satisfies InvitationResponse);
    }),
  );

  app.delete(
    '/api/invitations/:id',
    withCaller('ManageUsers', async (c, caller) => ((await accounts.invitations.remove(caller.orgId, c.req.param('id')!)) ? c.json({ ok: true }) : fail(c, 404, 'not-found'))),
  );

  /**
   * The users of a 1.x organisation (docs/import-from-1x.md), one by one: each is invited, and their Google logins
   * accept the invitation when they sign in. Only a Superadmin's import makes accounts and links them at once.
   */
  app.post(
    '/api/import/users',
    withCaller('ManageUsers', async (c, caller) => {
      const users = await body(c, legacyUsersSchema);
      if (!users) return fail(c, 400, 'invalid-request');
      // Invitations that may make an Admin and carry Google accounts the zip names: as making an Admin, only from a
      // fresh sign-in, never a paired device, so a stolen session cannot leave an account of its own behind.
      if (!(await mayMakeAdmin(c, caller))) return fail(c, 403, 'reauth-required');
      const outcomes: Record<LegacyUserOutcome, number> = { created: 0, member: 0, kept: 0, invited: 0, limit: 0 };
      for (const u of users) {
        if (caller.ctx.role === 'superAdmin') {
          const outcome = await accounts.legacy.import(caller.orgId, u);
          outcomes[outcome]++;
          if (outcome !== 'limit') await accounts.emails.audit(caller.ctx.userId, 'import-linked', null, caller.orgId, u.email);
          continue;
        }
        const r = await accounts.invitations.create(caller.orgId, {
          email: u.email,
          role: u.role,
          mailed: false,
          byUserId: caller.ctx.userId,
          name: u.name,
          googleSubjects: u.google,
          ttlMs: ACCOUNT_LIMITS.importInviteTtlMs,
        });
        outcomes[r === 'email-taken' ? 'kept' : r === 'limit' ? 'limit' : 'invited']++;
      }
      return c.json(outcomes);
    }),
  );
}
