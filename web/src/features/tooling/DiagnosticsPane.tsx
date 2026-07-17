import { Sparkles } from 'lucide-react'
import type { ToolingDiagnostic } from '../../api.tooling'
import { EmptyPane, SeverityPill } from './shared'

export function DiagnosticsPane({ diagnostics }: { diagnostics: ToolingDiagnostic[] }) {
  if (diagnostics.length === 0) {
    return (
      <EmptyPane
        icon={<Sparkles size={20} />}
        title="발견된 문제가 없어요 ✨"
        description="검사한 항목에서 문제를 찾지 못했어요."
      />
    )
  }

  return (
    <div className="space-y-3">
      {diagnostics.map((d, i) => (
        <div key={`${d.code}-${i}`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityPill severity={d.severity} />
            <span className="text-sm font-bold text-[var(--text)]">{d.title}</span>
          </div>
          <dl className="mt-3 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 text-xs">
            {d.cause && (
              <>
                <dt className="text-[var(--text-3)]">원인</dt>
                <dd className="text-[var(--text-2)]">{d.cause}</dd>
              </>
            )}
            {d.impact && (
              <>
                <dt className="text-[var(--text-3)]">영향</dt>
                <dd className="text-[var(--text-2)]">{d.impact}</dd>
              </>
            )}
            {d.recommendation && (
              <>
                <dt className="text-[var(--text-3)]">권장 조치</dt>
                <dd className="text-[var(--text-2)]">{d.recommendation}</dd>
              </>
            )}
          </dl>
          {(d.provider || d.path) && (
            <div className="mt-2.5 flex flex-wrap gap-3 border-t border-dashed border-[var(--border-soft)] pt-2 text-[10px] text-[var(--text-3)]">
              {d.provider && <span>Provider: {d.provider}</span>}
              {d.path && <span className="font-mono">{d.path}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
