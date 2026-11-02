// The renderer's only door to the main process. contextIsolation and the
// sandbox are on, so this is all a page can reach.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gpDesktop', {
  openOutput: (target: string) => ipcRenderer.send('open-output', target),
  closeOutput: (target?: string) => ipcRenderer.send('close-output', target),
  outputsOpen: () => ipcRenderer.invoke('outputs-open') as Promise<string[]>,
  onOutputsChanged(cb: (open: string[]) => void) {
    const on = (_e: unknown, open: unknown) => Array.isArray(open) && cb(open.filter((x): x is string => typeof x === 'string'));
    ipcRenderer.on('outputs-changed', on);
    return () => void ipcRenderer.off('outputs-changed', on);
  },
  outputDisplays: () => ipcRenderer.invoke('output-displays') as Promise<{ id: string; name: string }[]>,
  onDisplaysChanged(cb: () => void) {
    const on = () => cb();
    ipcRenderer.on('displays-changed', on);
    return () => void ipcRenderer.off('displays-changed', on);
  },
  isHost: Boolean(ipcRenderer.sendSync('is-host')),
  /** The window's title bar is hidden on a Mac: the page's bar holds the window's buttons and moves the window. */
  macFrame: process.platform === 'darwin',
  /** A choice in the menu bar the page has no key for (Inställningar…). */
  onMenu(cb: (command: string) => void) {
    const on = (_e: unknown, command: unknown) => typeof command === 'string' && cb(command);
    ipcRenderer.on('menu', on);
    return () => void ipcRenderer.off('menu', on);
  },
  deviceName: String(ipcRenderer.sendSync('device-name')),
  setupToken: () => ipcRenderer.invoke('setup-token') as Promise<string | null>,
  lanUrls: () => ipcRenderer.invoke('lan-urls') as Promise<string[]>,
  diskSpace: () => ipcRenderer.invoke('disk-space') as Promise<{ total: number; free: number }>,
  callbackScheme: String(ipcRenderer.sendSync('callback-scheme')),
  openSignIn: (path: string) => ipcRenderer.invoke('open-sign-in', path) as Promise<boolean>,
  onSignInCallback(cb: (token: string) => void) {
    const on = (_e: unknown, token: unknown) => typeof token === 'string' && cb(token);
    ipcRenderer.on('sign-in-callback', on);
    return () => void ipcRenderer.off('sign-in-callback', on);
  },
});
