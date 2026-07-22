import { AlertTriangle, Blocks, Clock, Download, RefreshCw, Sliders, Terminal } from 'lucide-react'
import type { ToolingEnvironment, ToolingPlanRequest, ToolingProvider } from '../../api.tooling'
import { ACTION_LABELS, ActionButton, InstallPill, StatCard, UNKNOWN, formatDateTime, initials, pastelFor } from './shared'

interface OverviewPaneProps {
  environment: ToolingEnvironment
  providers: ToolingProvider[]
  extensionCount: number
  diagnosticsWarnCount: number
  scannedAt: string | null
  rescanning: boolean
  rescanError: string | null
  onRescan: () => void
  /** Wires each provider row's "업데이트" button into the shared plan/preview/execute/poll flow (Phase C). */
  onRequestAction?: (request: ToolingPlanRequest) => void
}

export function OverviewPane({
  environment,
  providers,
  extensionCount,
  diagnosticsWarnCount,
  scannedAt,
  rescanning,
  rescanError,
  onRescan,
  onRequestAction,
}: OverviewPaneProps) {
  // 'update_all' (not 'update'): target-exempt in the router and, unlike
  // 'update' (which also gates InstalledPane's per-MCP-server update button
  // for these same adapters), reusing it here for "update the CLI binary
  // itself" cannot be confused with updating one specific MCP server.
  const handleUpdate = (provider: string) => onRequestAction?.({ action: 'update_all', provider })
  const installedCount = providers.filter(p => p.installed).length
  const osLabel = environment.os ? `${environment.os}${environment.os_version ? ` ${environment.os_version}` : ''}` : UNKNOWN
  const wslLabel = environment.is_wsl === null ? UNKNOWN : environment.is_wsl ? '예' : '아니오'

  return (
    <div className="space-y-5">
      {/* Stat chips + manual rescan (no polling — this is the one refresh
          action for the whole Tooling view, per the Phase 3b performance
          principle). */}
      <div className="flex flex-wrap items-stretch gap-3">
        <StatCard
          icon={<Terminal size={13} />}
          label="감지된 CLI"
          value={
            <>
              {installedCount}
              <span className="text-xs text-[var(--text-3)]">/{providers.length}</span>
            </>
          }
        />
        <StatCard icon={<Blocks size={13} />} label="설치된 확장" value={extensionCount} />
        <StatCard
          icon={<AlertTriangle size={13} />}
          label="진단 경고"
          value={diagnosticsWarnCount}
          tone={diagnosticsWarnCount > 0 ? 'warning' : undefined}
        />
        <StatCard icon={<Clock size={13} />} label="마지막 검사" value={<span className="text-sm">{formatDateTime(scannedAt)}</span>} />
        <div className="flex items-center">
          <button
            type="button"
            onClick={onRescan}
            disabled={rescanning}
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={13} className={rescanning ? 'animate-spin' : ''} />
            {rescanning ? '검사 중...' : '다시 검사'}
          </button>
        </div>
      </div>
      {rescanError && <p className="text-xs text-[var(--danger)]">{rescanError}</p>}

      {/* Managed environment card */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-3">
          <Sliders size={14} className="text-[var(--text-2)]" />
          <span className="text-xs font-bold text-[var(--text)]">관리 환경</span>
        </div>
        <dl className="divide-y divide-dashed divide-[var(--border-soft)] px-4">
          <EnvRow label="OS" value={osLabel} />
          <EnvRow label="Architecture" value={environment.arch ?? UNKNOWN} mono />
          <EnvRow label="Shell" value={environment.shell ?? UNKNOWN} mono />
          <EnvRow label="WSL 여부" value={wslLabel} />
          <EnvRow label="서버 버전" value={environment.server_version ?? UNKNOWN} />
        </dl>
      </div>

      {/* Detected AI CLIs */}
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
          <Terminal size={13} />
          감지된 AI CLI
        </div>
        {providers.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-xs text-[var(--text-3)]">
            감지된 CLI가 없어요
          </div>
        ) : (
          <div
            role="list"
            aria-label="감지된 AI CLI 목록"
            className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
          >
            {providers.map((p, i) => (
              <ProviderRow key={p.name} provider={p} withBorder={i > 0} onUpdate={handleUpdate} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EnvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-xs">
      <dt className="shrink-0 text-[var(--text-3)]">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-[var(--text)] ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  )
}

interface ProviderRowProps {
  provider: ToolingProvider
  withBorder: boolean
  /** Called with `provider.name` when the "업데이트" button is clicked (Phase C: AI CLI self-update). */
  onUpdate?: (provider: string) => void
}

export function ProviderRow({ provider, withBorder, onUpdate }: ProviderRowProps) {
  const pastel = pastelFor(provider.name)
  const pathText = provider.installed ? provider.path ?? UNKNOWN : `${provider.binary} — PATH에서 찾지 못했어요`
  const versionIsError = !provider.version && !!provider.version_error
  const versionText = provider.version ?? provider.version_error ?? '—'

  return (
    <div
      role="listitem"
      className={`flex items-center gap-3 px-4 py-2.5 ${withBorder ? 'border-t border-dashed border-[var(--border-soft)]' : ''}`}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
        style={{ backgroundColor: pastel.bg, color: pastel.ink }}
      >
        {initials(provider.display_name || provider.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-[var(--text)]">{provider.display_name}</div>
        <div className="truncate font-mono text-[11px] text-[var(--text-3)]" title={pathText}>
          {pathText}
        </div>
      </div>
      <span
        className={`shrink-0 font-mono text-xs ${versionIsError ? 'text-[var(--warning)]' : 'text-[var(--text-2)]'}`}
        title={versionIsError ? provider.version_error ?? undefined : undefined}
      >
        {versionText}
      </span>
      {provider.installed && (
        <ActionButton icon={<Download size={12} />} onClick={() => onUpdate?.(provider.name)}>
          {ACTION_LABELS.update}
        </ActionButton>
      )}
      <InstallPill installed={provider.installed} />
    </div>
  )
}
