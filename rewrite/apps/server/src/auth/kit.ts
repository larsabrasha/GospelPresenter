// What every group of auth routes shares: the dependencies, request parsing,
// the error answer, the cookies, and the helpers that close over the
// dependencies (throttling, sessions, callers, and starting a sign-in).
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { ACCOUNT_LIMITS, can, type AuthError, type PasskeyOptions, type Permission, type SignInResponse } from '@gp/core';
import { newSecret } from '../crypto.ts';
import { LOGIN_FLOW, PASSKEY_FLOW, type Accounts } from '../global/index.ts';
import type { GoogleOidc } from '../google.ts';
import type { Passkeys } from '../webauthn.ts';
import { authenticate, type Caller } from './caller.ts';
import { signInFailed } from './pages.ts';
import type { Pairing } from './pairing-guard.ts';

export interface AuthDeps {
  accounts: Accounts;
  /** What `/api/auth/setup` must be given (D19). Null: setup is closed until one is configured. */
  setupToken: string | null;
  /** The caller's network address, for throttling. */
  clientAddress: (c: Context) => string;
  /** Sign-in with Google; null when no client is configured. */
  google: GoogleOidc | null;
  /** Passkeys; null when no RP ID is configured. With neither, no one can sign in or set up. */
  passkeys: Passkeys | null;
  /** How young a session must be to add a login to its user (ACCOUNT_LIMITS.freshSignInMs by default). */
  freshSignInMs?: number;
  /** Set on a desktop host. */
  pairing?: Pairing;
  debug?: boolean;
  /** Why a sign-in was refused, for the server's log only (spec 01: the user sees one generic error). */
  log?: (event: Record<string, unknown>) => void;
}

/** A Zod schema, as far as this file needs one (the server does not depend on Zod itself). */
export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export async function body<T>(c: Context, schema: Schema<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

export const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, error: AuthError, extra: object = {}) =>
  c.json({ error, ...extra }, status);

/** The cookie that binds a sign-in to the browser that started it. */
export const FLOW_COOKIE = 'gp_flow';
/** The cookie a web sign-in hands its session over with, once. */
export const HANDOFF_COOKIE = 'gp_handoff';
/** The cookie that binds a passkey ceremony to the browser that started it. */
export const PASSKEY_COOKIE = 'gp_pk';

/** The helpers the route groups share, closed over `deps`. */
export function authKit(deps: AuthDeps) {
  const { accounts, google, passkeys } = deps;
  const freshMs = deps.freshSignInMs ?? ACCOUNT_LIMITS.freshSignInMs;
  const log = deps.log ?? (() => undefined);

  const tooMany = (c: Context, until: number) => {
    const seconds = Math.ceil((until - accounts.now()) / 1000);
    c.header('retry-after', String(seconds));
    return fail(c, 429, 'too-many-attempts', { retryAfter: seconds });
  };

  async function signedIn(userId: string, orgId: string, deviceName: string, pairedDeviceId: string | null = null): Promise<SignInResponse | null> {
    const member = await accounts.members.member(userId, orgId);
    if (!member) return null;
    const { token, sessionId } = await accounts.members.createSession(userId, orgId, deviceName, pairedDeviceId);
    const me = await accounts.members.me({ sessionId, userId, orgId, role: member.role });
    return me && { token, me };
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

  const secure = (c: Context) => new URL(c.req.url).protocol === 'https:';
  const cookie = (c: Context, name: string, value: string, maxAge: number) =>
    setCookie(c, name, value, { path: '/api/auth', httpOnly: true, sameSite: 'Lax', secure: secure(c), maxAge });

  /**
   * A caller who may add a login to themselves: signed in by themselves (not
   * by a pairing someone else made), and recently (ACCOUNT_LIMITS.freshSignInMs).
   */
  async function mayAddLogin(c: Context): Promise<Caller | Response> {
    const caller = await authenticate(c.req.raw, accounts);
    if (caller instanceof Response) return caller;
    if (caller.paired) return fail(c, 403, 'forbidden');
    if (accounts.now() - caller.signedInAt > freshMs) return fail(c, 403, 'reauth-required');
    return caller;
  }

  /** Binds a passkey flow to this browser, gives it a challenge, and answers the options for it. */
  async function startPasskey(c: Context, state: string): Promise<PasskeyOptions | AuthError> {
    if (!passkeys) return 'passkey-disabled';
    const browser = newSecret('');
    const challenge = newSecret('');
    const flow = await accounts.passkeys.startFlow(state, browser, challenge);
    if (!flow) return 'passkey-failed';
    let options: PasskeyOptions;
    if (flow.kind === 'authenticate') options = { get: passkeys.requestOptions(challenge) };
    else {
      const who = await accounts.passkeys.registrant(flow);
      if (typeof who === 'string') return who;
      options = { create: passkeys.creationOptions({ challenge, userId: who.userId, name: who.email ?? who.name, displayName: who.name, exclude: who.exclude }) };
    }
    cookie(c, PASSKEY_COOKIE, browser, PASSKEY_FLOW.ttlMs / 1000);
    return options;
  }

  /** Binds `state` to this browser and sends it to Google. */
  async function start(c: Context, state: string, forApp: boolean): Promise<Response> {
    if (!google) return signInFailed(c, 'google-disabled', forApp);
    const browser = newSecret('');
    const flow = await accounts.signIn.startFlow(state, browser);
    if (!flow) return signInFailed(c, 'google-failed', forApp);
    cookie(c, FLOW_COOKIE, browser, LOGIN_FLOW.ttlMs / 1000);
    c.header('referrer-policy', 'no-referrer');
    return c.redirect(await google.authorizeUrl({ state, nonce: flow.nonce, verifier: flow.verifier, redirectUri: google.redirectUri(c.req.url) }), 302);
  }

  /** The target user, only if they are in the caller's organisation (PERM-R3). */
  const target = (caller: Caller, id: string) => accounts.members.member(id, caller.orgId);
  const actor = (caller: Caller) => ({ id: caller.ctx.userId, role: caller.ctx.role });

  return { deps, accounts, google, passkeys, log, tooMany, signedIn, withCaller, secure, cookie, mayAddLogin, startPasskey, start, target, actor };
}

export type AuthKit = ReturnType<typeof authKit>;
