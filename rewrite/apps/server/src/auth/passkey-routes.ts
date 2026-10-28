// Passkey ceremonies: begin (from a page or an app), the system browser's
// page and script, and the credential coming back.
import type { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { ACCOUNT_LIMITS, isCallbackScheme, passkeyBeginRequest, passkeyFinishRequest, type AuthError, type PasskeyBeginResponse, type PasskeyFinishResponse } from '@gp/core';
import { PASSKEY_FLOW, type NewLogin } from '../global/index.ts';
import { parseClientData } from '../webauthn.ts';
import type { Caller } from './caller.ts';
import { body, fail, PASSKEY_COOKIE, type AuthKit } from './kit.ts';
import { callbackLink, passkeyPage, PASSKEY_JS, signInFailed } from './pages.ts';
import { deviceOf } from './pairing-guard.ts';

export function passkeyRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, passkeys, log, signedIn, secure, mayAddLogin, startPasskey } = kit;

  // -------------------------------------------------------------- passkeys

  /**
   * Starts a passkey ceremony (see `passkeyBeginRequest`). A web page gets
   * its options at once, bound to this browser by a cookie; an app gets a
   * URL for the system browser, which binds the flow when it opens it. On a
   * desktop host, only the host's own window may begin, and only through the
   * system browser, as for Google.
   */
  app.post('/api/auth/passkey/begin', async (c) => {
    const a = await body(c, passkeyBeginRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    if (a.app && !isCallbackScheme(a.app.callbackScheme)) return fail(c, 400, 'callback-scheme');
    if (!passkeys) return fail(c, 503, 'passkey-disabled');
    if (deps.pairing && (!a.app || (await deviceOf(c.req.raw, accounts, deps.pairing)) !== 'host')) return fail(c, 403, 'forbidden');
    if (a.mode === 'signin' && a.invite) return fail(c, 400, 'invalid-request');
    // A passkey for yourself, from your own fresh session: never for someone else (there is no user id to give).
    let owner: Caller | null = null;
    if (a.mode === 'register' && !a.invite) {
      const caller = await mayAddLogin(c);
      if (caller instanceof Response) return caller;
      if ((await accounts.logins.list(caller.ctx.userId)).length >= ACCOUNT_LIMITS.loginsPerUser) return fail(c, 409, 'limit');
      owner = caller;
    }
    if (a.invite) {
      const state = await accounts.members.invite(a.invite);
      if (state.state !== 'valid') return fail(c, 400, state.state === 'expired' ? 'invite-expired' : 'invite-invalid');
    }
    const state = await accounts.passkeys.createFlow({
      kind: a.mode === 'signin' ? 'authenticate' : 'register',
      address: deps.clientAddress(c),
      userId: owner?.ctx.userId,
      sessionId: owner?.sessionId,
      inviteToken: a.invite,
      name: a.name,
      deviceName: a.app?.deviceName ?? '',
      callbackScheme: a.app?.callbackScheme ?? null,
    });
    if (state === 'limit') return fail(c, 429, 'too-many-attempts', { retryAfter: PASSKEY_FLOW.ttlMs / 1000 });
    if (a.app) return c.json({ url: `/api/auth/passkey/start?flow=${encodeURIComponent(state)}` } satisfies PasskeyBeginResponse);
    const options = await startPasskey(c, state);
    if (typeof options === 'string') return fail(c, 400, options);
    return c.json({ options } satisfies PasskeyBeginResponse);
  });

  /** The system browser opens an app's ceremony here: the flow is bound to it, and the page runs the ceremony. */
  app.get('/api/auth/passkey/start', async (c) => {
    const options = await startPasskey(c, c.req.query('flow') ?? '');
    if (typeof options !== 'string') return passkeyPage(c, options);
    log({ event: 'passkey-refused', reason: `start: ${options}` });
    return signInFailed(c, options, true);
  });

  app.get('/api/auth/passkey.js', (c) => {
    c.header('content-type', 'text/javascript; charset=utf-8');
    c.header('cache-control', 'no-store');
    return c.body(PASSKEY_JS);
  });

  /**
   * The credential comes back. Its flow must be the one its challenge names,
   * started in this browser, of the same kind (a registration's challenge
   * never signs anyone in), unused and not expired; taking it uses it, so a
   * credential cannot be replayed. Then the credential is verified, and the
   * passkey is linked (invite, or a signed-in user adding one) or signs in.
   */
  app.post('/api/auth/passkey/finish', async (c) => {
    const a = await body(c, passkeyFinishRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    if (!passkeys) return fail(c, 503, 'passkey-disabled');
    const browser = getCookie(c, PASSKEY_COOKIE) ?? '';
    deleteCookie(c, PASSKEY_COOKIE, { path: '/api/auth', secure: secure(c) });
    const cred = a.credential;
    const kind = cred.response.attestationObject !== undefined ? 'register' : 'authenticate';
    const cd = parseClientData(cred.response.clientDataJSON);
    const flow = browser && cd ? await accounts.passkeys.takeFlow(cd.challenge, browser, kind) : null;
    const refused = (error: AuthError, reason: string) => {
      log({ event: 'passkey-refused', reason });
      const status = error === 'unauthenticated' ? 401 : error === 'not-a-member' ? 403 : error === 'login-taken' || error === 'limit' ? 409 : 400;
      return fail(c, status, error);
    };
    if (!flow || !cd) return refused('passkey-failed', !browser ? 'no-flow-cookie' : !cd ? 'client-data' : 'unknown-challenge');

    let who: { userId: string; orgId: string };
    if (kind === 'register') {
      const p = await passkeys.verifyRegistration(cred, cd);
      if ('problem' in p) return refused('passkey-failed', p.problem);
      const login: NewLogin = { provider: 'passkey', passkey: p, name: flow.name ?? ((flow.callbackScheme ? flow.deviceName : a.deviceName) || 'Passkey') };
      if (!flow.inviteHash) {
        const added = await accounts.logins.add(flow.userId ?? '', flow.sessionId ?? '', login);
        if (typeof added === 'string') return refused(added, added);
        return c.json((flow.callbackScheme ? { done: true } : { added }) satisfies PasskeyFinishResponse);
      }
      const r = await accounts.signIn.acceptInvite(flow.inviteHash, login);
      if (typeof r === 'string') return refused(r, r);
      who = r;
    } else {
      const stored = await accounts.passkeys.get(cred.id);
      if (!stored) return refused('passkey-failed', 'unknown-credential');
      const v = await passkeys.verifyAssertion(cred, cd, stored);
      if ('problem' in v) return refused('passkey-failed', v.problem);
      if (!(await accounts.passkeys.use(cred.id, stored.signCount, v.signCount))) return refused('passkey-failed', 'counter-race');
      const r = await accounts.signIn.signedInAs(stored.userId);
      if (typeof r === 'string') return refused(r, r);
      who = r;
    }
    if (flow.callbackScheme) {
      // Checked again where the token is minted (AUTH-R10).
      if (!isCallbackScheme(flow.callbackScheme)) return refused('callback-scheme', 'callback-scheme');
      const r = await signedIn(who.userId, who.orgId, flow.deviceName);
      return r ? c.json({ callback: callbackLink(flow.callbackScheme, r) } satisfies PasskeyFinishResponse) : refused('not-a-member', 'not-a-member');
    }
    const r = await signedIn(who.userId, who.orgId, a.deviceName);
    return r ? c.json(r satisfies PasskeyFinishResponse) : refused('not-a-member', 'not-a-member');
  });
}
