/**
 * The setup and start-up windows talk to the app through this small bridge (no Node.js in the page itself).
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('algoHunt', {
  load: () => ipcRenderer.invoke('setup:load'),
  checkDatabase: (url: string) => ipcRenderer.invoke('check:database', url),
  checkKite: (key: string, secret: string) => ipcRenderer.invoke('check:kite', key, secret),
  checkTelegram: (token: string, chatId?: string) => ipcRenderer.invoke('check:telegram', token, chatId),
  checkResend: (key: string) => ipcRenderer.invoke('check:resend', key),
  finish: (config: unknown) => ipcRenderer.invoke('setup:finish', config),
  onProgress: (fn: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => fn(p);
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  },
  retry: () => ipcRenderer.invoke('start:retry'),
  settings: () => ipcRenderer.invoke('start:settings'),
  openLogs: () => ipcRenderer.invoke('app:logs'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open', url),
  copy: (text: string) => ipcRenderer.invoke('app:copy', text),
});
