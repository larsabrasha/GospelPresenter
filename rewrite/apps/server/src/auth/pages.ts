// The pages the server renders itself, in the system browser or any browser:
// the sign-in error, the app's handover, and the passkey ceremony, with their scripts.
import type { Context } from 'hono';
import type { AuthError, PasskeyOptions, SignInResponse } from '@gp/core';

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The handover page's only script: it follows the link, so the system browser hands the app its token. */
export const APP_CALLBACK_JS = `const a = document.getElementById('app-callback');\nif (a) location.href = a.href;\n`;

/**
 * The passkey page's only script, in the system browser (or any browser
 * that opens `/api/auth/passkey/start`): runs the ceremony with the options in
 * `data-options`, sends the credential back, and follows the app's callback
 * link if there is one. The outcome is in `data-result`, for tests.
 */
export const PASSKEY_JS = `const body = document.body;
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
    const res = await fetch('/api/auth/passkey/finish', { method: 'POST', headers: { 'content-type': 'application/json' },
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

export function page(c: Context, status: 200 | 400 | 403 | 503, title: string, html: string, attrs = '') {
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
export const signInFailed = (c: Context, error: AuthError, app: boolean) =>
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
export const callbackLink = (scheme: string, r: SignInResponse) =>
  `${scheme}://auth#${new URLSearchParams({ token: r.token, user_id: r.me.userId, organization_id: r.me.orgId })}`;

/** The page in the system browser that runs a passkey ceremony (PASSKEY_JS). */
export function passkeyPage(c: Context, options: PasskeyOptions) {
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
      `<p><a id="app-callback" hidden>Öppna Gospel Presenter</a></p><script src="/api/auth/passkey.js"></script>`,
    Object.entries(data)
      .map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`)
      .join(''),
  );
}
