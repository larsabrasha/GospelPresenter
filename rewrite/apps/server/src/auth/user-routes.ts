// The organisation's users: list, create, change role, remove, invite.
import type { Hono } from 'hono';
import { changeRoleRequest, createUserRefusal, createUserRequest, inviteRefusal, removeUserRefusal, roleChangeRefusal } from '@gp/core';
import { body, fail, type AuthKit } from './kit.ts';

export function userRoutes(app: Hono, kit: AuthKit) {
  const { accounts, withCaller, target, actor } = kit;

  // -------------------------------------------------------------- the organisation's users

  app.get(
    '/api/users',
    withCaller('ViewUsers', async (c, caller) => c.json(await accounts.listUsers(caller.orgId))),
  );

  app.post(
    '/api/users',
    withCaller('ManageUsers', async (c, caller) => {
      const a = await body(c, createUserRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const refusal = createUserRefusal(caller.ctx.role, a.role);
      if (refusal) return fail(c, 403, refusal);
      const r = await accounts.createUser(caller.orgId, a);
      if (typeof r === 'string') return fail(c, 409, r);
      return c.json(r);
    }),
  );

  app.patch(
    '/api/users/:id',
    withCaller('ManageUsers', async (c, caller) => {
      const a = await body(c, changeRoleRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      const refusal = roleChangeRefusal(actor(caller), t, a.role);
      if (refusal) return fail(c, 403, refusal);
      await accounts.setRole(t.id, caller.orgId, a.role);
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
      await accounts.deleteUser(t.id);
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
      const token = await accounts.createInvite(t.id, caller.orgId);
      if (token === 'limit') return fail(c, 409, 'limit');
      return c.json({ inviteToken: token });
    }),
  );
}
