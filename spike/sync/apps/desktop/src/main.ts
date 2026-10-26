// Minimal Electron main process: the embedded sync server plus the operator's
// client, and one hardened window that shows the LAN address.
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { runDesktop } from './desktop.ts';

const emit = (e: object) => process.stdout.write(JSON.stringify(e) + '\n');

app.whenReady().then(async () => {
  const dataDir = process.env.DATA_DIR ?? join(app.getPath('userData'), 'sync');
  let lanUrl = '';
  await runDesktop({
    dataDir,
    runtime: `electron ${process.versions.electron}`,
    emit: (e) => {
      if ('lanUrl' in e) lanUrl = String(e.lanUrl);
      emit(e);
    },
  });
  const win = new BrowserWindow({
    width: 480,
    height: 200,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL(`data:text/html,<p>Gospel Presenter sync spike: server on ${encodeURIComponent(lanUrl)}</p>`);
  emit({ event: 'window', title: win.getTitle() });
});
