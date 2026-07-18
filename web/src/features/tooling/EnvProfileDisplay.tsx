import type { ReactNode } from 'react'
import { Download, Info, Trash2 } from 'lucide-react'
import type { EnvSnapshot } from './envProfile'
import type { EnvProfileDiffResult, NamedDiffEntry } from './envProfileDiff'
import { TypeChip, UNKNOWN, formatDateTime, kindLabel } from './shared'

const ENV_FIELD_LABEL_KO: Record<string, string> = {
  os: 'OS',
  os_version: 'OS 버전',
  arch: 'Architecture',
  shell: 'Shell',
  is_wsl: 'WSL 여부',
  server_version: '서버 버전',
  python_version: 'Python 버전',
}

const CLI_LABEL_KO: Record<string, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex CLI',
  antigravity: 'Antigravity',
}

function cliLabel(cli: string): string {
  return CLI_LABEL_KO[cli] ?? cli
}

export function SectionHeader({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
      {icon}
      {label}
    </div>
  )
}

export function SnapshotCard({ snapshot, onDelete, onExport }: { snapshot: EnvSnapshot; onDelete: () => void; onExport: () => void }) {
  const env = snapshot.environment && typeof snapshot.environment === 'object' ? snapshot.environment as Record<string, unknown> : {}
  const legacyChips = [typeof env.os === 'string' ? env.os : null, typeof env.server_version === 'string' ? env.server_version : null].filter(Boolean) as string[]
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-[var(--text)]" title={snapshot.label}>{snapshot.label}</div>
          <div className="text-[10.5px] text-[var(--text-3)]">{formatDateTime(snapshot.captured_at)}</div>
        </div>
        <button type="button" aria-label={`${snapshot.label} 삭제`} onClick={onDelete} className="shrink-0 rounded-full p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {snapshot.cli_versions !== undefined
          ? snapshot.cli_versions.map(cli => <TypeChip key={cli.name}>{cli.display_name} {cli.version ?? UNKNOWN}</TypeChip>)
          : legacyChips.map(chip => <TypeChip key={chip}>{chip}</TypeChip>)}
        {(snapshot.cli_versions?.length === 0 || (snapshot.cli_versions === undefined && legacyChips.length === 0)) && <TypeChip>{UNKNOWN}</TypeChip>}
      </div>
      <button type="button" onClick={onExport} className="mt-2.5 flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
        <Download size={11} /> 내보내기
      </button>
    </div>
  )
}

function OnlySideList({ title, clis, profiles, extensions }: { title: string; clis: string[]; profiles: NamedDiffEntry[]; extensions: NamedDiffEntry[] }) {
  if (clis.length === 0 && profiles.length === 0 && extensions.length === 0) return null
  return (
    <div className="rounded-xl bg-[var(--surface-2)] p-3">
      <div className="text-[11px] font-bold text-[var(--text-3)]">{title}</div>
      <ul className="mt-1.5 space-y-1 text-xs text-[var(--text)]">
        {clis.map(cli => <li key={`cli-${cli}`}><TypeChip>CLI</TypeChip> {cliLabel(cli)} <span className="text-[10.5px] text-[var(--text-3)]">(미설치)</span></li>)}
        {profiles.map(profile => <li key={`profile-${profile.name}`}><TypeChip>프로필</TypeChip> {profile.name} {profile.detail && <span className="text-[10.5px] text-[var(--text-3)]">{profile.detail}</span>}</li>)}
        {extensions.map(extension => <li key={`ext-${extension.name}`}><TypeChip>확장</TypeChip> {extension.name} {extension.detail && <span className="text-[10.5px] text-[var(--text-3)]">{kindLabel(extension.detail)}</span>}</li>)}
      </ul>
    </div>
  )
}

export function DiffResultView({ diff }: { diff: EnvProfileDiffResult }) {
  const onlySnapshotClis = diff.cliPresenceDiffs.filter(item => item.onlyIn === 'snapshot').map(item => item.cli)
  const onlyLiveClis = diff.cliPresenceDiffs.filter(item => item.onlyIn === 'live').map(item => item.cli)
  const hasOnlySide = onlySnapshotClis.length + onlyLiveClis.length + diff.onlyInSnapshot.agentProfiles.length + diff.onlyInLive.agentProfiles.length + diff.onlyInSnapshot.extensions.length + diff.onlyInLive.extensions.length > 0
  return (
    <div className="mt-3 space-y-3">
      {diff.cliVersionDiffs.length > 0 && <DiffRows title="CLI 버전 차이" rows={diff.cliVersionDiffs.map(item => ({ key: item.cli, label: item.displayName, value: `${item.snapshotVersion} → ${item.liveVersion}` }))} />}
      {diff.environmentFieldDiffs.length > 0 && <DiffRows title="환경 정보 차이" rows={diff.environmentFieldDiffs.map(item => ({ key: item.field, label: ENV_FIELD_LABEL_KO[item.field] ?? item.field, value: `${item.snapshotValue ?? UNKNOWN} → ${item.liveValue ?? UNKNOWN}` }))} />}
      {hasOnlySide && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OnlySideList title="스냅샷에만 있음" clis={onlySnapshotClis} profiles={diff.onlyInSnapshot.agentProfiles} extensions={diff.onlyInSnapshot.extensions} />
          <OnlySideList title="현재에만 있음" clis={onlyLiveClis} profiles={diff.onlyInLive.agentProfiles} extensions={diff.onlyInLive.extensions} />
        </div>
      )}
      {diff.inventoryCountDiffs.length > 0 && <DiffRows title="Inventory 개수 차이" rows={diff.inventoryCountDiffs.map(item => ({ key: `${item.cli}-${item.kind}`, label: `${cliLabel(item.cli)} · ${kindLabel(item.kind)}`, value: `${item.snapshotCount} → ${item.liveCount}` }))} />}
      <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-2)]">
        <Info size={13} className="mt-0.5 shrink-0" /> 설치는 탐색 탭에서, 프로필은 에이전트 프로필 화면에서 할 수 있어요
      </div>
    </div>
  )
}

function DiffRows({ title, rows }: { title: string; rows: { key: string; label: string; value: string }[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold text-[var(--text-3)]">{title}</div>
      <div className="overflow-hidden rounded-xl border border-[var(--border-soft)]">
        {rows.map((row, index) => (
          <div key={row.key} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs ${index > 0 ? 'border-t border-dashed border-[var(--border-soft)]' : ''}`}>
            <span className="text-[var(--text-2)]">{row.label}</span>
            <span className="font-mono text-[11px] text-[var(--text)]">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
