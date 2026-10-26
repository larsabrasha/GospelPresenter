// Sign-in, sessions, membership and pairing over HTTP (spec 01, ADR 0007
// decisions 6 and 12). The same routes run on Node and in the Worker; pairing
// exists only where the server is a desktop host. Sign-in is with Google or
// a passkey: there are no passwords.
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  ACCOUNT_LIMITS,
  can,
  changeRoleRequest,
  createUserRefusal,
  createUserRequest,
  googleBeginRequest,
  googleFinishRequest,
  inviteRefusal,
  isCallbackScheme,
  LOGIN_PROVIDERS,
  pairClaimRequest,
  passkeyBeginRequest,
  passkeyFinishRequest,
  pairCodeRequest,
  removeUserRefusal,
  renameLoginRequest,
  roleChangeRefusal,
  roleSchema,
  setupRequest,
  type AuthError,
  type AuthState,
  type Me,
  type MutatorCtx,
  type PairClaimResponse,
  type PairStatus,
  type PasskeyBeginResponse,
  type PasskeyFinishResponse,
  type PasskeyOptions,
  type Permission,
  type SetupResponse,
  type SignInResponse,
} from '@gp/core';
import { constantTimeEqual, newDigits, newSecret } from './crypto.ts';
import { LOGIN_FLOW, PASSKEY_FLOW, THROTTLE, type Accounts, type NewLogin } from './global.ts';
import type { GoogleOidc } from './google.ts';
import { parseClientData, type Passkeys } from './webauthn.ts';

export interface Caller {
  orgId: string;
  sessionId: string;
  ctx: MutatorCtx;
  /** When the sign-in that made the session happened. */
  signedInAt: number;
  /** The session was made by pairing at a desktop host, not by the user signing in. */
  paired: boolean;
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
  return { orgId: s.orgId, sessionId: s.sessionId, ctx: { userId: s.userId, role: s.role }, signedInAt: s.createdAt, paired: s.paired };
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
/**
 * The host's own sign-in, which runs in the system browser of the host's
 * machine (spec 01 device sign-in): Google, or a passkey ceremony. That
 * browser is not paired, so these answer it, but only from this machine: a
 * device on the LAN never signs in against the host, it pairs.
 */
const LOOPBACK_PATHS = new Set([
  '/app-login',
  '/auth/google/start',
  '/auth/google/callback',
  '/auth/app-callback.js',
  '/auth/passkey/start',
  '/auth/passkey/finish',
  '/auth/passkey.js',
]);
const API_PREFIXES = ['/auth/', '/sync/', '/users', '/pair/', '/debug/', '/app-login'];

export function isApiPath(path: string): boolean {
  return API_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p));
}

/** Whether a socket address is this machine. */
export function isLoopback(address: string): boolean {
  return address === '::1' || /^(::ffff:)?127\./.test(address);
}

