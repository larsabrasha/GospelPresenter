// Sign-in, sessions, membership and pairing over HTTP (spec 01, ADR 0007
// decision 6). The same routes run on Node and in the Worker; pairing exists
// only where the server is a desktop host.
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  ACCOUNT_LIMITS,
  acceptInviteRequest,
  can,
  changeRoleRequest,
  createUserRefusal,
  createUserRequest,
  inviteRefusal,
  pairClaimRequest,
  removeUserRefusal,
  roleChangeRefusal,
  roleSchema,
  setupRequest,
  signInRequest,
  type AuthError,
  type Me,
  type MutatorCtx,
  type PairStatus,
  type Permission,
  type SignInResponse,
} from '@gp/core';
import { constantTimeEqual, hashPassword, newDigits, verifyPassword } from './crypto.ts';
import { THROTTLE, type Accounts } from './global.ts';

export interface Caller {
  orgId: string;
  sessionId: string;
  ctx: MutatorCtx;
}

/** The WebSocket subprotocol a poke socket is answered with; the others carry credentials. */
export const WS_PROTOCOL = 'gp.v1';

/**
 * The bearer token and the paired-device token of a request. Browsers cannot
 * set headers on a WebSocket, so a poke socket offers them as subprotocols
 * (`gp.auth.<token>`, `gp.device.<token>`) rather than in the URL, which
 * would put them in logs.
 */
export function credentials(req: Request): { token: string | null; device: string | null } {
  const offered = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
  const fromProtocol = (prefix: string) => offered.find((p) => p.startsWith(prefix))?.slice(prefix.length) || null;
  const auth = req.headers.get('authorization');
  return {
    token: auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : fromProtocol('gp.auth.'),
    device: req.headers.get('x-gp-device') ?? fromProtocol('gp.device.'),
  };
}

const refuse = (status: 401 | 403, error: AuthError) => Response.json({ error }, { status });

/**
 * Who is calling: a session that exists, is not revoked or idle too long,
 * and whose user is still a member of its organisation, with the role read
 * now (D22). The organisation is the session's, never the client's (SYNC-R1).
 */
export async function authenticate(req: Request, accounts: Accounts): Promise<Caller | Response> {
  const { token } = credentials(req);
  const s = token ? await accounts.session(token) : null;
  if (!s) return refuse(401, 'unauthenticated');
  if (!s.role) return refuse(403, 'not-a-member');
  return { orgId: s.orgId, sessionId: s.sessionId, ctx: { userId: s.userId, role: s.role } };
}

/** Pairing on a desktop host: only the host's own window and paired devices may use the API. */
export interface Pairing {
  /** Held by the host's main process, which adds it to its own window's requests; never stored. */
  hostToken: string;
}

export async function deviceOf(req: Request, accounts: Accounts, pairing: Pairing): Promise<'host' | 'paired' | null> {
  const { device } = credentials(req);
  if (!device) return null;
  if (constantTimeEqual(device, pairing.hostToken)) return 'host';
  return (await accounts.pairedDevice(device)) ? 'paired' : null;
}

/** Paths an unpaired device may reach: the pairing itself. Everything outside the API is the static app. */
const OPEN_PATHS = new Set(['/pair/status', '/pair/claim']);
const API_PREFIXES = ['/auth/', '/sync/', '/users', '/pair/', '/debug/'];

export function isApiPath(path: string): boolean {
  return API_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p));
}

/** Refuses every API request from a device that is not paired, before anything else runs. */
export function pairingGuard(accounts: Accounts, pairing: Pairing): MiddlewareHandler {
  return async (c, next) => {
    if (!isApiPath(c.req.path) || OPEN_PATHS.has(c.req.path)) return next();
    if (!(await deviceOf(c.req.raw, accounts, pairing))) return c.json({ error: 'device-not-paired' satisfies AuthError }, 403);
    return next();
  };
}

