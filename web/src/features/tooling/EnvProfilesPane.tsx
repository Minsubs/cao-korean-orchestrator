import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Camera, Diff, Download, FileUp, Info, Loader2, Save, Sparkles, Trash2 } from 'lucide-react'
import {
  ENV_SNAPSHOT_SECTIONS,
  ENV_SNAPSHOT_SECTION_LABEL,
  InvalidSnapshotError,
  buildEnvSnapshot,
  defaultSnapshotLabel,
  deleteSnapshot,
  downloadSnapshot,
  environmentSummaryChips,
  loadSavedSnapshots,
  parseSnapshotJson,
  saveSnapshot,
  type EnvSnapshot,
  type EnvSnapshotSection,
} from './envProfile'
import { computeEnvDiff, type EnvProfileDiffResult, type NamedDiffEntry } from './envProfileDiff'
import { EmptyPane, TypeChip, UNKNOWN, formatDateTime, kindLabel } from './shared'

/**
 * 환경 프로필 탭 — Phase 6c: 신규 백엔드 없이 이미 존재하는 네 개의 API를
 * 조합해 "이 머신의 도구 환경" 스냅샷을 만들고(로컬 저장), 다른 머신에서
 * 내보낸 스냅샷을 가져와 지금의 라이브 환경과 비교한다(회사 Windows/WSL ↔
 * 개인 mac 시나리오). 전부 이 컴포넌트 하나가 자기 상태를 들고 있다 —
 * ToolingView의 다른 탭과 공유하는 상태가 없다(탭 전환 시 리셋되어도 무방).
 *
 * diff 계산은 envProfileDiff.ts의 순수 함수(computeEnvDiff)에 위임 — 이
 * 컴포넌트는 렌더링과 fetch 오케스트레이션만 담당한다.
 */

const ENV_FIELD_LABEL_KO: Record<string, string> = {
  os: 'OS',
  os_version: 'OS 버전',
  arch: 'Architecture',
  shell: 'Shell',
  is_wsl: 'WSL 여부',
  server_version: '서버 버전',
  python_version: 'Python 버전',
}

/** The three CLIs env_migration/inventory.py scans — a closed, code-verified enum (see that module's SUPPORTED_CLIS), unlike the open-ended tooling adapter/provider ids elsewhere in this feature. */
const CLI_LABEL_KO: Record<string, string> = { claude_code: 'Claude Code', codex: 'Codex CLI', antigravity: 'Antigravity' }
function cliLabel(cli: string): string {
  return CLI_LABEL_KO[cli] ?? cli
}

type CompareCandidate = { key: string; snapshot: EnvSnapshot }

