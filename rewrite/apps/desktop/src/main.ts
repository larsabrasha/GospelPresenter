// The Electron main process (ADR 0007, decision 6). By default it starts the
// embedded server and is the host. With GP_SERVER it is a second client of
// another machine's server instead (the "Other server" of D8, as an env var
// for now), and pairs with it like any other device.
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, screen, session } from 'electron';
import { lanUrls, pageUrl, startHost } from './host.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
/**
 * The host's fixed port. Its address must not change between starts: devices
 * on the LAN reconnect to it, and the host window's own storage (its session
 * and its OPFS database) belongs to its origin.
 */
const HOST_PORT = 47800;
const log = (event: object) => process.stdout.write(JSON.stringify(event) + '\n');

if (process.env.GP_DATA_DIR) app.setPath('userData', process.env.GP_DATA_DIR);

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: join(here, 'preload.cjs'),
};

let base = '';
let output: BrowserWindow | null = null;

/** The output goes fullscreen on the first non-primary display, or into a window when there is one display. */
function openOutput() {
  if (output && !output.isDestroyed()) return output.focus();
  const primary = screen.getPrimaryDisplay();
  const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
  output = new BrowserWindow({
    title: 'Gospel Presenter – output',
    backgroundColor: '#000000',
    show: false,
    ...(external ? { ...external.bounds, fullscreen: true } : { width: 960, height: 540 }),
    autoHideMenuBar: true,
    webPreferences,
  });
  output.once('ready-to-show', () => output?.show());
  void output.loadURL(pageUrl(base, 'output'));
  log({ event: 'output-opened', external: !!external });
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
  if (process.env.GP_SERVER) {
    base = process.env.GP_SERVER.replace(/\/$/, '');
  } else {
    const hostToken = `gphost_${randomBytes(32).toString('base64url')}`;
    const server = await startHost({
      dataDir: app.getPath('userData'),
      webRoot: process.env.GP_WEB_ROOT ?? join(here, '..', '..', 'web', 'dist'),
      port: Number(process.env.GP_PORT || HOST_PORT),
      hostToken,
    });
    base = server.url;
    port = server.port;
    setupToken = server.setupToken;
    actAsHostDevice(new URL(base).origin, hostToken);
  }
  lockNetwork(new URL(base).origin);
  ipcMain.on('open-output', openOutput);
  ipcMain.on('device-name', (e) => (e.returnValue = hostname()));
  // Only on the host, and only if no user existed at start: the window that sets the host up gets the token.
  ipcMain.handle('setup-token', () => setupToken);
  ipcMain.handle('lan-urls', () => (port ? lanUrls(port) : []));

  const main = new BrowserWindow({ width: 1280, height: 800, title: 'Gospel Presenter', webPreferences });
  await main.loadURL(pageUrl(base));
  main.on('closed', () => app.quit());
  log({ event: 'ready', base, host: !process.env.GP_SERVER, electron: process.versions.electron });
});