/** Refuses every API request from a device that is not paired, before anything else runs. */
export function pairingGuard(accounts: Accounts, pairing: Pairing, clientAddress: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    if (!isApiPath(c.req.path) || OPEN_PATHS.has(c.req.path)) return next();
    if (LOOPBACK_PATHS.has(c.req.path) && isLoopback(clientAddress(c))) return next();
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
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

async function body<T>(c: Context, schema: Schema<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, error: AuthError, extra: object = {}) =>
  c.json({ error, ...extra }, status);

/** The cookie that binds a sign-in to the browser that started it. */
const FLOW_COOKIE = 'gp_flow';
/** The cookie a web sign-in hands its session over with, once. */
const HANDOFF_COOKIE = 'gp_handoff';
/** The cookie that binds a passkey ceremony to the browser that started it. */
const PASSKEY_COOKIE = 'gp_pk';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The handover page's only script: it follows the link, so the system browser hands the app its token. */
const APP_CALLBACK_JS = `const a = document.getElementById('app-callback');\nif (a) location.href = a.href;\n`;

/**
 * The passkey page's only script, in the system browser (or any browser
 * that opens `/auth/passkey/start`): runs the ceremony with the options in
 * `data-options`, sends the credential back, and follows the app's callback
 * link if there is one. The outcome is in `data-result`, for tests.
 */
const PASSKEY_JS = `const body = document.body;
const options = JSON.parse(body.dataset.options);
const button = document.getElementById('passkey');
const status = document.getElementById('passkey-status');
const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const text = (b) => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); };
function done(result, message) { body.dataset.result = result; status.textContent = message; }
async function run() {
  button.disabled = true;
  status.textContent = '';
  let cred;
  try {
    if (options.create) {
      const o = options.create;
      cred = await navigator.credentials.create({ publicKey: { ...o, challenge: bytes(o.challenge), user: { ...o.user, id: bytes(o.user.id) },
        excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: bytes(c.id) })) } });
    } else {
      cred = await navigator.credentials.get({ publicKey: { ...options.get, challenge: bytes(options.get.challenge), allowCredentials: [] } });
    }
  } catch (e) {
    button.disabled = false;
    return done('cancelled', body.dataset.cancelled);
  }
  const r = cred.response;
  const response = options.create
    ? { clientDataJSON: text(r.clientDataJSON), attestationObject: text(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] }
    : { clientDataJSON: text(r.clientDataJSON), authenticatorData: text(r.authenticatorData), signature: text(r.signature), userHandle: r.userHandle ? text(r.userHandle) : null };
  try {
    const res = await fetch('/auth/passkey/finish', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: { id: cred.id, type: cred.type, response } }) });
    const answer = await res.json();
    if (!res.ok) { body.dataset.error = answer.error || ''; return done('failed', body.dataset.failed); }
    if (answer.callback) {
      const a = document.getElementById('app-callback');
      a.href = answer.callback;
      a.hidden = false;
      done('ok', body.dataset.signedIn);
      location.href = answer.callback;
    } else done('ok', body.dataset.added);
  } catch (e) {
    done('failed', body.dataset.failed);
  }
}
button.addEventListener('click', run);
run();
`;

function page(c: Context, status: 200 | 400 | 403 | 503, title: string, html: string, attrs = '') {
  c.header(
    'content-security-policy',
    "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  c.header('referrer-policy', 'no-referrer');
  c.header('cache-control', 'no-store');
  return c.html(
    `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>` +
      `<body${attrs} style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem"><h1>${escapeHtml(title)}</h1>${html}</body></html>`,
    status,
  );
}

/** A sign-in that cannot go on (spec 01 "/authentication-error"). The reason is in `data-error` and the log, not in the text. */
const signInFailed = (c: Context, error: AuthError, app: boolean) =>
  page(
    c,
    error === 'google-disabled' || error === 'passkey-disabled' ? 503 : 400,
    'Inloggningsfel',
    app
      ? '<p>Inloggningen misslyckades. Gå tillbaka till Gospel Presenter och försök igen.</p>'
      : '<p>Något gick fel vid inloggningen. Försök igen.</p><p><a href="/">Tillbaka till start</a></p>',
    ` data-error="${escapeHtml(error)}"`,
  );

/** The device sign-in's callback link (spec 01): the token travels in the fragment, which the app reads and no server sees. */
const callbackLink = (scheme: string, r: SignInResponse) =>
  `${scheme}://auth#${new URLSearchParams({ token: r.token, user_id: r.me.userId, organization_id: r.me.orgId })}`;

/** The page in the system browser that runs a passkey ceremony (PASSKEY_JS). */
function passkeyPage(c: Context, options: PasskeyOptions) {
  const create = 'create' in options;
  const title = create ? 'Skapa passkey' : 'Logga in med passkey';
  const data = {
    options: JSON.stringify(options),
    'signed-in': 'Du är inloggad. Gospel Presenter öppnas, och du kan stänga den här fliken.',
    added: 'Passkeyn är sparad. Gå tillbaka till Gospel Presenter.',
    failed: 'Det gick inte. Gå tillbaka till Gospel Presenter och försök igen.',
    cancelled: 'Inget hände. Försök igen.',
  };
  return page(
    c,
    200,
    title,
    `<p>${create ? 'Skapa en passkey för Gospel Presenter. Din enhet ber om fingeravtryck, ansikte eller kod.' : 'Logga in med en passkey som du har sparat för Gospel Presenter.'}</p>` +
      `<p><button id="passkey" type="button">${title}</button></p><p id="passkey-status" role="status"></p>` +
      `<p><a id="app-callback" hidden>Öppna Gospel Presenter</a></p><script src="/auth/passkey.js"></script>`,
    Object.entries(data)
      .map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`)
      .join(''),
  );
}

export function authRoutes(deps: AuthDeps) {
  const { accounts, google, passkeys } = deps;
  const freshMs = deps.freshSignInMs ?? ACCOUNT_LIMITS.freshSignInMs;
  const log = deps.log ?? (() => undefined);
  const app = new Hono();

  const tooMany = (c: Context, until: number) => {
    const seconds = Math.ceil((until - accounts.now()) / 1000);
    c.header('retry-after', String(seconds));
    return fail(c, 429, 'too-many-attempts', { retryAfter: seconds });
  };

  async function signedIn(userId: string, orgId: string, deviceName: string, pairedDeviceId: string | null = null): Promise<SignInResponse | null> {
    const member = await accounts.member(userId, orgId);
    if (!member) return null;
    const { token, sessionId } = await accounts.createSession(userId, orgId, deviceName, pairedDeviceId);
    const me = await accounts.me({ sessionId, userId, orgId, role: member.role });
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
    setCookie(c, name, value, { path: '/auth', httpOnly: true, sameSite: 'Lax', secure: secure(c), maxAge });

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
    const flow = await accounts.startPasskeyFlow(state, browser, challenge);
    if (!flow) return 'passkey-failed';
    let options: PasskeyOptions;
    if (flow.kind === 'authenticate') options = { get: passkeys.requestOptions(challenge) };
    else {
      const who = await accounts.registrant(flow);
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
    const flow = await accounts.startFlow(state, browser);
    if (!flow) return signInFailed(c, 'google-failed', forApp);
    cookie(c, FLOW_COOKIE, browser, LOGIN_FLOW.ttlMs / 1000);
    c.header('referrer-policy', 'no-referrer');
    return c.redirect(await google.authorizeUrl({ state, nonce: flow.nonce, verifier: flow.verifier, redirectUri: google.redirectUri(c.req.url) }), 302);
  }

  // -------------------------------------------------------------- first run, sign-in, sign-out

  app.get('/auth/state', async (c) => c.json({ setupRequired: !(await accounts.setupDone()), google: !!google, passkeys: !!passkeys } satisfies AuthState));

  /** First run (D19): makes the SuperAdmin and answers with their invite, which they accept with Google or a new passkey. */
  app.post('/auth/setup', async (c) => {
    const a = await body(c, setupRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const address = `address:${deps.clientAddress(c)}`;
    const locked = await accounts.lockedUntil([address]);
    if (locked) return tooMany(c, locked);
    if (await accounts.setupDone()) return fail(c, 409, 'setup-done');
    if (!deps.setupToken || !constantTimeEqual(a.setupToken, deps.setupToken)) {
      await accounts.fail(address, THROTTLE.address);
      return fail(c, 403, 'setup-token');
    }
    // Without a way to sign in nobody could accept the invite, and the installation would be claimed by no one.
    if (!google && !passkeys) return fail(c, 503, 'google-disabled');
    const r = await accounts.setup({ name: a.name, orgName: a.orgName });
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
  app.post('/auth/google/begin', async (c) => {
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
      const mine = await accounts.logins(caller.ctx.userId);
      // One Google account per user, within ORG-R13's cap.
      if (mine.some((l) => l.provider === 'google') || mine.length >= ACCOUNT_LIMITS.loginsPerUser) return fail(c, 409, 'limit');
      link = { userId: caller.ctx.userId, sessionId: caller.sessionId };
    }
    if (a.invite) {
      const state = await accounts.invite(a.invite);
      if (state.state !== 'valid') return fail(c, 400, state.state === 'expired' ? 'invite-expired' : 'invite-invalid');
    }
    const state = await accounts.createFlow({
      address: deps.clientAddress(c),
      inviteToken: a.invite ?? null,
      deviceName: a.app?.deviceName ?? '',
      callbackScheme: a.app?.callbackScheme ?? null,
      link,
    });
    if (state === 'limit') return fail(c, 429, 'too-many-attempts', { retryAfter: 600 });
    return c.json({ url: `/auth/google/start?flow=${encodeURIComponent(state)}` });
  });

  app.get('/auth/google/start', async (c) => start(c, c.req.query('flow') ?? '', false));

  /**
   * The desktop and mobile apps' sign-in (spec 01 device sign-in), opened in
   * the system browser. The callback scheme is checked first, exactly and
   * case-sensitively, so an unknown one is refused before any sign-in starts
   * and no token is ever minted for it (AUTH-R10, ADR 0005 (7)).
   */
  app.get('/app-login', async (c) => {
    const scheme = c.req.query('callback_scheme') ?? 'gospelpresenter';
    if (!isCallbackScheme(scheme)) return fail(c, 400, 'callback-scheme');
    const method = c.req.query('method') ?? 'google';
    const deviceName = (c.req.query('device') ?? '').trim().slice(0, 200) || 'App';
    if (method === 'passkey') {
      // The same device sign-in with a passkey: the ceremony runs on this page, in this browser.
      if (!passkeys) return signInFailed(c, 'passkey-disabled', true);
      const state = await accounts.createPasskeyFlow({ kind: 'authenticate', address: deps.clientAddress(c), deviceName, callbackScheme: scheme });
      if (state === 'limit') return fail(c, 429, 'too-many-attempts', { retryAfter: PASSKEY_FLOW.ttlMs / 1000 });
      const options = await startPasskey(c, state);
      return typeof options === 'string' ? signInFailed(c, options, true) : passkeyPage(c, options);
    }
    if (method !== 'google') return fail(c, 400, 'invalid-request');
    if (!google) return signInFailed(c, 'google-disabled', true);
    const state = await accounts.createFlow({ address: deps.clientAddress(c), inviteToken: null, deviceName, callbackScheme: scheme });
    if (state === 'limit') return fail(c, 429, 'too-many-attempts', { retryAfter: 600 });
    return start(c, state, true);
  });

  app.get('/auth/app-callback.js', (c) => {
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
  app.get('/auth/google/callback', async (c) => {
    if (!google) return signInFailed(c, 'google-disabled', false);
    const browser = getCookie(c, FLOW_COOKIE) ?? '';
    const flow = browser ? await accounts.takeFlow(c.req.query('state') ?? '', browser) : null;
    deleteCookie(c, FLOW_COOKIE, { path: '/auth', secure: secure(c) });
    if (!flow) {
      log({ event: 'google-refused', reason: browser ? 'unknown-state' : 'no-flow-cookie' });
      return signInFailed(c, 'google-failed', false);
    }
    const isApp = flow.callbackScheme !== null;
    const refused = (error: AuthError, reason: string) => {
      log({ event: 'google-refused', reason });
      return isApp ? signInFailed(c, error, true) : c.redirect(`/#/signin?error=${error}`, 302);
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
      const added = await accounts.addLogin(flow.link.userId, flow.link.sessionId, { provider: 'google', subject: identity.sub, name: identity.email }, identity.email);
      if (typeof added === 'string') {
        log({ event: 'google-refused', reason: `link: ${added}` });
        return isApp ? signInFailed(c, added, true) : c.redirect(`/#/logins?error=${added}`, 302);
      }
      return isApp ? page(c, 200, 'Google-kontot är kopplat', '<p>Gå tillbaka till Gospel Presenter. Du kan stänga den här fliken.</p>') : c.redirect('/#/logins', 302);
    }

    const who = await accounts.signInWithGoogle(identity, flow.inviteHash);
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
        `<p>Gospel Presenter öppnas. Du kan stänga den här fliken.</p><p><a id="app-callback" href="${escapeHtml(link)}">Öppna Gospel Presenter</a></p><script src="/auth/app-callback.js"></script>`,
      );
    }
    // A web sign-in: the session is made when the page collects it, so no token is ever in a URL.
    const handoff = newSecret('');
    await accounts.setHandoff(c.req.query('state') ?? '', handoff, who.userId, who.orgId);
    cookie(c, HANDOFF_COOKIE, handoff, 120);
    return c.redirect('/#/signed-in', 302);
  });

  /** The page that a web sign-in returned to collects its session, once. */
  app.post('/auth/google/finish', async (c) => {
    const a = await body(c, googleFinishRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    const handoff = getCookie(c, HANDOFF_COOKIE);
    deleteCookie(c, HANDOFF_COOKIE, { path: '/auth', secure: secure(c) });
    const who = handoff ? await accounts.takeHandoff(handoff) : null;
    const r = who && (await signedIn(who.userId, who.orgId, a.deviceName));
    return r ? c.json(r) : fail(c, 401, 'unauthenticated');
  });

  // -------------------------------------------------------------- passkeys

  /**
   * Starts a passkey ceremony (see `passkeyBeginRequest`). A web page gets
   * its options at once, bound to this browser by a cookie; an app gets a
   * URL for the system browser, which binds the flow when it opens it. On a
   * desktop host, only the host's own window may begin, and only through the
   * system browser, as for Google.
   */
  app.post('/auth/passkey/begin', async (c) => {
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
      if ((await accounts.logins(caller.ctx.userId)).length >= ACCOUNT_LIMITS.loginsPerUser) return fail(c, 409, 'limit');
      owner = caller;
    }
    if (a.invite) {
      const state = await accounts.invite(a.invite);
      if (state.state !== 'valid') return fail(c, 400, state.state === 'expired' ? 'invite-expired' : 'invite-invalid');
    }
    const state = await accounts.createPasskeyFlow({
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
    if (a.app) return c.json({ url: `/auth/passkey/start?flow=${encodeURIComponent(state)}` } satisfies PasskeyBeginResponse);
    const options = await startPasskey(c, state);
    if (typeof options === 'string') return fail(c, 400, options);
    return c.json({ options } satisfies PasskeyBeginResponse);
  });

  /** The system browser opens an app's ceremony here: the flow is bound to it, and the page runs the ceremony. */
  app.get('/auth/passkey/start', async (c) => {
    const options = await startPasskey(c, c.req.query('flow') ?? '');
    if (typeof options !== 'string') return passkeyPage(c, options);
    log({ event: 'passkey-refused', reason: `start: ${options}` });
    return signInFailed(c, options, true);
  });

  app.get('/auth/passkey.js', (c) => {
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
  app.post('/auth/passkey/finish', async (c) => {
    const a = await body(c, passkeyFinishRequest);
    if (!a) return fail(c, 400, 'invalid-request');
    if (!passkeys) return fail(c, 503, 'passkey-disabled');
    const browser = getCookie(c, PASSKEY_COOKIE) ?? '';
    deleteCookie(c, PASSKEY_COOKIE, { path: '/auth', secure: secure(c) });
    const cred = a.credential;
    const kind = cred.response.attestationObject !== undefined ? 'register' : 'authenticate';
    const cd = parseClientData(cred.response.clientDataJSON);
    const flow = browser && cd ? await accounts.takePasskeyFlow(cd.challenge, browser, kind) : null;
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
        const added = await accounts.addLogin(flow.userId ?? '', flow.sessionId ?? '', login);
        if (typeof added === 'string') return refused(added, added);
        return c.json((flow.callbackScheme ? { done: true } : { added }) satisfies PasskeyFinishResponse);
      }
      const r = await accounts.acceptInvite(flow.inviteHash, login);
      if (typeof r === 'string') return refused(r, r);
      who = r;
    } else {
      const stored = await accounts.passkey(cred.id);
      if (!stored) return refused('passkey-failed', 'unknown-credential');
      const v = await passkeys.verifyAssertion(cred, cd, stored);
      if ('problem' in v) return refused('passkey-failed', v.problem);
      if (!(await accounts.usePasskey(cred.id, stored.signCount, v.signCount))) return refused('passkey-failed', 'counter-race');
      const r = await accounts.signedInAs(stored.userId);
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

  // -------------------------------------------------------------- your own logins (never another user's: no user id is taken)

  app.get(
    '/auth/logins',
    withCaller(null, async (c, caller) => c.json(await accounts.logins(caller.ctx.userId))),
  );

  app.patch(
    '/auth/logins/passkey/:id',
    withCaller(null, async (c, caller) => {
      const a = await body(c, renameLoginRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      return (await accounts.renamePasskey(caller.ctx.userId, c.req.param('id')!, a.name)) ? c.json({ ok: true }) : fail(c, 404, 'not-found');
    }),
  );

  /** Removes one of your own logins, never the last one: then only an admin's new invite would let you in. */
  app.delete(
    '/auth/logins/:provider/:id',
    withCaller(null, async (c, caller) => {
      // A paired device was signed in by whoever paired it, not by the user: it does not manage their logins.
      if (caller.paired) return fail(c, 403, 'forbidden');
      const provider = c.req.param('provider')!;
      if (!(LOGIN_PROVIDERS as readonly string[]).includes(provider)) return fail(c, 404, 'not-found');
      const r = await accounts.removeLogin(caller.ctx.userId, provider, c.req.param('id')!);
      return r === 'ok' ? c.json({ ok: true }) : r === 'last-login' ? fail(c, 409, 'last-login') : fail(c, 404, 'not-found');
    }),
  );

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
    /** The code buys the device its token and a session as the user the host chose: on a host, pairing is how a device signs in. */
    app.post('/pair/claim', async (c) => {
      const a = await body(c, pairClaimRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const address = `address:${deps.clientAddress(c)}`;
      const locked = await accounts.lockedUntil([address]);
      if (locked) return tooMany(c, locked);
      const claimed = await accounts.claimPairCode(a.code, a.name, ACCOUNT_LIMITS.pairCodeAttempts);
      if (!claimed) {
        await accounts.fail(address, THROTTLE.address);
        return fail(c, 400, 'pair-code-invalid');
      }
      const session = await signedIn(claimed.userId, claimed.orgId, a.name, claimed.deviceId);
      if (!session) {
        // The user was removed while the code waited.
        await accounts.revokeDevice(claimed.deviceId);
        return fail(c, 400, 'pair-code-invalid');
      }
      return c.json({ device: claimed.token, session } satisfies PairClaimResponse);
    });

    /** Only the host's own window, signed in with ManageUsers: whoever pairs a device is at the host. */
    const atHost = (fn: (c: Context, caller: Caller) => Promise<Response>) =>
      withCaller('ManageUsers', async (c, caller) => ((await deviceOf(c.req.raw, accounts, pairing)) === 'host' ? fn(c, caller) : fail(c, 403, 'forbidden')));

    /** A code that signs the device in as a member: the caller, or someone they may make an invite for (D20, D21). */
    app.post(
      '/pair/code',
      atHost(async (c, caller) => {
        const a = await body(c, pairCodeRequest);
        if (!a) return fail(c, 400, 'invalid-request');
        const t = await target(caller, a.userId ?? caller.ctx.userId);
        if (!t) return fail(c, 404, 'not-found');
        const refusal = inviteRefusal(actor(caller), t);
        if (refusal) return fail(c, 403, refusal);
        const code = newDigits(6);
        return c.json({ code, expiresAt: await accounts.newPairCode(code, ACCOUNT_LIMITS.pairCodeTtlMs, t.id, caller.orgId) });
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
    app.get('/debug/counts', async (c) => c.json(await accounts.debugCounts()));
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
