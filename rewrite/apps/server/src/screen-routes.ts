import { Hono, type Context } from 'hono';
import { can, SCREEN_ID, SCREEN_PIN, SCREEN_TOKEN, type LiveScreen } from '@gp/core';
import { watchLocked, type Org } from './app.ts';
import type { Caller } from './auth.ts';
import { THROTTLE, type Accounts } from './global/index.ts';
import type { ScreenRegistry } from './screens.ts';

// Pairing a temporary screen (spec 04 §5, §8; LIVE-R28). The TV asks for its
// code anonymously; an operator who may present pairs it, by that code or by
// a QR token the TV opens, for one live session.

interface Deps {
  screens: ScreenRegistry;
  accounts: Pick<Accounts, 'lockedUntil' | 'fail' | 'now'>;
  clientAddress: (c: Context) => string;
}

/**
 * `POST /api/screen` (anonymous): the TV's code, or that it is paired. With
 * the id the tab kept, the same screen; with a QR token, a new screen paired
 * at once. Making a screen counts against the address, and so does a wrong
 * token, so one machine cannot fill the table.
 */
export function screenStartRoutes(deps: Deps) {
  const app = new Hono();
  app.post('/api/screen', async (c) => {
    const a = ((await c.req.json().catch(() => null)) ?? {}) as { id?: unknown; token?: unknown };
    const id = typeof a.id === 'string' && SCREEN_ID.test(a.id) ? a.id : null;
    const token = typeof a.token === 'string' ? a.token : null;
    const address = `screen:${deps.clientAddress(c)}`;
    const locked = await deps.accounts.lockedUntil([address]);
    if (locked) return watchLocked(locked, deps.accounts.now());
    if (token !== null) {
      const paired = SCREEN_TOKEN.test(token) ? await deps.screens.startWithToken(token) : null;
      if (!paired) {
        await deps.accounts.fail(address, THROTTLE.screen);
        return c.json({ error: 'token-invalid' }, 400);
      }
      return c.json({ id: paired, paired: true });
    }
    const started = await deps.screens.start(id);
    if (!started) return c.json({ error: 'no-free-code' }, 503);
    if (started.id !== id) await deps.accounts.fail(address, THROTTLE.screen); // a new screen, not the tab's own again
    return c.json(started);
  });
  return app;
}

/**
 * The operator's side, under `/api/live/` so it reaches the organisation's
 * runtime: pair by code, make a QR token, and learn when a TV used it. Each
 * pairs for `sessionId`, which must be live here.
 */
export function screenPairRoutes(resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>, deps: Deps) {
  const app = new Hono();
  type LiveOrg = Org & { live: NonNullable<Org['live']> };
  const withOrg = async (c: Context) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ManagePresentations') || !r.org.live) return c.json({ error: 'forbidden' }, 403);
    return r as { caller: Caller; org: LiveOrg };
  };
  const add = (r: { caller: Caller; org: LiveOrg }, id: string, sessionId: string) => r.org.queue.run(async () => r.org.live.addScreen(id, sessionId, r.caller.ctx.userId));
  // A paired screen no session takes in: its TV, which may already follow it, starts again with a new code.
  const drop = (org: LiveOrg, id: string) => org.queue.run(async () => org.live.dropScreen(id));
  const sessionOf = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 100 ? v : null);

  app.post('/api/live/screens/claim', async (c) => {
    const r = await withOrg(c);
    if (r instanceof Response) return r;
    const a = ((await c.req.json().catch(() => null)) ?? {}) as { pin?: unknown; sessionId?: unknown };
    const sessionId = sessionOf(a.sessionId);
    if (typeof a.pin !== 'string' || !SCREEN_PIN.test(a.pin) || !sessionId) return c.json({ error: 'invalid-request' }, 400);
    // Shared with setup tokens and device pairing codes: twenty wrong guesses lock the address.
    const address = `address:${deps.clientAddress(c)}`;
    const locked = await deps.accounts.lockedUntil([address]);
    if (locked) return watchLocked(locked, deps.accounts.now());
    const id = await deps.screens.claimPin(a.pin, r.caller.orgId);
    if (!id) {
      await deps.accounts.fail(address, THROTTLE.address);
      return c.json({ error: 'pin-invalid' }, 400);
    }
    const screen = await add(r, id, sessionId);
    if (!screen) {
      await drop(r.org, id);
      return c.json({ error: 'not-live' }, 409);
    }
    return c.json({ screen } satisfies { screen: LiveScreen });
  });

  app.post('/api/live/screens/token', async (c) => {
    const r = await withOrg(c);
    if (r instanceof Response) return r;
    return c.json(await deps.screens.newToken(r.caller.orgId));
  });

  app.get('/api/live/screens/token/:token', async (c) => {
    const r = await withOrg(c);
    if (r instanceof Response) return r;
    const sessionId = sessionOf(c.req.query('session'));
    if (!sessionId) return c.json({ error: 'invalid-request' }, 400);
    const id = await deps.screens.tokenUsed(c.req.param('token'), r.caller.orgId);
    if (!id) return c.json({ screen: null });
    const screen = await add(r, id, sessionId);
    if (!screen) {
      await drop(r.org, id);
      return c.json({ error: 'not-live' }, 409);
    }
    return c.json({ screen } satisfies { screen: LiveScreen });
  });

  app.delete('/api/live/screens/token/:token', async (c) => {
    const r = await withOrg(c);
    if (r instanceof Response) return r;
    // A TV that used the token since the dialog last asked was scanned on purpose: it is taken in for the
    // session, as the poll would have, and the dialog switches it on. Without a live session it starts again.
    const used = await deps.screens.dropToken(c.req.param('token'), r.caller.orgId);
    if (!used) return c.json({ screen: null });
    const known = await r.org.queue.run(async () => r.org.live.screen(used));
    if (known) return c.json({ screen: known });
    const sessionId = sessionOf(c.req.query('session'));
    const screen = sessionId ? await add(r, used, sessionId) : null;
    if (!screen) {
      await drop(r.org, used);
      return c.json({ screen: null });
    }
    return c.json({ screen } satisfies { screen: LiveScreen });
  });

  return app;
}
