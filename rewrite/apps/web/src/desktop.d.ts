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
  };
}
