// The MCP experiment (docs/mcp.md): a Superadmin turns it on or off for someone; someone it is on for makes, lists
// and deletes their own keys under Mina inställningar.
import type { Hono } from 'hono';
import { createMcpKeyRequest, setMcpRequest } from '@gp/core';
import { body, fail, type AuthKit } from './kit.ts';

export function mcpKeyRoutes(app: Hono, kit: AuthKit) {
  const { accounts, withCaller, target, mayMakeAdmin } = kit;

  // Only in superadminläge, for a member of the organisation the Superadmin is in (PERM-R3); logged as their other
  // changes to someone's account are.
  app.put(
    '/api/users/:id/mcp',
    withCaller(null, async (c, caller) => {
      if (caller.ctx.role !== 'superAdmin') return fail(c, 403, 'super-admin-only');
      const a = await body(c, setMcpRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const t = await target(caller, c.req.param('id')!);
      if (!t) return fail(c, 404, 'not-found');
      await accounts.mcpKeys.setEnabled(t.id, a.enabled);
      await accounts.emails.audit(caller.ctx.userId, 'mcp-changed', t.id, caller.orgId, a.enabled ? 'on' : 'off');
      return c.json({ ok: true });
    }),
  );

  app.get(
    '/api/auth/mcp-keys',
    withCaller(null, async (c, caller) => c.json(await accounts.mcpKeys.list(caller.ctx.userId))),
  );

  // A paired device acts for whoever paired it, so it makes no key that would outlive the pairing. A key outlives the
  // session too, so, as making an Admin, only from a fresh sign-in or a desktop host's own window: a stolen session
  // cannot leave a key of its own behind.
  app.post(
    '/api/auth/mcp-keys',
    withCaller(null, async (c, caller) => {
      if (caller.paired) return fail(c, 403, 'forbidden');
      const a = await body(c, createMcpKeyRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      if (!(await mayMakeAdmin(c, caller))) return fail(c, 403, 'reauth-required');
      const r = await accounts.mcpKeys.create(caller.ctx.userId, caller.orgId, a.name);
      if (r === 'forbidden') return fail(c, 403, 'forbidden');
      if (r === 'limit') return fail(c, 409, 'limit');
      return c.json(r);
    }),
  );

  app.delete(
    '/api/auth/mcp-keys/:id',
    withCaller(null, async (c, caller) => {
      const r = await accounts.mcpKeys.remove(caller.ctx.userId, c.req.param('id')!);
      return r === 'ok' ? c.json({ ok: true }) : fail(c, 404, 'not-found');
    }),
  );
}
