/**
 * Electron main process: window, tray, and the boot sequence.
 *
 * The window is a view onto the server's own web UI
 * (`loadURL('http://127.0.0.1:<port>')`), not a bundled copy — that is what
 * keeps the web code unchanged (docs/electron-plan.md §1). Nothing is loaded
 * over the network; the only origin is localhost.
 *
 * The native bridge (`window.caoNative`) lands in 7b. Until then the renderer
 * has no preload at all, which is the safest possible default.
 */

import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'

import { CHANNELS, type AppInfo } from './bridge-contract'
import { isSafeExternalUrl, normalizeInitialPath } from './bridge-guards'
import { createRuntimeDeps } from './runtime-deps'
import {
  DEFAULT_CONFIG,
  ServerStartError,
  startServer,
  stopServer,
  waitForHealthy,
  type ServerConfig,
  type StartResult,
} from './server-manager'

/** A spawned server may cold-start slowly on WSL; poll rather than guess. */
const BOOT_POLL = { attempts: 60, intervalMs: 1000 }

const deps = createRuntimeDeps()
const config: ServerConfig = { ...DEFAULT_CONFIG }

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let server: StartResult | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 1000,
    title: 'MS Orchestrator',
    backgroundColor: '#ffffff',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.js'),
    },
  })

  // Links to the outside world open in the real browser; nothing else may
  // create a window (docs/electron-plan.md §2).
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('closed', () => {
    mainWindow = null
  })

  return window
}

/** Boot/diagnostics screen — a local file, never remote content. */
function loadBootScreen(window: BrowserWindow, state: string): void {
  const bootPath = join(__dirname, '..', 'boot.html')
  void window.loadFile(bootPath, { query: { state } })
}

async function boot(): Promise<void> {
  mainWindow = createWindow()
  loadBootScreen(mainWindow, 'checking')

  try {
    server = await startServer(deps, config)
  } catch (error) {
    const reason = error instanceof ServerStartError ? error.reason : 'unknown'
    loadBootScreen(mainWindow, `failed:${reason}`)
    return
  }

  if (server.mode === 'spawned') {
    loadBootScreen(mainWindow, 'starting')
    const healthy = await waitForHealthy(deps, config.host, server.port, BOOT_POLL)
    if (!healthy) {
      loadBootScreen(mainWindow, 'failed:no-response')
      return
    }
  }

  await mainWindow.loadURL(`http://${config.host}:${server.port}`)
  updateTray()
}

function updateTray(): void {
  if (!tray) return
  const mode = server ? server.mode : 'stopped'
  const port = server ? server.port : '-'
  tray.setToolTip(`MS Orchestrator — ${mode} :${port}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `서버: ${mode} (:${port})`, enabled: false },
      { type: 'separator' },
      {
        label: '서버 다시 시작',
        // Restarting a server we merely attached to would kill something we do
        // not own, so the action is only offered when we spawned it.
        enabled: server?.mode === 'spawned',
        click: () => void restart(),
      },
      { label: '창 보이기', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ])
  )
}

async function restart(): Promise<void> {
  const confirmed = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['취소', '다시 시작'],
    defaultId: 1,
    cancelId: 0,
    message: '서버를 다시 시작할까요?',
    detail: '실행 중인 에이전트 터미널은 tmux 에 남아 있어 재연결됩니다.',
  })
  if (confirmed !== 1) return

  if (server) await stopServer(deps, server)
  server = null
  await boot()
}

/**
 * Serve the `window.caoNative` contract.
 *
 * Every handler validates its arguments (see bridge-guards): the page is ours,
 * but the strings flowing through it — chat content, agent output, catalog
 * entries — are not.
 */
function registerBridge(): void {
  ipcMain.handle(CHANNELS.pickDirectory, async (_event, initialPath: unknown) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: normalizeInitialPath(initialPath),
    })
    // Cancelling is a normal outcome, not an error: the caller keeps whatever
    // path it already had.
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(CHANNELS.openExternal, (_event, url: unknown) => {
    if (!isSafeExternalUrl(url)) return
    void shell.openExternal(url)
  })

  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => {
    return {
      platform: process.platform,
      version: app.getVersion(),
      serverMode: server?.mode ?? 'attached',
      port: server?.port ?? config.basePort,
      ...(config.distro ? { distro: config.distro } : {}),
    }
  })

  ipcMain.handle(CHANNELS.restartServer, async () => {
    // Restarting something we merely attached to would kill a process we do
    // not own — usually the developer's own terminal session.
    if (server?.mode !== 'spawned') return
    await restart()
  })
}

app.whenReady().then(async () => {
  registerBridge()
  tray = new Tray(join(__dirname, '..', 'assets', 'tray.png'))
  updateTray()
  await boot()
})

// Quitting must not outrun the server's own shutdown, or tmux bookkeeping and
// pending DB writes are lost. Only a server we spawned is stopped.
app.on('before-quit', async event => {
  if (!server || server.mode !== 'spawned') return
  event.preventDefault()
  const stopping = server
  server = null
  await stopServer(deps, stopping)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void boot()
})
