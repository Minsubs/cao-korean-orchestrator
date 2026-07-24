import { useState } from 'react'
import { AlertTriangle, CheckCircle2, FileStack, FileText, Terminal, X, XCircle } from 'lucide-react'
import type { EnvFileEntry, EnvInstructionEntry, EnvInstructionsMatrix, EnvInventoryAll, EnvInventoryCli, EnvInventoryItem } from '../../api.env'
import { SkeletonBlock, TypeChip } from './shared'
import { formatBytes, formatMtime, KIND_LABELS } from './envtools'

/**
 * 환경·지침 탭 — Phase 6b Task 2: 이 세션이 실행 중인 머신에 각 CLI(Claude
 * Code/Codex/Antigravity)의 지침·설정·MCP 설정 파일이 실제로 어디에 몇 개
 * 있는지 정직하게 보여주는 CLI 인벤토리 섹션. 여기서는 순수 조회만 하고
 * 쓰기(지침 변환/저장)는 이후 태스크가 이 컴포넌트의 props를 additive하게
 * 확장해 추가한다.
 *
 * 백엔드(`GET /env/inventory`, services/env_migration/)는 별도 세션이 병렬로
 * 만들고 있어 이 화면이 완성된 시점에는 아직 실패할 수 있다 — ToolingView가
 * 다른 탭과 독립적으로 로딩/에러를 소유하고, 실패 시 기존 Tooling 탭들과
 * 동일한 "Tooling API에 연결할 수 없어요" 에러 영역을 이 탭에만 재사용한다.
 *
 * Phase 6b Task 3은 같은 탭에 두 번째 섹션을 additive하게 추가한다: AGENTS.md/
 * CLAUDE.md 지침 매트릭스(`GET /env/instructions`, entries[0]=전역 + 사용자가
 * 추가한 프로젝트 경로별 항목). CLI 인벤토리 섹션 전체가 실패하면(위
 * inventoryError) 여전히 탭 전체가 기존처럼 연결 에러로 대체되지만, 인벤토리가
 * 성공한 뒤에는 이 섹션이 instructionsLoading/instructionsError로 독립된
 * 3-state(로딩/에러/성공)를 스스로 갖는다 — 지침 매트릭스만 실패해도 위 CLI
 * 인벤토리는 그대로 보인다.
 */

interface EnvToolsPaneProps {
  inventory: EnvInventoryAll | null
  inventoryLoading: boolean
  inventoryError: boolean
  onRetry: () => void
  instructions: EnvInstructionsMatrix | null
  instructionsLoading: boolean
  instructionsError: boolean
  onReloadInstructions: (paths: string[]) => void
}

const CLI_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
}

function cliLabel(cli: string): string {
  return CLI_LABELS[cli] ?? cli
}

export function EnvToolsPane({
  inventory,
  inventoryLoading,
  inventoryError,
  onRetry,
  instructions,
  instructionsLoading,
  instructionsError,
  onReloadInstructions,
}: EnvToolsPaneProps) {
  if (inventoryLoading) return <EnvToolsSkeleton />

  if (inventoryError || !inventory) {
    return (
      <div
        role="region"
        aria-label="Tooling API에 연결할 수 없어요"
        className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
          <AlertTriangle size={22} />
        </div>
        <h2 className="text-sm font-semibold text-[var(--text)]">Tooling API에 연결할 수 없어요</h2>
        <p className="max-w-sm text-xs leading-relaxed text-[var(--text-3)]">서버 버전을 확인하세요</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105"
        >
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
          <Terminal size={13} />
          CLI 인벤토리
        </div>
        <div className="space-y-3">
          {inventory.clis.map(cli => (
            <CliInventoryCard key={cli.cli} cli={cli} />
          ))}
        </div>
      </div>

      <InstructionsSection
        instructions={instructions}
        loading={instructionsLoading}
        error={instructionsError}
        onReload={onReloadInstructions}
      />
    </div>
  )
}

function EnvToolsSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="환경·지침 불러오는 중">
      <SkeletonBlock className="h-8 w-full" />
      <SkeletonBlock className="h-32 w-full" />
      <SkeletonBlock className="h-32 w-full" />
    </div>
  )
}

