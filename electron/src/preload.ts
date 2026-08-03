/**
 * The only thing the renderer gets beyond a plain browser.
 *
 * Runs sandboxed with context isolation on, so the page sees a frozen object of
 * five functions and nothing else — no `require`, no `ipcRenderer`, no Node.
 * Each call is forwarded to main, which is where the actual privilege lives and
 * where the arguments are validated (docs/electron-plan.md §2).
 *
 * **This file must not require anything but `electron`.** A sandboxed preload
 * gets a restricted `require` that resolves a handful of Electron/Node builtins
 * and nothing else, so `require('./bridge-contract')` fails at runtime with
 * `module not found` — the preload dies, `window.caoNative` never appears, and
 * the app looks like a plain browser with no error anywhere in the main log.
 * Unit tests do not catch it because they import the module directly; it showed
 * up the first time the packaged app actually ran.
 *
 * Type-only imports are erased by the compiler, so they are safe. The channel
 * names are duplicated as literals below and pinned to the contract's type,
 * which makes any drift a compile error rather than a runtime surprise.
 */

import { contextBridge, ipcRenderer } from 'electron'

import type * as Contract from './bridge-contract'

// Typed against the contract: a renamed channel, a missing key or a typo fails
// `tsc`, because CHANNELS there is `as const` and its values are literal types.
const CHANNELS: typeof Contract.CHANNELS = {
  pickDirectory: 'cao:pick-directory',
  openExternal: 'cao:open-external',
  appInfo: 'cao:app-info',
  restartServer: 'cao:restart-server',
  shellConfigGet: 'cao:shell-config-get',
  shellConfigSet: 'cao:shell-config-set',
  installServer: 'cao:install-server',
}

const caoNative: Contract.CaoNative = {
  pickDirectory: (initialPath?: string) => ipcRenderer.invoke(CHANNELS.pickDirectory, initialPath),
  // Fire-and-forget: the renderer has no business knowing whether the user's
  // browser opened, and awaiting it would only invite it to block on the answer.
  openExternal: (url: string) => {
    void ipcRenderer.invoke(CHANNELS.openExternal, url)
  },
  appInfo: (): Promise<Contract.AppInfo> => ipcRenderer.invoke(CHANNELS.appInfo),
  restartServer: () => ipcRenderer.invoke(CHANNELS.restartServer),
  shellConfig: {
    get: () => ipcRenderer.invoke(CHANNELS.shellConfigGet),
    set: (mode: string) => ipcRenderer.invoke(CHANNELS.shellConfigSet, mode),
  },
  installServer: () => ipcRenderer.invoke(CHANNELS.installServer),
}

contextBridge.exposeInMainWorld('caoNative', caoNative)
