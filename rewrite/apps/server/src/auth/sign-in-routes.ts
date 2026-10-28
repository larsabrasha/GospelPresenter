// First run, and sign-in with Google: from a page, from an app through the
// system browser (which may also run a passkey), and the web handover.
import type { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { ACCOUNT_LIMITS, googleBeginRequest, googleFinishRequest, isCallbackScheme, setupRequest, type AuthError, type AuthState, type SetupResponse } from '@gp/core';
import { constantTimeEqual, newSecret } from '../crypto.ts';
import { PASSKEY_FLOW, THROTTLE } from '../global/index.ts';
import { body, fail, FLOW_COOKIE, HANDOFF_COOKIE, type AuthKit } from './kit.ts';
import { APP_CALLBACK_JS, callbackLink, escapeHtml, page, passkeyPage, signInFailed } from './pages.ts';
import { deviceOf } from './pairing-guard.ts';

export function signInRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, google, passkeys, log, tooMany, signedIn, secure, cookie, mayAddLogin, startPasskey, start } = kit;

  // -------------------------------------------------------------- first run, sign-in, sign-out

  app.get('/api/auth/state', async (c) => c.json({ setupRequired: !(await accounts.members.setupDone()), google: !!google, passkeys: !!passkeys } satisfies AuthState));

  /** First run (D19): makes the SuperAdmin and answers with their invite, which they accept with Google or a new passkey. */
  app.post('/api/auth/setup', async (c) => {
    const a = await body(c, setupRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const address = `address:${deps.clientAddress(c)}`;
    const locked = await accounts.throttle.lockedUntil([address]);
    if (locked) return tooMany(c, locked);
    if (await accounts.members.setupDone()) return fail(c, 409, 'setup-done');
    if (!deps.setupToken || !constantTimeEqual(a.setupToken, deps.setupToken)) {
      await accounts.throttle.fail(address, THROTTLE.address);
      return fail(c, 403, 'setup-token');
    }
    // Without a way to sign in nobody could accept the invite, and the installation would be claimed by no one.
    if (!google && !passkeys) return fail(c, 503, 'google-disabled');
    const r = await accounts.members.setup({ name: a.name, orgName: a.orgName });
    if (r === 'setup-done') return fail(c, 409, 'setup-done');
    return c.json({ inviteToken: r.inviteToken } satisfies SetupResponse);
  });

  /**
   * Starts a sign-in with Google from a page: the invite and the app's
   * callback travel in this body, not in a URL. Answers with where to send
   * the browser. On a desktop host, only the host's own window may, and only
   * for itself through the system browser. With `link`, the Google account
   * is linked to the caller's session instead of signing in.
   */
  app.post('/api/auth/google/begin', async (c) => {
    const a = await body(c, googleBeginRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    if (a.app && !isCallbackScheme(a.app.callbackScheme)) return fail(c, 400, 'callback-scheme');
    if (!google) return fail(c, 503, 'google-disabled');
    if (deps.pairing && (!a.app || (await deviceOf(c.req.raw, accounts, deps.pairing)) !== 'host')) return fail(c, 403, 'forbidden');
    if (a.invite && a.link) return fail(c, 400, 'invalid-request');
    let link: { userId: string; sessionId: string } | undefined;
    if (a.link) {
      const caller = await mayAddLogin(c);
      if (caller instanceof Response) return caller;
      const mine = await accounts.logins.list(caller.ctx.userId);
      // One Google account per user, within ORG-R13's cap.
      if (mine.some((l) => l.provider === 'google') || mine.length >= ACCOUNT_LIMITS.loginsPerUser) return fail(c, 409, 'limit');
      link = { userId: caller.ctx.userId, sessionId: caller.sessionId };
    }
    if (a.invite) {
      const state = await accounts.members.invite(a.invite);
      if (state.state !== 'valid') return fail(c, 400, state.state === 'expired' ? 'invite-expired' : 'invite-invalid');
    }
    const state = await accounts.signIn.createFlow({
      address: deps.clientAddress(c),
      inviteToken: a.invite ?? null,
      deviceName: a.app?.deviceName ?? '',
      callbackScheme: a.app?.callbackScheme ?? null,
      link,
    });
    if (state === 'limit') return fail(c, 429, 'too-many-attempts', { retryAfter: 600 });
    return c.json({ url: `/api/auth/google/start?flow=${encodeURIComponent(state)}` });
  });

  app.get('/api/auth/google/start', async (c) => start(c, c.req.query('flow') ?? '', false));

  /**
   * The desktop and mobile apps' sign-in (spec 01 device sign-in), opened in
   * the system browser. The callback scheme is checked first, exactly and
   * case-sensitively, so an unknown one is refused before any sign-in starts
   * and no token is ever minted for it (AUTH-R10, ADR 0005 (7)).
   */
  app.get('/api/app-login', async (c) => {
    const scheme = c.req.query('callback_scheme') ?? 'gospelpresenter';
    if (!isCallbackScheme(scheme)) return fail(c, 400, 'callback-scheme');
    const method = c.req.query('method') ?? 'google';
    const deviceName = (c.req.query('device') ?? '').trim().slice(0, 200) || 'App';
    if (method === 'passkey') {
      // The same device sign-in with a passkey: the ceremony runs on this page, in this browser.
      if (!passkeys) return signInFailed(c, 'passkey-disabled', true);
      const state = await accounts.passkeys.createFlow({ kind: 'authenticate', address: deps.clientAddress(c), deviceName, callbackScheme: scheme });
      if (state === 'limit') return fail(c, 429, 'too-many-attempts', { retryAfter: PASSKEY_FLOW.ttlMs / 1000 });
      const options = await startPasskey(c, state);
      return typeof options === 'string' ? signInFailed(c, options, true) : passkeyPage(c, options);
    }
    if (method !== 'google') return fail(c, 400, 'invalid-request');
    if (!google) return signInFailed(c, 'google-disabled', true);
    const state = await accounts.signIn.createFlow({ address: deps.clientAddress(c), inviteToken: null, deviceName, callbackScheme: scheme });
    if (state === 'limit') return fail(c, 429, 'too-many-attempts', { retryAfter: 600 });
    return start(c, state, true);
  });

  app.get('/api/auth/app-callback.js', (c) => {
    c.header('content-type', 'text/javascript; charset=utf-8');
    c.header('cache-control', 'no-store');
    return c.body(APP_CALLBACK_JS);
  });

  /**
   * Google sends the browser back here. The flow must be the one this
   * browser started, unused and not expired; the code is traded with the
   * PKCE verifier, and the ID token verified. Then the user is found by the
   * Google account's `sub`, or linked through the flow's invite.
   */
  app.get('/api/auth/google/callback', async (c) => {
    if (!google) return signInFailed(c, 'google-disabled', false);
    const browser = getCookie(c, FLOW_COOKIE) ?? '';
    const flow = browser ? await accounts.signIn.takeFlow(c.req.query('state') ?? '', browser) : null;
    deleteCookie(c, FLOW_COOKIE, { path: '/api/auth', secure: secure(c) });
    if (!flow) {
      log({ event: 'google-refused', reason: browser ? 'unknown-state' : 'no-flow-cookie' });
      return signInFailed(c, 'google-failed', false);
    }
    const isApp = flow.callbackScheme !== null;
    const refused = (error: AuthError, reason: string) => {
      log({ event: 'google-refused', reason });
      return isApp ? signInFailed(c, error, true) : c.redirect(`/signin?error=${error}`, 302);
    };
    const code = c.req.query('code');
    if (!code) return refused('google-failed', `provider: ${c.req.query('error') ?? 'no code'}`);
    let idToken: string;
    try {
      idToken = await google.exchange(code, flow.verifier, google.redirectUri(c.req.url));
    } catch (e) {
      return refused('google-failed', String(e));
    }
    const identity = await google.verify(idToken, flow.nonce);
    if ('problem' in identity) return refused('google-failed', `id token: ${identity.problem}`);

    if (flow.link) {
      // Linking to a signed-in user: no session is made, the page goes back to their logins.
      const added = await accounts.logins.add(flow.link.userId, flow.link.sessionId, { provider: 'google', subject: identity.sub, name: identity.email }, identity.email);
      if (typeof added === 'string') {
        log({ event: 'google-refused', reason: `link: ${added}` });
        return isApp ? signInFailed(c, added, true) : c.redirect(`/logins?error=${added}`, 302);
      }
      return isApp ? page(c, 200, 'Google-kontot är kopplat', '<p>Gå tillbaka till Gospel Presenter. Du kan stänga den här fliken.</p>') : c.redirect('/logins', 302);
    }

    const who = await accounts.signIn.signInWithGoogle(identity, flow.inviteHash);
    if (typeof who === 'string') return refused(who, who);

    if (isApp) {
      // Checked again where the token is minted, whatever let the flow in (AUTH-R10).
      if (!isCallbackScheme(flow.callbackScheme)) return refused('callback-scheme', 'callback-scheme');
      const r = await signedIn(who.userId, who.orgId, flow.deviceName);
      if (!r) return refused('not-a-member', 'not-a-member');
      // The token travels in the fragment, which the app reads and no server sees (spec 01).
      const link = callbackLink(flow.callbackScheme, r);
      return page(
        c,
        200,
        'Du är inloggad',
        `<p>Gospel Presenter öppnas. Du kan stänga den här fliken.</p><p><a id="app-callback" href="${escapeHtml(link)}">Öppna Gospel Presenter</a></p><script src="/api/auth/app-callback.js"></script>`,
      );
    }
    // A web sign-in: the session is made when the page collects it, so no token is ever in a URL.
    const handoff = newSecret('');
    await accounts.signIn.setHandoff(c.req.query('state') ?? '', handoff, who.userId, who.orgId);
    cookie(c, HANDOFF_COOKIE, handoff, 120);
    return c.redirect('/signed-in', 302);
  });

  /** The page that a web sign-in returned to collects its session, once. */
  app.post('/api/auth/google/finish', async (c) => {
    const a = await body(c, googleFinishRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const handoff = getCookie(c, HANDOFF_COOKIE);
    deleteCookie(c, HANDOFF_COOKIE, { path: '/api/auth', secure: secure(c) });
    const who = handoff ? await accounts.signIn.takeHandoff(handoff) : null;
    const r = who && (await signedIn(who.userId, who.orgId, a.deviceName));
    return r ? c.json(r) : fail(c, 401, 'unauthenticated');
  });
}
