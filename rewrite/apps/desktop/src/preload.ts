// The renderer's only door to the main process. contextIsolation and the
// sandbox are on, so this is all a page can reach.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gpDesktop', {
  openOutput: () => ipcRenderer.send('open-output'),
  deviceName: String(ipcRenderer.sendSync('device-name')),
  setupToken: () => ipcRenderer.invoke('setup-token') as Promise<string | null>,
  lanUrls: () => ipcRenderer.invoke('lan-urls') as Promise<string[]>,
});
