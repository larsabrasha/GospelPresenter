// Organisations (spec 01 `/admin/organizations` and the switcher, decided on 2026-10-31): the ones the caller may
// act in and the switch between them, and for a SuperAdmin the list, a new one, a new name and deleting one.
import type { Hono } from 'hono';
import { orgNameRequest, switchOrgRequest, type SignInResponse } from '@gp/core';
import { body, fail, type AuthKit } from './kit.ts';

export function orgRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, withCaller } = kit;

  /** The switcher's organisations: the caller's own, or every one for a SuperAdmin. */
  app.get(
    '/api/auth/orgs',
    withCaller(null, async (c, caller) => c.json(await accounts.members.orgsOf(caller.ctx.userId))),
  );

  /** A session in another organisation the caller may act in (SYNC-R1: the server decides; ORG-R7: the page reloads with it). */
  app.post(
    '/api/auth/switch',
    withCaller(null, async (c, caller) => {
      const a = await body(c, switchOrgRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const s = await accounts.members.switchOrg(caller.sessionId, caller.ctx.userId, a.orgId);
      if (s === 'not-a-member') return fail(c, 403, 'not-a-member');
      const role = (await accounts.members.roleIn(caller.ctx.userId, a.orgId))!;
      const me = await accounts.members.me({ sessionId: s.sessionId, userId: caller.ctx.userId, orgId: a.orgId, role });
      return me ? c.json({ token: s.token, me } satisfies SignInResponse) : fail(c, 404, 'not-found');
    }),
  );

  app.get(
    '/api/orgs',
    withCaller('ManageOrganizations', async (c) => c.json(await accounts.members.listOrgs())),
  );

  app.post(
    '/api/orgs',
    withCaller('ManageOrganizations', async (c) => {
      const a = await body(c, orgNameRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const id = await accounts.members.createOrg(a.name);
      return id === 'limit' ? fail(c, 409, 'limit') : c.json({ id });
    }),
  );

  /** One organisation and its members (spec 01 organisation detail). */
  app.get(
    '/api/orgs/:id',
    withCaller('ManageOrganizations', async (c) => {
      const org = (await accounts.members.listOrgs()).find((o) => o.id === c.req.param('id'));
      if (!org) return fail(c, 404, 'not-found');
      return c.json({ ...org, users: await accounts.members.listUsers(org.id) });
    }),
  );

  app.patch(
    '/api/orgs/:id',
    withCaller('ManageOrganizations', async (c) => {
      const a = await body(c, orgNameRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      return (await accounts.members.renameOrg(c.req.param('id')!, a.name)) ? c.json({ ok: true }) : fail(c, 404, 'not-found');
    }),
  );

  /** Deletes an organisation: its accounts here, then its data and files where the server keeps them. */
  app.delete(
    '/api/orgs/:id',
    withCaller('ManageOrganizations', async (c) => {
      const id = c.req.param('id')!;
      const r = await accounts.members.deleteOrg(id);
      if (r === 'not-found') return fail(c, 404, 'not-found');
      if (r === 'super-admin-home') return fail(c, 409, 'super-admin-home');
      await deps.dropOrgData?.(id);
      return c.json({ ok: true });
    }),
  );
}
