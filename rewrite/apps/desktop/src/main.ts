// The Electron main process (ADR 0007, decision 6). By default it starts the
// embedded server and is the host. With GP_SERVER it is a second client of
// another machine's server instead (the "Other server" of D8, as an env var
// for now), and pairs with it like any other device.
//
// Signing in (spec 01 device sign-in): neither Google nor a passkey ceremony
// runs in the app's own windows. The system browser opens the server's
// `/api/app-login` (or a flow the window began), and the server hands the token
// back to this app's callback scheme. Passkeys run there rather than in
// Electron, whose support for platform authenticators (Touch ID, iCloud
// Keychain) is unreliable; and at http://localhost rather than 127.0.0.1,
// because an IP address cannot be a passkey's RP ID.
import { randomBytes } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import type { GoogleConfig } from '@gp/server';
import { mailConfigFrom } from '@gp/server/node';
import { lanUrls, pageUrl, startHost } from './host.ts';
import { setAppMenu } from './menu.ts';
import { outputWindows } from './outputs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
/**
 * The host's fixed port. Its address must not change between starts: devices
 * on the LAN reconnect to it, and the host window's own storage (its session
 * and its OPFS database) belongs to its origin.
 */
const HOST_PORT = 47800;
const log = (event: object) => process.stdout.write(JSON.stringify(event) + '\n');

if (process.env.GP_DATA_DIR) app.setPath('userData', process.env.GP_DATA_DIR);

/**
 * This installation's callback scheme (ADR 0005 (5)): `gospelpresenter` once
 * packaged, `gospelpresenter-local` for a development build. A Test build
 * would be `gospelpresenter-test`; there is no packaging yet.
 */
const CALLBACK_SCHEME = app.isPackaged ? 'gospelpresenter' : 'gospelpresenter-local';
/** How long a sign-in in the system browser may take (spec 06). */
const SIGN_IN_WAIT_MS = 5 * 60_000;

/**
 * The host's Google client, from the environment. A fake issuer
 * (`GP_GOOGLE_TEST_ISSUER`, the e2e tests) is never read by a packaged app,
 * and the server refuses one unless the build allows it (build.mjs).
 */
function googleConfig(): GoogleConfig | undefined {
  const clientId = process.env.GP_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GP_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  const testIssuer = app.isPackaged ? undefined : process.env.GP_GOOGLE_TEST_ISSUER || undefined;
  return { clientId, clientSecret, testIssuer };
}

// One running instance per data folder: on Windows and Linux the callback
// arrives as a second launch, whose arguments are forwarded here (DESK-R10).
if (!app.requestSingleInstanceLock()) app.quit();
// A development build would register the Electron binary for the scheme; only when asked (GP_REGISTER_SCHEME=1).
if (app.isPackaged || process.env.GP_REGISTER_SCHEME === '1') {
  if (app.isPackaged) app.setAsDefaultProtocolClient(CALLBACK_SCHEME);
  else app.setAsDefaultProtocolClient(CALLBACK_SCHEME, process.execPath, [fileURLToPath(new URL('main.mjs', import.meta.url))]);
}

/**
 * The automated tests run the app with no visible window, so it never takes
 * focus or a screen from whoever is at the computer: windows are made but
 * never shown, there is no Dock icon, and the output never claims a second
 * display. Hidden windows still render; throttling is off so timers keep
 * pace. A packaged app ignores it.
 */
const hidden = !app.isPackaged && process.env.GP_HIDDEN_WINDOWS === '1';

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: join(here, 'preload.cjs'),
  // The session's audio may start on a command from a remote controller, with no click in this window (spec 04 §1b).
  autoplayPolicy: 'no-user-gesture-required' as const,
  ...(hidden ? { backgroundThrottling: false } : {}),
};

let base = '';
let mainWindow: BrowserWindow | null = null;
const outputs = outputWindows({ hidden, webPreferences, main: () => mainWindow, guard: (win) => guardWindow(win), url: () => pageUrl(base, 'output'), log: (entry) => log(entry) });
/** The one sign-in that may be waiting for its callback (spec 06): until when. */
let signInUntil = 0;

/**
 * A callback URL from the operating system: `{scheme}://auth#token=…`. Taken
 * only while a sign-in waits, only on this installation's scheme, and only
 * with a token of the right shape; anything else is ignored (spec 06).
 */
function signInCallback(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== `${CALLBACK_SCHEME}:` || u.host !== 'auth') return;
  const waiting = Date.now() < signInUntil;
  const token = new URLSearchParams(u.hash.slice(1)).get('token') ?? '';
  log({ event: 'sign-in-callback', accepted: waiting && /^gpdt_[\w-]{43}$/.test(token) });
  if (!waiting || !/^gpdt_[\w-]{43}$/.test(token)) return;
  signInUntil = 0;
  mainWindow?.webContents.send('sign-in-callback', token);
  if (hidden) return;
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
}

app.on('open-url', (e, url) => {
  e.preventDefault();
  signInCallback(url);
});
app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => a.startsWith(`${CALLBACK_SCHEME}://`));
  if (url) signInCallback(url);
  else if (!hidden) mainWindow?.focus();
});

/**
 * Where the system browser runs a passkey ceremony: the same server, named
 * `localhost` when it is 127.0.0.1, since an IP address cannot be an RP ID.
 * Each sign-in stays on one host name from start to end, so its cookie holds:
 * Google's stays on 127.0.0.1, where its redirect URI is registered.
 */