export interface AuthDeps {
  accounts: Accounts;
  /** What `/auth/setup` must be given (D19). Null: setup is closed until one is configured. */
  setupToken: string | null;
  /** The caller's network address, for throttling. */
  clientAddress: (c: Context) => string;
  /** Set on a desktop host. */
  pairing?: Pairing;
  debug?: boolean;
}

/** A Zod schema, as far as this file needs one (the server does not depend on Zod itself). */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

async function body<T>(c: Context, schema: Schema<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, error: AuthError, extra: object = {}) =>
  c.json({ error, ...extra }, status);

export function authRoutes(deps: AuthDeps) {
  const { accounts } = deps;
  const app = new Hono();

  const tooMany = (c: Context, until: number) => {
    const seconds = Math.ceil((until - accounts.now()) / 1000);
    c.header('retry-after', String(seconds));
    return fail(c, 429, 'too-many-attempts', { retryAfter: seconds });
  };

  async function signedIn(userId: string, orgId: string, deviceName: string): Promise<SignInResponse> {
    const { token, sessionId } = await accounts.createSession(userId, orgId, deviceName);
    const member = await accounts.member(userId, orgId);
    const me = await accounts.me({ sessionId, userId, orgId, role: member!.role });
    return { token, me: me! };
  }

  /** Runs `fn` for an authenticated caller who has `permission`. */
  const withCaller =
    (permission: Permission | null, fn: (c: Context, caller: Caller) => Promise<Response>) =>
    async (c: Context): Promise<Response> => {
      const caller = await authenticate(c.req.raw, accounts);
      if (caller instanceof Response) return caller;
      if (permission && !can(caller.ctx.role, permission)) return fail(c, 403, 'forbidden');
      return fn(c, caller);
    };

  // -------------------------------------------------------------- first run, sign-in, sign-out

  app.get('/auth/state', async (c) => c.json({ setupRequired: !(await accounts.hasUsers()) }));

  app.post('/auth/setup', async (c) => {
    const a = await body(c, setupRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const address = `address:${deps.clientAddress(c)}`;
    const locked = await accounts.lockedUntil([address]);
    if (locked) return tooMany(c, locked);
    if (await accounts.hasUsers()) return fail(c, 409, 'setup-done');
    if (!deps.setupToken || !constantTimeEqual(a.setupToken, deps.setupToken)) {
      await accounts.fail(address, THROTTLE.address);
      return fail(c, 403, 'setup-token');
    }
    const r = await accounts.setup({ name: a.name, orgName: a.orgName, email: a.email, passwordHash: await hashPassword(a.password) });
    if (r === 'setup-done') return fail(c, 409, 'setup-done');
    return c.json(await signedIn(r.userId, r.orgId, a.deviceName));
  });

  app.post('/auth/signin', async (c) => {
    const a = await body(c, signInRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const address = `address:${deps.clientAddress(c)}`;
    const account = `account:${a.email}`;
    // Checked before the password, so a locked account answers the same whether the guess was right.
    const locked = await accounts.lockedUntil([address, account]);
    if (locked) return tooMany(c, locked);
    const user = await accounts.userByEmail(a.email);
    // Always hashed, also without an account, so the time taken does not tell which emails exist.
    const ok = await verifyPassword(a.password, user?.passwordHash ?? null);
    if (!ok || !user?.orgId) {
      await accounts.fail(account, THROTTLE.account);
      await accounts.fail(address, THROTTLE.address);
      return fail(c, 401, 'wrong-credentials');
    }
    await accounts.clearThrottle(account);
    return c.json(await signedIn(user.id, user.orgId, a.deviceName));
  });

  app.post(
    '/auth/signout',
    withCaller(null, async (c, caller) => {
      await accounts.revokeSession(caller.sessionId);
      return c.json({ ok: true });
    }),
  );

  app.get(
    '/auth/me',
    withCaller(null, async (c, caller) => {
      const me: Me | null = await accounts.me({ sessionId: caller.sessionId, userId: caller.ctx.userId, orgId: caller.orgId, role: caller.ctx.role });
      return me ? c.json(me) : fail(c, 401, 'unauthenticated');
    }),
  );

  // -------------------------------------------------------------- invites (the token travels in a body, not a URL)

  app.post('/auth/invites/lookup', async (c) => {
    const token = (await c.req.json().catch(() => null))?.token;
    return c.json(await accounts.invite(typeof token === 'string' ? token : ''));
  });

  app.post('/auth/invites/accept', async (c) => {
    const raw = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
    const a = acceptInviteRequest.safeParse(raw);
    if (!a.success || typeof raw?.token !== 'string') return fail(c, 400, 'invalid-request');
    const r = await accounts.acceptInvite(raw.token, await hashPassword(a.data.password));
    if (typeof r === 'string') return fail(c, 400, r);
    return c.json(await signedIn(r.userId, r.orgId, a.data.deviceName));
  });

  // -------------------------------------------------------------- the organisation's users

  app.get(
    '/users',
    withCaller('ViewUsers', async (c, caller) => c.json(await accounts.listUsers(caller.orgId))),
  );

  app.post(
    '/users',
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

  /** The target user, only if they are in the caller's organisation (PERM-R3). */
  const target = (caller: Caller, id: string) => accounts.member(id, caller.orgId);
  const actor = (caller: Caller) => ({ id: caller.ctx.userId, role: caller.ctx.role });

  app.patch(
    '/users/:id',
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
    '/users/:id',
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
    '/users/:id/invites',
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

  // -------------------------------------------------------------- pairing

  const pairing = deps.pairing;
  app.get('/pair/status', async (c) => {
    const device = pairing ? await deviceOf(c.req.raw, accounts, pairing) : null;
    return c.json({ required: !!pairing, paired: !!device, host: device === 'host' } satisfies PairStatus);
  });

  if (pairing) {
    app.post('/pair/claim', async (c) => {
      const a = await body(c, pairClaimRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const address = `address:${deps.clientAddress(c)}`;
      const locked = await accounts.lockedUntil([address]);
      if (locked) return tooMany(c, locked);
      const token = await accounts.claimPairCode(a.code, a.name, ACCOUNT_LIMITS.pairCodeAttempts);
      if (!token) {
        await accounts.fail(address, THROTTLE.address);
        return fail(c, 400, 'pair-code-invalid');
      }
      return c.json({ token });
    });

    /** Only the host's own window, signed in with ManageUsers: whoever pairs a device is at the host. */
    const atHost = (fn: (c: Context, caller: Caller) => Promise<Response>) =>
      withCaller('ManageUsers', async (c, caller) => ((await deviceOf(c.req.raw, accounts, pairing)) === 'host' ? fn(c, caller) : fail(c, 403, 'forbidden')));

    app.post(
      '/pair/code',
      atHost(async (c) => {
        const code = newDigits(6);
        return c.json({ code, expiresAt: await accounts.newPairCode(code, ACCOUNT_LIMITS.pairCodeTtlMs) });
      }),
    );
    app.get(
      '/pair/devices',
      atHost(async (c) => c.json(await accounts.pairedDevices())),
    );
    app.delete(
      '/pair/devices/:id',
      atHost(async (c) => ((await accounts.revokeDevice(c.req.param('id')!)) ? c.json({ ok: true }) : fail(c, 404, 'not-found'))),
    );
  }

  // -------------------------------------------------------------- tests only

  if (deps.debug) {
    app.post('/debug/session', async (c) => {
      const { userId, orgId, role } = await c.req.json<{ userId: string; orgId: string; role: string }>();
      return c.json({ token: await accounts.debugSession(userId, orgId, roleSchema.parse(role)) });
    });
    /** Sets a membership's role, or removes the membership with `role: null`. */
    app.post('/debug/membership', async (c) => {
      const { userId, orgId, role } = await c.req.json<{ userId: string; orgId: string; role: string | null }>();
      if (role === null) await accounts.sql.run('DELETE FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
      else await accounts.sql.run('INSERT OR REPLACE INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)', [userId, orgId, roleSchema.parse(role)]);
      return c.json({ ok: true });
    });
  }
  return app;
}
