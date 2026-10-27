import { useEffect, useState } from 'react';
import type { Me, SignInResponse } from '@gp/core';
import { t } from '../i18n.ts';
import { api } from './api.ts';
import { errorText } from './errors.ts';
import { startPasskey } from './passkey.ts';
import { deviceName } from './session.ts';

// Sign-in with Google (spec 01). In a browser the page goes to Google and
// comes back to `/signed-in`. In the desktop app Google is never shown in
// the app's own window: the system browser signs in, and the server hands
// the token back through the app's callback scheme (spec 01 device sign-in).

/** How long the desktop app waits for the system browser (spec 06: 5 minutes). */
const WAIT_MS = 5 * 60_000;

/**
 * Starts a sign-in, optionally accepting `invite`. Resolves to an error
 * text, or null once the browser has been sent on its way (a web page is
 * then leaving; the desktop app waits for its callback).
 */
export async function startGoogle(invite?: string): Promise<string | null> {
  const desktop = window.gpDesktop;
  try {
    let path: string;
    if (desktop && !invite) {
      path = `/app-login?${new URLSearchParams({ device: deviceName(), callback_scheme: desktop.callbackScheme })}`;
    } else {
      const app = desktop ? { deviceName: deviceName(), callbackScheme: desktop.callbackScheme } : undefined;
      const r = await api<{ url: string }>('POST', '/auth/google/begin', { invite, app });
      if (r.error) return errorText(r);
      path = r.body.url;
    }
    if (desktop) return (await desktop.openSignIn(path)) ? null : t('auth.failed');
    location.assign(path);
    return null;
  } catch {
    return t('auth.offline');
  }
}

/**
 * A sign-in with Google or a passkey, and in the desktop app its side of the
 * system browser: whether it is waiting, and the callback that ends it. A
 * token from the callback is checked with `GET /auth/me` before it is kept.
 */
export function useDesktopSignIn(onSignedIn: (r: SignInResponse) => void) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const desktop = window.gpDesktop;
    if (!desktop) return;
    return desktop.onSignInCallback(async (token) => {
      try {
        const r = await api<Me>('GET', '/auth/me', undefined, { token });
        if (r.error) throw new Error(r.error);
        onSignedIn({ token, me: r.body });
      } catch {
        setWaiting(false);
        setError(t('auth.failed'));
      }
    });
  }, [onSignedIn]);
  useEffect(() => {
    if (!waiting) return;
    // Abandoned in the browser: back to the button, quietly (spec 06).
    const timer = setTimeout(() => setWaiting(false), WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  const run = async (starter: () => Promise<string | SignInResponse | null>) => {
    setError(null);
    const r = await starter();
    if (typeof r === 'string') setError(r);
    else if (r) onSignedIn(r);
    else if (window.gpDesktop) setWaiting(true);
  };
  return {
    waiting,
    error,
    start: (invite?: string) => run(() => startGoogle(invite)),
    passkey: (invite?: string) => run(() => startPasskey(invite)),
    cancel: () => setWaiting(false),
    setError,
  };
}
