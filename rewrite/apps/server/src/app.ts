import { Hono, type Context } from 'hono';
import type { PullRequest, PushRequest } from '@gp/core';
import { currentSeq, dump, handlePull, handlePush, type OrgStore, type PokeCoalescer, type SerialQueue } from '@gp/sync/server';
import type { Caller } from './auth.ts';

export { authenticate, authRoutes, credentials, isApiPath, pairingGuard, WS_PROTOCOL, type AuthDeps, type Caller, type Pairing } from './auth.ts';
export { Accounts, globalDdl, migrateGlobal, GLOBAL_SCHEMA_VERSION, globalSchemaPlan, type GlobalSql } from './global.ts';

/** An organisation's runtime: its database, its write queue and its poke hub. */
export interface Org {
  store: OrgStore;
  queue: SerialQueue;
  poke: PokeCoalescer;
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
