import { useEffect, useState } from 'react'
import { Monitor } from 'lucide-react'
import { fetchAppInfo, type NativeAppInfo } from '../../native'

const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

/**
 * Header chip identifying the desktop shell and how it got its server.
 *
 * Renders nothing in a browser. The distinction it shows is one users
 * otherwise have no way to see and that changes what they should expect: a
 * *spawned* server dies with the app, an *attached* one is somebody else's
 * process (usually their own terminal) and keeps running after the window
 * closes.
 */
export function DesktopChip() {
  const [info, setInfo] = useState<NativeAppInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchAppInfo().then(result => {
      if (!cancelled) setInfo(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!info) return null

  const platform = PLATFORM_LABELS[info.platform] ?? info.platform
  const mode = info.serverMode === 'spawned' ? '앱이 서버 실행 중' : '실행 중인 서버에 연결됨'
  const distro = info.distro ? ` · ${info.distro}` : ''

  return (
    <span
      className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--text-2)]"
      title={`${platform}${distro} · ${mode} · 포트 ${info.port} · v${info.version}`}
    >
      <Monitor size={12} className="text-[var(--text-3)]" />
      {platform}
      <span className="text-[var(--text-3)]">·</span>
      <span className="font-normal text-[var(--text-3)]">{mode}</span>
    </span>
  )
}