function CliInventoryCard({ cli }: { cli: EnvInventoryCli }) {
  const total = cli.counts.total ?? cli.items.length
  const kindCounts = Object.entries(cli.counts).filter(([kind]) => kind !== 'total')

  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm ${cli.present ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-[var(--text)]">{cliLabel(cli.cli)}</h3>
        <PresenceBadge present={cli.present} />
        <span className="ml-auto text-xs font-semibold text-[var(--text-2)]">총 {total}개</span>
      </div>

      {kindCounts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {kindCounts.map(([kind, count]) => (
            <TypeChip key={kind}>
              {KIND_LABELS[kind] ?? kind} {count}
            </TypeChip>
          ))}
        </div>
      )}

      {cli.note && <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-3)]">{cli.note}</p>}

      {cli.items.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {cli.items.map((item, i) => (
            <InventoryItemRow key={`${item.rel_path}-${i}`} item={item} />
          ))}
        </ul>
      ) : (
        cli.present && <p className="mt-2.5 text-xs text-[var(--text-3)]">발견된 파일이 없어요</p>
      )}
    </div>
  )
}

function PresenceBadge({ present }: { present: boolean }) {
  const Icon = present ? CheckCircle2 : XCircle
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: present ? 'var(--success-bg)' : 'var(--neutral-bg)',
        color: present ? 'var(--success)' : 'var(--neutral)',
      }}
    >
      <Icon size={13} />
      {present ? '발견됨' : '없음'}
    </span>
  )
}

function InventoryItemRow({ item }: { item: EnvInventoryItem }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs">
      <FileStack size={12} className="shrink-0 text-[var(--text-3)]" />
      <TypeChip>{KIND_LABELS[item.kind] ?? item.kind}</TypeChip>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text)]" title={item.rel_path}>
        {item.rel_path}
      </span>
      <span className="shrink-0 text-[10.5px] text-[var(--text-3)]">{formatBytes(item.size)}</span>
      <span className="shrink-0 text-[10.5px] text-[var(--text-3)]">{formatMtime(item.mtime)}</span>
      {item.kind === 'mcp_config' && (
        <span
          className="shrink-0 rounded-full px-2 py-[1px] text-[10px] font-bold"
          style={{
            backgroundColor: item.mcp_servers_present ? 'var(--success-bg)' : 'var(--neutral-bg)',
            color: item.mcp_servers_present ? 'var(--success)' : 'var(--neutral)',
          }}
        >
          MCP 서버 {item.mcp_servers_present ? '있음' : '없음'}
        </span>
      )}
    </li>
  )
}

// ── Phase 6b Task 3 — 지침 매트릭스 (AGENTS·CLAUDE) section ─────────────────

const SCOPE_LABELS: Record<EnvInstructionEntry['scope'], string> = {
  global: '전역',
  project: '프로젝트',
}

/**
 * 전역 지침(마운트 시 자동 조회) + 사용자가 추가한 프로젝트 경로별 지침을
 * 보여주는 섹션. 위 CLI 인벤토리와 독립적으로 자체 3-state(로딩/에러/성공)를
 * 갖는다 — 인벤토리가 성공한 채로 이 섹션만 실패해도 위 카드들은 그대로
 * 남는다. "프로젝트 경로 추가" 입력은 로딩/에러 여부와 무관하게 항상 노출해,
 * 실패한 경로 조합을 다른 경로로 바꿔 바로 재시도할 수 있게 한다.
 */
