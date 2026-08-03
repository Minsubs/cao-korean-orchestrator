/**
 * Electron main process: window, tray, and the boot sequence.
 *
 * The window is a view onto the server's own web UI
 * (`loadURL('http://127.0.0.1:<port>')`), not a bundled copy — that is what
 * keeps the web code unchanged (docs/electron-plan.md §1). Nothing is loaded
 * over the network; the only origin is localhost.
 *
 * The renderer's only extra privilege is `window.caoNative` (see preload.ts and
 * `registerBridge` below): five functions, each validated here in main. No
 * filesystem, no shell — file work still goes through cao-server's API.
 */

import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, session, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CHANNELS, type AppInfo, type ShellSettings } from './bridge-contract'
import { isSafeExternalUrl, normalizeInitialPath } from './bridge-guards'
import { shouldInjectCsp, withCspHeader } from './csp'
import {
  buildInstallPlan,
  buildNpmLookupPlan,
  buildUvLookupPlan,
  buildWslPathPlan,
  parseBinaryPath,
  parseUncWslPath,
  summarizeInstall,
  verifyCheckout,
} from './install-server'
import { createInventoryDeps, createRuntimeDeps, getLogPath, runCapturing, setLogPath } from './runtime-deps'
import { distroFor, shellBinaryFor } from './shell-config'
import { buildInventory } from './shell-inventory'
import { readShellMode, writeShellMode, type StoreDeps } from './shell-store'
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

let storeDeps: StoreDeps | null = null

/** Current shell settings, validated against what is installed right now. */
function shellSettings(): ShellSettings {
  const stored = storeDeps ? readShellMode(storeDeps) : 'auto'
  const inventory = buildInventory(createInventoryDeps(), stored)
  return {
    mode: inventory.mode,
    fellBackToAuto: inventory.fellBackToAuto,
    choices: inventory.options,
    autoResolvesTo: inventory.autoResolvesTo,
    // Changing the shell cannot move a running server into it; the change lands
    // on the next start. Saying so is the difference between "nothing happened"
    // and "it will apply in a moment".
    restartRequired: true,
  }
}

/**
 * Fold the shell choice into the spawn config.
 *
 * The selected shell is passed to the server as CAO_DEFAULT_SHELL too, so agent
 * terminals get the same shell as the server itself rather than tmux's
 * default — that pairing is the whole point of the setting (§4).
 */
function applyShellSettings(): void {
  const { mode } = shellSettings()
  const shell = shellBinaryFor(mode)
  const distro = distroFor(mode)

  if (shell) {
    config.shell = shell
    config.serverEnv = { ...config.serverEnv, CAO_DEFAULT_SHELL: shell }
  } else {
    delete config.shell
    const env = { ...config.serverEnv }
    delete env.CAO_DEFAULT_SHELL
    config.serverEnv = env
  }

  if (distro) config.distro = distro
  else delete config.distro
}

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

