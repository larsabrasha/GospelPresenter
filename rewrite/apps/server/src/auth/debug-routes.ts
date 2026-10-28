// Routes for tests only, on a debug server.
import type { Hono } from 'hono';
import { roleSchema } from '@gp/core';
import type { AuthKit } from './kit.ts';

export function debugRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts } = kit;

  // -------------------------------------------------------------- tests only

  if (deps.debug) {
    app.get('/api/debug/counts', async (c) => c.json(await accounts.debugCounts()));
    app.post('/api/debug/session', async (c) => {
      const { userId, orgId, role } = await c.req.json<{ userId: string; orgId: string; role: string }>();
      return c.json({ token: await accounts.debugSession(userId, orgId, roleSchema.parse(role)) });
    });
    /** Sets a membership's role, or removes the membership with `role: null`. */
    app.post('/api/debug/membership', async (c) => {
      const { userId, orgId, role } = await c.req.json<{ userId: string; orgId: string; role: string | null }>();
      if (role === null) await accounts.sql.run('DELETE FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
      else await accounts.sql.run('INSERT OR REPLACE INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)', [userId, orgId, roleSchema.parse(role)]);
      return c.json({ ok: true });
    });
  }
}
