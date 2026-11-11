// The server this app talks to. In a browser and the desktop app it is the page's own: the app came from it. The
// phone app (Capacitor) is in the phone, so it talks to the cloud by default, built in as GP_APP_SERVER, and a
// church that runs its own server types its address in a setting tucked away at the foot of the sign-in page, as
// apps one may host oneself have it (Lars, 2026-11-03). The choice is kept on the device.

declare const GP_APP_SERVER: string | undefined;
/** The phone app's default server, set when it is built; '' in the browser's build. */
const BUILT_SERVER = typeof GP_APP_SERVER === 'string' ? GP_APP_SERVER : '';

const KEY = 'gp.server';

/** Whether this is the phone app's build, where the server can be changed. */
export const serverChangeable = !!BUILT_SERVER;

/** The server's origin without a trailing slash: one chosen on the device, else the built-in one; '' for the page's own. */
function chosenServer(): string {
  try {
    return localStorage.getItem(KEY) || BUILT_SERVER;
  } catch {
    return BUILT_SERVER;
  }
}

/** Whether the server is the built-in one rather than one typed on this device. */
export function serverIsDefault(): boolean {
  return chosenServer() === BUILT_SERVER;
}

/** Keeps `origin` as the device's server; null goes back to the built-in one. */
export function chooseServer(origin: string | null) {
  try {
    if (origin) localStorage.setItem(KEY, new URL(origin).origin);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage refused: the choice lasts until the app closes, which the first start asks again for.
  }
}

/** The server's origin: the chosen one, else this page's. */
export function serverOrigin(): string {
  return chosenServer() || location.origin;
}

/** `path` (`/api/…`) on the server; a URL that is already whole is left as it is. */
export function serverUrl(path: string): string {
  return path.startsWith('/') ? `${chosenServer()}${path}` : path;
}

/** `path` on the server as a WebSocket address (`ws:` or `wss:`), from `origin` (a worker passes its own). */
export function socketUrl(path: string, origin = serverOrigin()): string {
  return new URL(path, origin.replace(/^http/, 'ws')).toString();
}