/** Read a file, or null when it is not there — used for checkout verification. */
function readFileSafely(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Boot/diagnostics screen — a local file, never remote content. */
function loadBootScreen(window: BrowserWindow, state: string): void {
  const bootPath = join(__dirname, '..', 'boot.html')
  // The copy for a failed lookup differs by platform — see boot.html.
  void window.loadFile(bootPath, { query: { state, platform: process.platform } })
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
      {
        // Without this a failed start is a dead end: the child's output went to
        // a file precisely so there is something to look at.
        label: '서버 로그 열기',
        enabled: getLogPath() !== null,
        click: () => {
          const path = getLogPath()
          if (path) void shell.openPath(path)
        },
      },
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

  ipcMain.handle(CHANNELS.installServer, async () => {
    const picked = await dialog.showOpenDialog({
      title: 'cao-server 체크아웃 폴더 선택',
      properties: ['openDirectory'],
      message: 'cli-agent-orchestrator 저장소를 체크아웃한 폴더를 골라 주세요.',
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true, message: '' }
    const folder = picked.filePaths[0]

    // Verified before anything runs: any Python project has a pyproject.toml,
    // and installing the wrong one fails late and confusingly.
    const verdict = verifyCheckout(
      relative => existsSync(join(folder, relative)),
      readFileSafely(join(folder, 'pyproject.toml'))
    )
    if (!verdict.ok) {
      return {
        ok: false,
        message:
          verdict.reason === 'missing-marker'
            ? '이 폴더에서 pyproject.toml / src/cli_agent_orchestrator 를 찾지 못했어요.'
            : '이 폴더는 cli-agent-orchestrator 체크아웃이 아니에요.',
      }
    }

    // The dialog hands back a Windows path. A folder inside the distro comes as
    // \\wsl.localhost\<distro>\… , which wslpath mangles rather than converts
    // (measured: it returned /mnt/c/wsl.localhostUbuntuhome…), so that form is
    // parsed directly — and the distro named in the path is the one holding the
    // files, which beats whatever the settings say.
    const unc = parseUncWslPath(folder)
    let wslPath = unc?.path ?? ''
    const distro = unc?.distro ?? config.distro

    if (!unc) {
      const pathPlan = buildWslPathPlan(folder, distro)
      const converted = await runCapturing(pathPlan.command, pathPlan.args)
      wslPath = converted.output.trim()
      if (converted.code !== 0 || wslPath.length === 0) {
        return { ok: false, message: 'WSL 경로로 변환하지 못했어요: ' + converted.output.trim().slice(0, 200) }
      }
    }

    // uv has to be located first: the login shell wsl.exe starts inherits
    // nothing, so a uv added to PATH by an interactive rc is invisible here.
    const uvLookup = buildUvLookupPlan(distro)
    const uvFound = await runCapturing(uvLookup.command, uvLookup.args)
    const uvPath = parseBinaryPath(uvFound.output)
    if (!uvPath) {
      return {
        ok: false,
        message: 'WSL 에서 uv 를 찾지 못했어요. WSL 터미널에서 uv 를 설치한 뒤 다시 시도해 주세요.',
      }
    }

    // The web bundle is gitignored, so a fresh clone has none — and a server
    // installed without it starts fine and answers {"detail":"Not Found"} at /,
    // which looks like a broken app. Build it as part of the install instead.
    const needsWebBuild = !existsSync(join(folder, 'src', 'cli_agent_orchestrator', 'web_ui', 'index.html'))
    let npmPath: string | undefined
    if (needsWebBuild) {
      const npmLookup = buildNpmLookupPlan(distro)
      const npmFound = await runCapturing(npmLookup.command, npmLookup.args)
      npmPath = parseBinaryPath(npmFound.output) ?? undefined
      if (!npmPath) {
        return {
          ok: false,
          message:
            '웹 UI 를 빌드해야 하는데 WSL 안에서 npm 을 찾지 못했어요. ' +
            '(Windows 쪽 npm 은 Linux 빌드에 쓸 수 없어 제외합니다.)',
        }
      }
    }

    const installPlan = buildInstallPlan({
      wslCheckoutPath: wslPath,
      uvPath,
      ...(npmPath ? { npmPath } : {}),
      needsWebBuild,
      ...(distro ? { distro } : {}),
    })
    const installed = await runCapturing(installPlan.command, installPlan.args)
    const result = summarizeInstall(installed.code, installed.output)
    if (result.ok) {
      // The install put cao-server on the login shell's PATH, which is exactly
      // where the normal start path looks — so just start again.
      void boot()
    }
    return result
  })

  ipcMain.handle(CHANNELS.shellConfigGet, (): ShellSettings => shellSettings())

  ipcMain.handle(CHANNELS.shellConfigSet, (_event, mode: unknown) => {
    if (typeof mode !== 'string') return { ok: false, error: '잘못된 값이에요' }
    if (!storeDeps) return { ok: false, error: '설정을 저장할 위치를 찾지 못했어요' }

    // Reject a mode that does not resolve on this machine *now*, rather than
    // storing it and falling back on every future boot with no explanation.
    const { choices } = shellSettings()
    const choice = choices.find(option => option.mode === mode)
    if (!choice?.available) {
      return { ok: false, error: choice?.unavailableReason ?? '지금 사용할 수 없는 선택이에요' }
    }

    const result = writeShellMode(storeDeps, mode)
    if (result.ok) applyShellSettings()
    return result
  })
}

app.whenReady().then(async () => {
  // cao-server sends no CSP — it was written for a browser. Inject one here so
  // the renderer is not running wide open just because it is inside Electron.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldInjectCsp(details.url)) {
      callback({})
      return
    }
    callback({ responseHeaders: withCspHeader(details.responseHeaders ?? {}) })
  })

  const userData = app.getPath('userData')
  storeDeps = {
    path: join(userData, 'shell-settings.json'),
    readFile: path => readFileSync(path, 'utf8'),
    writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
  }
  setLogPath(join(userData, 'cao-server.log'))
  applyShellSettings()

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
