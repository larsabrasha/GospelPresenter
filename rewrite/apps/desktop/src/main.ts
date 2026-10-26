// The Electron main process (ADR 0007, decision 6). By default it starts the
// embedded server and is the host. With GP_SERVER it is a second client of
// another machine's server instead (the "Other server" of D8, as an env var
// until sign-in exists).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, screen, session } from 'electron';
import { OPERATOR, pageUrl, startHost } from './host.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const log = (event: object) => process.stdout.write(JSON.stringify(event) + '\n');

if (process.env.GP_DATA_DIR) app.setPath('userData', process.env.GP_DATA_DIR);

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: join(here, 'preload.cjs'),
};

let base = '';
let user = OPERATOR;
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
  void output.loadURL(pageUrl(base, user, 'output'));
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

app.whenReady().then(async () => {
  if (process.env.GP_SERVER) {
    base = process.env.GP_SERVER.replace(/\/$/, '');
    user = { userId: process.env.GP_USER ?? 'second', role: 'user' };
  } else {
    const server = await startHost({
      dataDir: app.getPath('userData'),
      webRoot: process.env.GP_WEB_ROOT ?? join(here, '..', '..', 'web', 'dist'),
      port: Number(process.env.GP_PORT ?? 0),
    });
    base = server.url;
  }
  lockNetwork(new URL(base).origin);
  ipcMain.on('open-output', openOutput);

  const main = new BrowserWindow({ width: 1280, height: 800, title: 'Gospel Presenter', webPreferences });
  await main.loadURL(pageUrl(base, user));
  main.on('closed', () => app.quit());
  log({ event: 'ready', base, user: user.userId, electron: process.versions.electron });
});
