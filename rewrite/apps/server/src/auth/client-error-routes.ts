// Errors a signed-in client caught nothing for, written to the server's log beside its own events (docs/cloudflare.md,
// "Logs"): on Cloudflare its Workers Logs, on Node stderr. Nothing is stored.
import type { Hono } from 'hono';
import { clientErrorReportSchema } from '@gp/core';
import { body, fail, type AuthKit } from './kit.ts';

export function clientErrorRoutes(app: Hono, kit: AuthKit) {
  const { log } = kit;
  app.post(
    '/api/client-errors',
    kit.withCaller(null, async (c, caller) => {
      const report = await body(c, clientErrorReportSchema);
      if (!report) return fail(c, 400, 'invalid-request');
      log({ event: 'client-error', orgId: caller.orgId, userId: caller.ctx.userId, paired: caller.paired, userAgent: c.req.header('user-agent') ?? null, ...report });
      return c.json({ ok: true });
    }),
  );
}
