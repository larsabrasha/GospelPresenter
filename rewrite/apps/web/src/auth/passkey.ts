import type { LoginMethod, PasskeyBeginResponse, PasskeyCredentialJson, PasskeyFinishResponse, PasskeyOptions, SignInResponse } from '@gp/core';
import { t } from '../i18n.ts';
import { api } from './api.ts';
import { errorText } from './errors.ts';
import { deviceName } from './session.ts';

// Passkeys (WebAuthn). In a browser the ceremony runs in this page, against
// this origin's RP ID. In the desktop app it never runs in the app's own
// window: Electron's support for platform authenticators (Touch ID, iCloud
// Keychain) is unreliable, and the window's 127.0.0.1 origin cannot have an
// RP ID at all. The system browser runs it at http://localhost instead, and
// the server hands a token back through the app's callback scheme, as for
// Google (spec 01 device sign-in).

const bytes = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
function text(b: ArrayBuffer): string {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Whether this page can run a ceremony itself (a secure context with WebAuthn). */
export function passkeysInPage(): boolean {
  return typeof window.PublicKeyCredential === 'function' && isSecureContext;
}

/** Runs the ceremony the server's options ask for. Rejects when the person cancels or the authenticator refuses. */
export async function ceremony(options: PasskeyOptions): Promise<PasskeyCredentialJson> {
  if ('create' in options) {
    const o = options.create;
    const cred = (await navigator.credentials.create({
      publicKey: {
        ...o,
        challenge: bytes(o.challenge),
        user: { ...o.user, id: bytes(o.user.id) },
        excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: bytes(c.id), transports: c.transports as AuthenticatorTransport[] | undefined })),
      },
    })) as PublicKeyCredential;
    const r = cred.response as AuthenticatorAttestationResponse;
    return {
      id: cred.id,
      type: 'public-key',
      response: { clientDataJSON: text(r.clientDataJSON), attestationObject: text(r.attestationObject), transports: r.getTransports?.() ?? [] },
    };
  }
  const o = options.get;
  const cred = (await navigator.credentials.get({ publicKey: { ...o, challenge: bytes(o.challenge), allowCredentials: [] } })) as PublicKeyCredential;
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    type: 'public-key',
    response: {
      clientDataJSON: text(r.clientDataJSON),
      authenticatorData: text(r.authenticatorData),
      signature: text(r.signature),
      userHandle: r.userHandle ? text(r.userHandle) : null,
    },
  };
}

/** Begins in this page, runs the ceremony and sends the credential back. An error text, or the server's answer. */
async function inPage<T extends PasskeyFinishResponse>(begin: object): Promise<string | T> {
  const r = await api<PasskeyBeginResponse>('POST', '/api/auth/passkey/begin', begin);
  if (r.error || !('options' in r.body)) return errorText(r);
  let credential: PasskeyCredentialJson;
  try {
    credential = await ceremony(r.body.options);
  } catch {
    return t('passkey.cancelled');
  }
  const f = await api<T>('POST', '/api/auth/passkey/finish', { credential, deviceName: deviceName() });
  return f.error ? errorText(f) : f.body;
}

/**
 * Signs in with a passkey, or with `invite` accepts it by making one.
 * Resolves to an error text, the session (in a browser), or null once the
 * system browser has it (the desktop app then waits for its callback).
 */
export async function startPasskey(invite?: string): Promise<string | SignInResponse | null> {
  const desktop = window.gpDesktop;
  try {
    if (desktop) {
      let path = `/api/app-login?${new URLSearchParams({ method: 'passkey', device: deviceName(), callback_scheme: desktop.callbackScheme })}`;
      if (invite) {
        const r = await api<PasskeyBeginResponse>('POST', '/api/auth/passkey/begin', {
          mode: 'register',
          invite,
          app: { deviceName: deviceName(), callbackScheme: desktop.callbackScheme },
        });
        if (r.error || !('url' in r.body)) return errorText(r);
        path = r.body.url;
      }
      return (await desktop.openSignIn(path)) ? null : t('auth.failed');
    }
    if (!passkeysInPage()) return t('passkey.unsupported');
    return await inPage<SignInResponse>(invite ? { mode: 'register', invite } : { mode: 'signin' });
  } catch {
    return t('auth.offline');
  }
}

/**
 * Adds a passkey named `name` to the signed-in user. An error text, the new
 * passkey (in a browser), or null once the system browser has the ceremony.
 */
export async function addPasskey(name: string): Promise<string | LoginMethod | null> {
  const desktop = window.gpDesktop;
  try {
    if (desktop) {
      const r = await api<PasskeyBeginResponse>('POST', '/api/auth/passkey/begin', {
        mode: 'register',
        name,
        app: { deviceName: deviceName(), callbackScheme: desktop.callbackScheme },
      });
      if (r.error || !('url' in r.body)) return errorText(r);
      return (await desktop.openSignIn(r.body.url)) ? null : t('auth.failed');
    }
    if (!passkeysInPage()) return t('passkey.unsupported');
    const r = await inPage<{ added: LoginMethod }>({ mode: 'register', name });
    return typeof r === 'string' ? r : r.added;
  } catch {
    return t('auth.offline');
  }
}

/** Links a Google account to the signed-in user. An error text, or null once the browser is on its way. */
export async function linkGoogle(): Promise<string | null> {
  const desktop = window.gpDesktop;
  try {
    const app = desktop ? { deviceName: deviceName(), callbackScheme: desktop.callbackScheme } : undefined;
    const r = await api<{ url: string }>('POST', '/api/auth/google/begin', { link: true, app });
    if (r.error) return errorText(r);
    if (desktop) return (await desktop.openSignIn(r.body.url)) ? null : t('auth.failed');
    location.assign(r.body.url);
    return null;
  } catch {
    return t('auth.offline');
  }
}