function InstructionsSection({
  instructions,
  loading,
  error,
  onReload,
}: {
  instructions: EnvInstructionsMatrix | null
  loading: boolean
  error: boolean
  onReload: (paths: string[]) => void
}) {
  const [paths, setPaths] = useState<string[]>([])
  const [draftPath, setDraftPath] = useState('')

  const addPath = () => {
    const trimmed = draftPath.trim()
    if (!trimmed) return
    const next = [...paths, trimmed]
    setPaths(next)
    setDraftPath('')
    onReload(next)
  }

  const removePath = (path: string) => {
    const next = paths.filter(p => p !== path)
    setPaths(next)
    onReload(next)
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
        <FileText size={13} />
        지침 매트릭스 (AGENTS·CLAUDE)
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draftPath}
          onChange={e => setDraftPath(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') addPath()
          }}
          placeholder="/home/user/project 같은 절대 경로"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)]"
        />
        <button
          type="button"
          onClick={addPath}
          className="shrink-0 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105"
        >
          추가
        </button>
      </div>

      {paths.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {paths.map(path => (
            <button
              key={path}
              type="button"
              onClick={() => removePath(path)}
              title="제거"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10.5px]"
              style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-2)' }}
            >
              {path}
              <X size={10} />
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          <SkeletonBlock className="h-20 w-full" />
          <SkeletonBlock className="h-20 w-full" />
        </div>
      )}

      {!loading && (error || !instructions) && (
        <div
          role="region"
          aria-label="Tooling API에 연결할 수 없어요"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
            <AlertTriangle size={22} />
          </div>
          <h2 className="text-sm font-semibold text-[var(--text)]">Tooling API에 연결할 수 없어요</h2>
          <p className="max-w-sm text-xs leading-relaxed text-[var(--text-3)]">서버 버전을 확인하세요</p>
          <button
            type="button"
            onClick={() => onReload(paths)}
            className="mt-1 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105"
          >
            다시 시도
          </button>
        </div>
      )}

      {!loading && !error && instructions && (
        <div className="space-y-3">
          {instructions.entries.map((entry, i) => (
            <InstructionEntryCard key={`${entry.scope}-${entry.base_path}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

function InstructionEntryCard({ entry }: { entry: EnvInstructionEntry }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <TypeChip>{SCOPE_LABELS[entry.scope]}</TypeChip>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text)]" title={entry.base_path}>
          {entry.base_path}
        </span>
      </div>

      {entry.error ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-[11px] leading-relaxed text-[var(--text-3)]">
          <AlertTriangle size={12} className="shrink-0" />
          {entry.error}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {(entry.files ?? []).map((file, i) => (
            <InstructionFileRow key={`${file.name}-${i}`} file={file} />
          ))}
        </ul>
      )}
    </div>
  )
}

function InstructionFileRow({ file }: { file: EnvFileEntry }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs">
      <FileStack size={12} className="shrink-0 text-[var(--text-3)]" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text)]" title={file.name}>
        {file.name}
      </span>
      {file.is_dir && typeof file.command_count === 'number' && <TypeChip>{file.command_count}개 명령</TypeChip>}
      <ExistsChip exists={file.exists} />
      {file.exists && (
        <>
          {file.size != null && <span className="shrink-0 text-[10.5px] text-[var(--text-3)]">{formatBytes(file.size)}</span>}
          <span className="shrink-0 text-[10.5px] text-[var(--text-3)]">{formatMtime(file.mtime)}</span>
        </>
      )}
      {file.headline && (
        <p className="mt-1 w-full truncate text-[10.5px] text-[var(--text-3)]" title={file.headline}>
          {file.headline}
        </p>
      )}
    </li>
  )
}

function ExistsChip({ exists }: { exists: boolean }) {
  const Icon = exists ? CheckCircle2 : XCircle
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[1px] text-[10px] font-bold"
      style={{
        backgroundColor: exists ? 'var(--success-bg)' : 'var(--neutral-bg)',
        color: exists ? 'var(--success)' : 'var(--neutral)',
      }}
    >
      <Icon size={11} />
      {exists ? '있음' : '없음'}
    </span>
  )
}