export function EnvProfilesPane() {
  const [saved, setSaved] = useState<EnvSnapshot[]>(() => loadSavedSnapshots())

  // 스냅샷 생성
  const [labelInput, setLabelInput] = useState(() => defaultSnapshotLabel())
  const [creating, setCreating] = useState(false)
  const [createFailedSections, setCreateFailedSections] = useState<EnvSnapshotSection[] | null>(null)
  const [createBlocked, setCreateBlocked] = useState(false)

  // 가져오기
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importedSnapshot, setImportedSnapshot] = useState<EnvSnapshot | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 비교
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [comparing, setComparing] = useState(false)
  const [compareFailedSections, setCompareFailedSections] = useState<EnvSnapshotSection[] | null>(null)
  const [diffResult, setDiffResult] = useState<EnvProfileDiffResult | null>(null)

  const compareCandidates: CompareCandidate[] = useMemo(() => {
    const list: CompareCandidate[] = []
    if (importedSnapshot) list.push({ key: 'imported', snapshot: importedSnapshot })
    for (const s of saved) list.push({ key: s.captured_at, snapshot: s })
    return list
  }, [importedSnapshot, saved])

  const selectedSnapshot = compareCandidates.find(c => c.key === selectedKey)?.snapshot ?? null

  async function handleCreateSnapshot() {
    setCreating(true)
    setCreateFailedSections(null)
    setCreateBlocked(false)
    try {
      const { snapshot, failedSections } = await buildEnvSnapshot(labelInput)
      if (failedSections.length === ENV_SNAPSHOT_SECTIONS.length) {
        // All four sources failed — don't save a fully-empty snapshot.
        setCreateFailedSections(failedSections)
        setCreateBlocked(true)
        return
      }
      setSaved(saveSnapshot(snapshot))
      setCreateFailedSections(failedSections.length > 0 ? failedSections : null)
      setLabelInput(defaultSnapshotLabel())
    } finally {
      setCreating(false)
    }
  }

  function handleDelete(capturedAt: string) {
    setSaved(deleteSnapshot(capturedAt))
    if (selectedKey === capturedAt) setSelectedKey('')
  }

  function applyImportedText(raw: string) {
    try {
      const snap = parseSnapshotJson(raw)
      setImportedSnapshot(snap)
      setImportError(null)
      setSelectedKey('imported')
    } catch (err) {
      setImportedSnapshot(null)
      setImportError(err instanceof InvalidSnapshotError ? err.message : '가져오기에 실패했어요')
    }
  }

  function handleFileChange(file: File) {
    const reader = new FileReader()
    reader.onload = () => applyImportedText(String(reader.result ?? ''))
    reader.onerror = () => setImportError('파일을 읽지 못했어요')
    reader.readAsText(file)
  }

  async function handleCompare() {
    if (!selectedSnapshot) return
    setComparing(true)
    setCompareFailedSections(null)
    setDiffResult(null)
    try {
      const { snapshot: live, failedSections } = await buildEnvSnapshot('현재 환경')
      setCompareFailedSections(failedSections.length > 0 ? failedSections : null)
      setDiffResult(computeEnvDiff(selectedSnapshot, live))
    } finally {
      setComparing(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* 1. 스냅샷 생성 */}
      <section>
        <SectionHeader icon={<Camera size={13} />} label="스냅샷 생성" />
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-xs leading-relaxed text-[var(--text-3)]">
            현재 머신의 도구 환경(CLI 인벤토리·확장·에이전트 프로필 개수)을 스냅샷으로 저장해요. 파일 내용이나 토큰은 절대 담지 않아요 — 이름·버전·개수만요.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="snapshot-label-input" className="sr-only">
              스냅샷 이름
            </label>
            <input
              id="snapshot-label-input"
              value={labelInput}
              onChange={e => setLabelInput(e.target.value)}
              placeholder="스냅샷 이름"
              className="min-w-[180px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={handleCreateSnapshot}
              disabled={creating}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating && <Loader2 size={13} className="animate-spin" />}
              {creating ? '스냅샷 만드는 중…' : '스냅샷 생성'}
            </button>
          </div>
          {createBlocked && (
            <p className="mt-2.5 text-[11px] text-[var(--danger)]">환경 정보를 하나도 가져오지 못했어요 — 서버 연결을 확인하세요</p>
          )}
          {!createBlocked && createFailedSections && createFailedSections.length > 0 && (
            <div className="mt-2.5 space-y-0.5 text-[10.5px] text-[var(--warning)]">
              {createFailedSections.map(s => (
                <div key={s}>
                  {ENV_SNAPSHOT_SECTION_LABEL[s]} 조회 실패 — 이 항목 제외
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 2. 저장 목록 */}
      <section>
        <SectionHeader icon={<Save size={13} />} label="저장 목록" />
        <p className="mb-2 text-[10.5px] text-[var(--text-3)]">이 브라우저에만 저장돼요</p>
        {saved.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-xs text-[var(--text-3)]">
            저장된 스냅샷이 없어요
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map(s => (
              <SnapshotCard key={s.captured_at} snapshot={s} onDelete={() => handleDelete(s.captured_at)} onExport={() => downloadSnapshot(s)} />
            ))}
          </div>
        )}
      </section>

      {/* 3. 가져오기 */}
      <section>
        <SectionHeader icon={<FileUp size={13} />} label="가져오기" />
        <div className="space-y-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div>
            <label htmlFor="snapshot-file-input" className="mb-1 block text-[11px] font-semibold text-[var(--text)]">
              파일에서 가져오기
            </label>
            <input
              id="snapshot-file-input"
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              aria-label="스냅샷 파일 선택"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleFileChange(file)
              }}
              className="block w-full text-xs text-[var(--text-2)] file:mr-2 file:rounded-full file:border file:border-[var(--border)] file:bg-[var(--surface)] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-[var(--text-2)]"
            />
          </div>
          <div>
            <label htmlFor="snapshot-paste-input" className="mb-1 block text-[11px] font-semibold text-[var(--text)]">
              또는 JSON 붙여넣기
            </label>
            <textarea
              id="snapshot-paste-input"
              aria-label="스냅샷 JSON 붙여넣기"
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="내보낸 스냅샷 JSON을 붙여넣으세요"
              rows={4}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => applyImportedText(importText)}
              disabled={!importText.trim()}
              className="mt-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              가져오기
            </button>
          </div>
          {importError && <p className="text-xs text-[var(--danger)]">{importError}</p>}
          {importedSnapshot && !importError && (
            <p className="text-xs text-[var(--success)]">가져왔어요: {importedSnapshot.label} ({formatDateTime(importedSnapshot.captured_at)})</p>
          )}
        </div>
      </section>

      {/* 4. 비교 */}
      <section>
        <SectionHeader icon={<Diff size={13} />} label="비교" />
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          {compareCandidates.length === 0 ? (
            <p className="text-xs text-[var(--text-3)]">비교할 스냅샷이 없어요 — 먼저 스냅샷을 만들거나 가져오세요</p>
          ) : (
            <>
              <label htmlFor="compare-select" className="mb-1 block text-[11px] font-semibold text-[var(--text)]">
                비교할 스냅샷
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="compare-select"
                  aria-label="비교할 스냅샷"
                  value={selectedKey}
                  onChange={e => {
                    setSelectedKey(e.target.value)
                    setDiffResult(null)
                  }}
                  className="min-w-[220px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  <option value="">선택하세요</option>
                  {compareCandidates.map(c => (
                    <option key={c.key} value={c.key}>
                      {c.snapshot.label} ({formatDateTime(c.snapshot.captured_at)}){c.key === 'imported' ? ' · 가져온 항목' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleCompare}
                  disabled={!selectedSnapshot || comparing}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {comparing && <Loader2 size={13} className="animate-spin" />}
                  {comparing ? '비교하는 중…' : '현재 환경과 비교'}
                </button>
              </div>

              {compareFailedSections && compareFailedSections.length > 0 && (
                <div className="mt-2.5 space-y-0.5 text-[10.5px] text-[var(--warning)]">
                  {compareFailedSections.map(s => (
                    <div key={s}>
                      {ENV_SNAPSHOT_SECTION_LABEL[s]} 조회 실패 — 이 항목 제외
                    </div>
                  ))}
                </div>
              )}

              {diffResult &&
                (diffResult.hasDiff ? (
                  <DiffResultView diff={diffResult} />
                ) : (
                  <div className="mt-3">
                    <EmptyPane icon={<Sparkles size={18} />} title="차이가 없어요 ✨" description="두 환경이 동일해요." />
                  </div>
                ))}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function SectionHeader({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
      {icon}
      {label}
    </div>
  )
}

function SnapshotCard({ snapshot, onDelete, onExport }: { snapshot: EnvSnapshot; onDelete: () => void; onExport: () => void }) {
  const { os, serverVersion } = environmentSummaryChips(snapshot.environment)
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-[var(--text)]" title={snapshot.label}>
            {snapshot.label}
          </div>
          <div className="text-[10.5px] text-[var(--text-3)]">{formatDateTime(snapshot.captured_at)}</div>
        </div>
        <button
          type="button"
          aria-label={`${snapshot.label} 삭제`}
          onClick={onDelete}
          className="shrink-0 rounded-full p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {os && <TypeChip>{os}</TypeChip>}
        {serverVersion && <TypeChip>{serverVersion}</TypeChip>}
        {!os && !serverVersion && <TypeChip>{UNKNOWN}</TypeChip>}
      </div>
      <button
        type="button"
        onClick={onExport}
        className="mt-2.5 flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      >
        <Download size={11} />
        내보내기
      </button>
    </div>
  )
}

function DiffResultView({ diff }: { diff: EnvProfileDiffResult }) {
  const onlySnapshotClis = diff.cliPresenceDiffs.filter(d => d.onlyIn === 'snapshot').map(d => d.cli)
  const onlyLiveClis = diff.cliPresenceDiffs.filter(d => d.onlyIn === 'live').map(d => d.cli)

  return (
    <div className="mt-3 space-y-3">
      {diff.environmentFieldDiffs.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-[var(--text-3)]">환경 정보 차이 (서버 버전 포함)</div>
          <div className="overflow-hidden rounded-xl border border-[var(--border-soft)]">
            {diff.environmentFieldDiffs.map((d, i) => (
              <div
                key={d.field}
                className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs ${i > 0 ? 'border-t border-dashed border-[var(--border-soft)]' : ''}`}
              >
                <span className="text-[var(--text-2)]">{ENV_FIELD_LABEL_KO[d.field] ?? d.field}</span>
                <span className="font-mono text-[11px] text-[var(--text)]">
                  {d.snapshotValue ?? UNKNOWN} → {d.liveValue ?? UNKNOWN}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(onlySnapshotClis.length > 0 ||
        onlyLiveClis.length > 0 ||
        diff.onlyInSnapshot.agentProfiles.length > 0 ||
        diff.onlyInLive.agentProfiles.length > 0 ||
        diff.onlyInSnapshot.extensions.length > 0 ||
        diff.onlyInLive.extensions.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OnlySideList title="스냅샷에만 있음" clis={onlySnapshotClis} profiles={diff.onlyInSnapshot.agentProfiles} extensions={diff.onlyInSnapshot.extensions} />
          <OnlySideList title="현재에만 있음" clis={onlyLiveClis} profiles={diff.onlyInLive.agentProfiles} extensions={diff.onlyInLive.extensions} />
        </div>
      )}

      {diff.inventoryCountDiffs.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-[var(--text-3)]">Inventory 개수 차이</div>
          <div className="overflow-hidden rounded-xl border border-[var(--border-soft)]">
            {diff.inventoryCountDiffs.map((d, i) => (
              <div
                key={`${d.cli}-${d.kind}`}
                className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs ${i > 0 ? 'border-t border-dashed border-[var(--border-soft)]' : ''}`}
              >
                <span className="text-[var(--text-2)]">
                  {cliLabel(d.cli)} · {kindLabel(d.kind)}
                </span>
                <span className="font-mono text-[11px] text-[var(--text)]">
                  {d.snapshotCount} → {d.liveCount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-2)]">
        <Info size={13} className="mt-0.5 shrink-0" />
        설치는 탐색 탭에서, 프로필은 에이전트 프로필 화면에서 할 수 있어요
      </div>
    </div>
  )
}

function OnlySideList({ title, clis, profiles, extensions }: { title: string; clis: string[]; profiles: NamedDiffEntry[]; extensions: NamedDiffEntry[] }) {
  if (clis.length === 0 && profiles.length === 0 && extensions.length === 0) return null
  return (
    <div className="rounded-xl bg-[var(--surface-2)] p-3">
      <div className="text-[11px] font-bold text-[var(--text-3)]">{title}</div>
      <ul className="mt-1.5 space-y-1 text-xs text-[var(--text)]">
        {clis.map(cli => (
          <li key={`cli-${cli}`} className="flex flex-wrap items-center gap-1.5">
            <TypeChip>CLI</TypeChip> {cliLabel(cli)}
            <span className="text-[10.5px] text-[var(--text-3)]">(미설치)</span>
          </li>
        ))}
        {profiles.map(p => (
          <li key={`profile-${p.name}`} className="flex flex-wrap items-center gap-1.5">
            <TypeChip>프로필</TypeChip> {p.name}
            {p.detail && <span className="text-[10.5px] text-[var(--text-3)]">{p.detail}</span>}
          </li>
        ))}
        {extensions.map(e => (
          <li key={`ext-${e.name}`} className="flex flex-wrap items-center gap-1.5">
            <TypeChip>확장</TypeChip> {e.name}
            {e.detail && <span className="text-[10.5px] text-[var(--text-3)]">{kindLabel(e.detail)}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
