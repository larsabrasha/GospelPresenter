// What the desktop app's preload gives a page (apps/desktop/src/preload.ts). Absent in a browser.
interface Window {
  gpDesktop?: {
    /** Opens the output on a display (its id) or in a window of its own ('window'), or brings it forward. */
    openOutput(target: string): void;
    /** Closes the output on `target`, or every output with none. */
    closeOutput(target?: string): void;
    /** Where an output is open now. */
    outputsOpen(): Promise<string[]>;
    /** Called whenever an output opens or closes, however it closed, with where they are open. Returns an unsubscribe. */
    onOutputsChanged(cb: (open: string[]) => void): () => void;
    /** Every display the main window does not stand on, named by the operating system. */
    outputDisplays(): Promise<{ id: string; name: string }[]>;
    /** Called when a display comes or goes, or the main window moves to another. Returns an unsubscribe. */
    onDisplaysChanged(cb: () => void): () => void;
    /** The window's title bar is hidden on a Mac: the page's bar holds the window's buttons and moves the window. */
    macFrame?: boolean;
    /** A choice in the menu bar the page has no key for (Inställningar…). Returns an unsubscribe. */
    onMenu?(cb: (command: string) => void): () => void;
    /** This app runs the host (the embedded server), rather than being a client of another machine's server. */
    isHost: boolean;
    /** This machine's name, for the server's device lists. */
    deviceName: string;
    /** The host's first-run setup token, while setup is pending on this machine's own server. */
    setupToken(): Promise<string | null>;
    /** Addresses other devices on the LAN can open, when the host listens there. */
    lanUrls(): Promise<string[]>;
    /** The size and free room of the disk the app's data is on, in bytes (`fs.statfs`). */
    diskSpace(): Promise<{ total: number; free: number }>;
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
