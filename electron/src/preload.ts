/**
 * The only thing the renderer gets beyond a plain browser.
 *
 * Runs sandboxed with context isolation on, so the page sees a frozen object of
 * five functions and nothing else — no `require`, no `ipcRenderer`, no Node.
 * Each call is forwarded to main, which is where the actual privilege lives and
 * where the arguments are validated (docs/electron-plan.md §2).
 */

import { contextBridge, ipcRenderer } from 'electron'

import { CHANNELS, type AppInfo, type CaoNative } from './bridge-contract'

const caoNative: CaoNative = {
  pickDirectory: (initialPath?: string) => ipcRenderer.invoke(CHANNELS.pickDirectory, initialPath),
  // Fire-and-forget: the renderer has no business knowing whether the user's
  // browser opened, and awaiting it would only invite it to block on the answer.
  openExternal: (url: string) => {
    void ipcRenderer.invoke(CHANNELS.openExternal, url)
  },
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(CHANNELS.appInfo),
  restartServer: () => ipcRenderer.invoke(CHANNELS.restartServer),
}

contextBridge.exposeInMainWorld('caoNative', caoNative)
