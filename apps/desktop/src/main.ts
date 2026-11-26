// The Electron main process (ADR 0007, decision 6). It is a client of the
// server its first start chose (our cloud, another server: D8, connection.ts),
// signing in or pairing as any device does; or, with none chosen, it starts
// the embedded server and is the host. GP_SERVER in the environment wins.
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
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import type { GoogleConfig } from '@gp/server';
import { mailConfigFrom, type RunningServer } from '@gp/server/node';
import { answers, CLOUD, savedServer, saveServer, serverUrl } from './connection.ts';
import { lanUrls, pageUrl, startHost } from './host.ts';
import { setAppMenu } from './menu.ts';
import { allowsPermission } from './permissions.ts';
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

/** The release's Google client, built in by build.mjs; a development build has none. */
declare const GP_BUILT_GOOGLE: { clientId: string; clientSecret: string } | undefined;

/**
 * The host's Google client, from the environment, else the one a release was built with (docs/desktop-app.md). A
 * fake issuer (`GP_GOOGLE_TEST_ISSUER`, the e2e tests) is never read by a packaged app, and the server refuses one
 * unless the build allows it (build.mjs).
 */
function googleConfig(): GoogleConfig | undefined {
  const built = typeof GP_BUILT_GOOGLE === 'object' ? GP_BUILT_GOOGLE : undefined;
  const clientId = process.env.GP_GOOGLE_CLIENT_ID || built?.clientId;
  const clientSecret = process.env.GP_GOOGLE_CLIENT_SECRET || built?.clientSecret;
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
  session.defaultSession.setPermissionRequestHandler((_contents, permission, done) => done(allowsPermission(permission)));
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

/** The embedded server while this machine is the host; null while the app is a client of another server. */
let host: RunningServer | null = null;
/** While setup is pending on this machine's own server: its token, for the window that sets it up. */
let setupToken: string | null = null;

/**
 * Starts as a client of `server`, or with none as the host, whose embedded server runs only then (connection.ts). The
 * windows may reach the one origin only (lockNetwork).
 */
async function connect(server: string | null) {
  if (server) {
    base = server;
    setupToken = null;
  } else {
    const hostToken = `gphost_${randomBytes(32).toString('base64url')}`;
    const hostPort = Number(process.env.GP_PORT || HOST_PORT);
    host = await startHost({
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
    base = host.url;
    setupToken = host.setupToken;
    actAsHostDevice(new URL(base).origin, hostToken);
  }
  lockNetwork(new URL(base).origin);
}

/**
 * Goes to `server`, or with none back to this machine as the host: the outputs close, the host's server stops or
 * starts, the choice is kept for the next start, and the window opens the new origin, whose data is its own (D3).
 */
async function reconnect(server: string | null) {
  outputs.hide();
  if (host) await host.close();
  host = null;
  saveServer(app.getPath('userData'), server);
  await connect(server);
  log({ event: 'connected', base, host: !!host });
  await mainWindow?.loadURL(pageUrl(base));
}

app.whenReady().then(async () => {
  await connect(process.env.GP_SERVER?.replace(/\/$/, '') ?? savedServer(app.getPath('userData')));
  ipcMain.on('open-output', (_e, target: unknown) => typeof target === 'string' && outputs.show(target));
  ipcMain.on('close-output', (_e, target: unknown) => outputs.hide(typeof target === 'string' ? target : undefined));
  ipcMain.handle('outputs-open', () => outputs.openTargets());
  ipcMain.handle('output-displays', () => outputs.displays());
  ipcMain.on('is-host', (e) => (e.returnValue = !!host));
  ipcMain.on('cloud', (e) => (e.returnValue = CLOUD));
  // GP_SERVER decides the server (the e2e tests, development): no page offers to change it.
  ipcMain.on('server-fixed', (e) => (e.returnValue = !!process.env.GP_SERVER));
  // The first start's choice, on the host's own page only: a server's page never sends the app elsewhere. A server
  // that does not answer is refused before the host is left. Not while GP_SERVER decides.
  ipcMain.handle('connect-server', async (_e, typed: unknown) => {
    if (!host || process.env.GP_SERVER) return 'refused';
    const server = typeof typed === 'string' ? serverUrl(typed) : null;
    if (!server) return 'invalid';
    if (!(await answers(server))) return 'unreachable';
    await reconnect(server);
    return 'ok';
  });
  // Back to this machine as the host, from a server's sign-in page ("Byt server").
  ipcMain.handle('leave-server', async () => {
    if (host || process.env.GP_SERVER) return false;
    await reconnect(null);
    return true;
  });
  ipcMain.on('device-name', (e) => (e.returnValue = hostname()));
  // Only on the host, and only if no user existed at start: the window that sets the host up gets the token.
  ipcMain.handle('setup-token', () => setupToken);
  ipcMain.handle('lan-urls', () => (host ? lanUrls(host.port, host.tls?.port ?? null) : []));
  // The disk the app's data is on, for the cache limit's range (Lagring på den här enheten).
  ipcMain.handle('disk-space', async () => {
    const s = await statfs(app.getPath('userData'));
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  });
  // "Rapportera fel" (docs/bug-reports.md): the window that asks, as it shows now, as a JPEG at most 1600 points wide; null if it has not drawn.
  ipcMain.handle('capture-page', async (e) => {
    const shot = await e.sender.capturePage();
    if (shot.isEmpty()) return null; // a window never drawn
    const size = shot.getSize();
    const fitted = size.width > 1600 ? shot.resize({ width: 1600 }) : shot;
    return `data:image/jpeg;base64,${fitted.toJPEG(70).toString('base64')}`;
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
  main.webContents.on('did-fail-load', (_e, _code, _text, _url, mainFrame) => mainFrame && !host && void serverUnreachable());
  await main.loadURL(pageUrl(base)).catch(() => undefined); // did-fail-load answers it
  main.on('closed', () => app.quit());
  log({ event: 'ready', base, host: !!host, lan: host ? lanUrls(host.port, host.tls?.port ?? null) : [], electron: process.versions.electron });
});

/**
 * The server this app is a client of did not answer as the window opened (nothing kept from an earlier visit either):
 * try again, or go back to this machine as the host, so the app is never left blank. Told in the system's language.
 */
async function serverUnreachable() {
  const sv = app.getLocale().startsWith('sv');
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: sv ? 'Servern svarar inte' : 'The server does not answer',
    detail: `${new URL(base).host}\n\n${sv ? 'Kontrollera internetanslutningen och försök igen.' : 'Check the internet connection and try again.'}`,
    buttons: sv ? ['Försök igen', 'Använd den här datorn'] : ['Try again', 'Use this computer'],
    defaultId: 0,
  });
  if (response === 0) await mainWindow?.loadURL(pageUrl(base)).catch(() => undefined);
  else if (!process.env.GP_SERVER) await reconnect(null);
}
