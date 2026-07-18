import { Diff, Loader2, Sparkles } from 'lucide-react'
import type { EnvSnapshot, EnvSnapshotSection } from './envProfile'
import type { EnvProfileDiffResult } from './envProfileDiff'
import { DiffResultView, SectionHeader } from './EnvProfileDisplay'
import { PartialFailureList } from './EnvProfileSnapshotSections'
import { EmptyPane, formatDateTime } from './shared'

export type CompareCandidate = { key: string; snapshot: EnvSnapshot }

export function CompareSection({ candidates, selectedKey, selectedSnapshot, comparing, failedSections, diff, onSelect, onCompare }: {
  candidates: CompareCandidate[]
  selectedKey: string
  selectedSnapshot: EnvSnapshot | null
  comparing: boolean
  failedSections: EnvSnapshotSection[] | null
  diff: EnvProfileDiffResult | null
  onSelect: (key: string) => void
  onCompare: () => void
}) {
  return (
    <section>
      <SectionHeader icon={<Diff size={13} />} label="비교" />
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        {candidates.length === 0 ? (
          <p className="text-xs text-[var(--text-3)]">비교할 스냅샷이 없어요 — 먼저 스냅샷을 만들거나 가져오세요</p>
        ) : (
          <>
            <label htmlFor="compare-select" className="mb-1 block text-[11px] font-semibold text-[var(--text)]">비교할 스냅샷</label>
            <div className="flex flex-wrap items-center gap-2">
              <select id="compare-select" aria-label="비교할 스냅샷" value={selectedKey} onChange={event => onSelect(event.target.value)} className="min-w-[220px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]">
                <option value="">선택하세요</option>
                {candidates.map(candidate => <option key={candidate.key} value={candidate.key}>{candidate.snapshot.label} ({formatDateTime(candidate.snapshot.captured_at)}){candidate.key === 'imported' ? ' · 가져온 항목' : ''}</option>)}
              </select>
              <button type="button" onClick={onCompare} disabled={!selectedSnapshot || comparing} className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">
                {comparing && <Loader2 size={13} className="animate-spin" />}
                {comparing ? '비교하는 중…' : '현재 환경과 비교'}
              </button>
            </div>
            <PartialFailureList sections={failedSections} />
            {diff && (diff.hasDiff ? <DiffResultView diff={diff} /> : <div className="mt-3"><EmptyPane icon={<Sparkles size={18} />} title="차이가 없어요 ✨" description="두 환경이 동일해요." /></div>)}
          </>
        )}
      </div>
    </section>
  )
}
