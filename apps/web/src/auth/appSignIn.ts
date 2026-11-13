import { serverChangeable, serverUrl } from '../server.ts';

// An app's sign-in (spec 01 device sign-in): never in the app's own window, since a passkey is bound to the server's
// domain. The desktop app's preload opens the system browser (apps/desktop/src/main.ts). The phone app runs it in
// ASWebAuthenticationSession, iOS's sheet for signing in, which hands back the callback URL itself
// (apps/mobile/ios/App/App/WebAuthPlugin.swift). Absent in a browser.

interface AppSignIn {
  /** The scheme the server hands the token back on. */
  callbackScheme: string;
  /** Opens a sign-in path of the server (`/api/app-login?…`, `/api/auth/google/start?…`, `/api/auth/passkey/start?…`). False if refused. */
  openSignIn(path: string): Promise<boolean>;
  /** Called with the session token when the sign-in hands it back. Returns an unsubscribe. */
  onSignInCallback(cb: (token: string) => void): () => void;
  /** Called when the sign-in ended without a token: the phone app's sheet was closed, or failed. The desktop app cannot tell. */
  onSignInEnded?(cb: (failed: boolean) => void): () => void;
}

/** The phone app's scheme: a sheet of its own catches it, so it needs no registering and meets no other app's. */
const PHONE_SCHEME = 'gospelpresenter';
const SIGN_IN_PATH = /^\/api\/(app-login|auth\/google\/start|auth\/passkey\/start)\?/;
const TOKEN = /^gpdt_[\w-]{43}$/;

interface WebAuth {
  start(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
}

function phoneSignIn(): AppSignIn {
  const signedIn = new Set<(token: string) => void>();
  const ended = new Set<(failed: boolean) => void>();
  const listen = <T>(set: Set<T>, cb: T) => {
    set.add(cb);
    return () => void set.delete(cb);
  };
  // Loaded only in the phone app, so the browser's bundle carries none of Capacitor. Wrapped: a plugin is a proxy that
  // takes `then` for a method of its own, so it cannot be a promise's value.
  const plugin = import('@capacitor/core').then(({ registerPlugin }) => ({ webAuth: registerPlugin<WebAuth>('WebAuth') }));
  const finish = (url: string) => {
    const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token') ?? '';
    if (TOKEN.test(token)) signedIn.forEach((cb) => cb(token));
    else ended.forEach((cb) => cb(true));
  };
  return {
    callbackScheme: PHONE_SCHEME,
    async openSignIn(path) {
      if (!SIGN_IN_PATH.test(path)) return false;
      const { webAuth } = await plugin;
      // Told on a later task: a sheet that fails at once must not end the sign-in before the page starts waiting for it.
      webAuth.start({ url: serverUrl(path), callbackScheme: PHONE_SCHEME }).then(
        (r) => setTimeout(() => finish(r.url)),
        (e: { code?: string }) => setTimeout(() => ended.forEach((cb) => cb(e.code !== 'cancelled'))),
      );
      return true;
    },
    onSignInCallback: (cb) => listen(signedIn, cb),
    onSignInEnded: (cb) => listen(ended, cb),
  };
}

let phone: AppSignIn | undefined;

/** The app's sign-in: the desktop app's, the phone app's (its build is the one whose server can be changed), or none. */
export function appSignIn(): AppSignIn | undefined {
  if (window.gpDesktop) return window.gpDesktop;
  if (!serverChangeable) return undefined;
  return (phone ??= phoneSignIn());
}
