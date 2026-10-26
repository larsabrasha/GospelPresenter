import { Hono, type Context } from 'hono';
import type { MutatorCtx, PullRequest, PushRequest, Role } from '@spike/core';
import { currentSeq, dump, handlePull, handlePush, type OrgStore, type PokeCoalescer, type SerialQueue } from './sync-server.ts';

/** An organisation's runtime: its database, its write queue and its poke hub. */
export interface Org {
  store: OrgStore;
  queue: SerialQueue;
  poke: PokeCoalescer;
}

/** Global tables (D1 on Workers, global.sqlite on Node): who belongs where. */
export interface GlobalStore {
  role(userId: string, orgId: string): Promise<Role | null>;
  setRole(userId: string, orgId: string, role: Role): Promise<void>;
}

export const globalDdl = [
  `CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL,
     PRIMARY KEY (user_id, org_id))`,
];

export interface Caller {
  orgId: string;
  ctx: MutatorCtx;
}

/**
 * Spike authentication: the bearer token (or `?token=`, for WebSockets) is the
 * user id, and the organisation comes from `x-org` (or `?org=`). Real auth is
 * out of scope; the membership lookup in the global store is real.
 */
export async function authenticate(req: Request, global: GlobalStore): Promise<Caller | Response> {
  const url = new URL(req.url);
  const userId = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? url.searchParams.get('token');
  const orgId = req.headers.get('x-org') ?? url.searchParams.get('org');
  if (!userId || !orgId) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const role = await global.role(userId, orgId);
  if (!role) return Response.json({ error: 'not-a-member' }, { status: 403 });
  return { orgId, ctx: { userId, role } };
}

/** The sync endpoints. `resolve` finds the caller and their organisation for a request. */
export function syncRoutes(resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>, debug: boolean) {
  const app = new Hono();

  app.post('/sync/push', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const { org, caller } = r;
    const body = await c.req.json<PushRequest>();
    const result = await org.queue.run(async () => {
      const before = currentSeq(org.store);
      const res = await handlePush(org.store, caller.ctx, body);
      const after = currentSeq(org.store);
      if (after > before) org.poke.changed(body.clientId, after);
      return res;
    });
    return c.json(result.body, result.status);
  });

  app.post('/sync/pull', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const body = await c.req.json<PullRequest>();
    const result = await r.org.queue.run(() => handlePull(r.org.store, r.caller.ctx, body));
    return c.json(result.body, result.status);
  });

  if (debug) {
    app.get('/debug/dump', async (c) => {
      const r = await resolve(c);
      if (r instanceof Response) return r;
      return c.json(await r.org.queue.run(() => dump(r.org.store)));
    });
  }
  return app;
}

/** Debug-only admin route to change a membership (tests use it to revoke a permission). */
export function adminRoutes(global: GlobalStore) {
  const app = new Hono();
  app.post('/debug/membership', async (c) => {
    const { userId, orgId, role } = await c.req.json<{ userId: string; orgId: string; role: Role }>();
    await global.setRole(userId, orgId, role);
    return c.json({ ok: true });
  });
  return app;
}