function passkeyBase(serverBase: string): string {
  const u = new URL(serverBase);
  if (u.hostname === '127.0.0.1') u.hostname = 'localhost';
  return u.origin;
}

/**
 * Keeps a window on the app (Electron's security checklist): a link out (Om Gospel Presenter's) opens in the system
 * browser, and the page never navigates to another origin, where the preload's door would be open to it.
 */
function guardWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== new URL(base).origin) e.preventDefault();
  });
}

/** Only the server this window was loaded from: no request leaves for the internet. */
function lockNetwork(origin: string) {
  const allowed = new Set([origin, origin.replace(/^http/, 'ws')]);
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    const u = new URL(details.url);
    const ok = allowed.has(u.origin) || ['devtools:', 'data:', 'blob:'].includes(u.protocol);
    if (!ok) log({ event: 'blocked-request', url: details.url });
    done({ cancel: !ok });
  });
}

/**
 * The host's own windows are its paired device: every request they make to
 * the embedded server carries the host token, added here so no page ever
 * holds it. The token lives in this process only, new at every start.
 */
function actAsHostDevice(origin: string, hostToken: string) {
  const origins = new Set([origin, origin.replace(/^http/, 'ws')]);
  session.defaultSession.webRequest.onBeforeSendHeaders((details, done) => {
    const headers = details.requestHeaders;
    if (origins.has(new URL(details.url).origin)) headers['x-gp-device'] = hostToken;
    done({ requestHeaders: headers });
  });
}

app.whenReady().then(async () => {
  let setupToken: string | null = null;
  let port = 0;
  let tlsPort: number | null = null;
  if (process.env.GP_SERVER) {
    base = process.env.GP_SERVER.replace(/\/$/, '');
  } else {
    const hostToken = `gphost_${randomBytes(32).toString('base64url')}`;
    const hostPort = Number(process.env.GP_PORT || HOST_PORT);
    const server = await startHost({
      dataDir: app.getPath('userData'),
      webRoot: process.env.GP_WEB_ROOT ?? join(here, '..', '..', 'web', 'dist'),
      port: hostPort,
      hostToken,
      google: googleConfig(),
      // The system browser on this machine runs the ceremonies, at localhost: passkeys made here work only here.
      passkeys: { rpId: 'localhost', origins: [passkeyBase(`http://127.0.0.1:${hostPort}`)] },
      // E-mail, when the host is given a Resend key, a sender and the address links point at (serve.ts has the same).
      mail: mailConfigFrom({ apiKey: process.env.GP_RESEND_API_KEY, from: process.env.GP_MAIL_FROM, appUrl: process.env.GP_APP_URL, endpoint: process.env.GP_RESEND_URL }),
    });
    base = server.url;
    port = server.port;
    tlsPort = server.tls?.port ?? null;
    setupToken = server.setupToken;
    actAsHostDevice(new URL(base).origin, hostToken);
  }
  lockNetwork(new URL(base).origin);
  ipcMain.on('open-output', (_e, target: unknown) => typeof target === 'string' && outputs.show(target));
  ipcMain.on('close-output', (_e, target: unknown) => outputs.hide(typeof target === 'string' ? target : undefined));
  ipcMain.handle('outputs-open', () => outputs.openTargets());
  ipcMain.handle('output-displays', () => outputs.displays());
  ipcMain.on('is-host', (e) => (e.returnValue = !process.env.GP_SERVER));
  ipcMain.on('device-name', (e) => (e.returnValue = hostname()));
  // Only on the host, and only if no user existed at start: the window that sets the host up gets the token.
  ipcMain.handle('setup-token', () => setupToken);
  ipcMain.handle('lan-urls', () => (port ? lanUrls(port, tlsPort) : []));
  // The disk the app's data is on, for the cache limit's range (Lagring på den här enheten).
  ipcMain.handle('disk-space', async () => {
    const s = await statfs(app.getPath('userData'));
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  });
  ipcMain.on('callback-scheme', (e) => (e.returnValue = CALLBACK_SCHEME));
  // Opens a sign-in of this app's own server in the system browser: only its entry paths, never another URL.
  ipcMain.handle('open-sign-in', async (_e, path: unknown) => {
    if (typeof path !== 'string' || !/^\/api\/(app-login|auth\/google\/start|auth\/passkey\/start)\?/.test(path)) return false;
    signInUntil = Date.now() + SIGN_IN_WAIT_MS;
    const passkey = path.startsWith('/api/auth/passkey/') || new URLSearchParams(path.split('?')[1]).get('method') === 'passkey';
    await shell.openExternal(new URL(path, passkey ? passkeyBase(base) : base).toString());
    return true;
  });

  if (hidden) app.dock?.hide();
  setAppMenu(
    () => mainWindow,
    (command) => mainWindow?.webContents.send('menu', command),
  );
  // On a Mac the title bar is hidden and the window's buttons sit in the page's own bar, which reaches the top, as
  // macOS's own apps (Lars, 2026-11-02); the page leaves room for them and lets its bar move the window.
  const main = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Gospel Presenter',
    show: !hidden,
    webPreferences,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 19 } } : {}),
  });
  mainWindow = main;
  guardWindow(main);
  outputs.watchDisplays(main);
  await main.loadURL(pageUrl(base));
  main.on('closed', () => app.quit());
  log({ event: 'ready', base, host: !process.env.GP_SERVER, lan: port ? lanUrls(port, tlsPort) : [], electron: process.versions.electron });
});
