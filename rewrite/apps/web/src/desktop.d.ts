// What the desktop app's preload gives a page (apps/desktop/src/preload.ts). Absent in a browser.
interface Window {
  gpDesktop?: {
    openOutput(): void;
    /** This machine's name, for the server's device lists. */
    deviceName: string;
    /** The host's first-run setup token, while setup is pending on this machine's own server. */
    setupToken(): Promise<string | null>;
    /** Addresses other devices on the LAN can open, when the host listens there. */
    lanUrls(): Promise<string[]>;
    /** The scheme this installation receives its sign-in on (spec 01 device sign-in, ADR 0005). */
    callbackScheme: string;
    /**
     * Opens a sign-in path of this window's server (`/api/app-login?…` or
     * `/api/auth/google/start?…`) in the system browser, and waits up to 5
     * minutes for the callback. False if the main process refused it.
     */
    openSignIn(path: string): Promise<boolean>;
    /** Called with the session token when the system browser hands it back. Returns an unsubscribe. */
    onSignInCallback(cb: (token: string) => void): () => void;
  };
}
