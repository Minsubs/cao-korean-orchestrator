import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import type { ModelCatalogEntry } from '../../api.profiles'
import { providerLabel } from './roleData'

interface ModelCatalogSectionProps {
  entries: ModelCatalogEntry[] | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}

/**
 * Provider model catalog (GET /tooling/models, Phase 5a — built in parallel).
 * No "사용 중" (in-use) count here: `listProfiles()` never returns which
 * model an installed profile uses, so that count can't be computed from real
 * data. Showing one would be a guess — the phase spec forbids that.
 */
export function ModelCatalogSection({ entries, loading, error, onRefresh }: ModelCatalogSectionProps) {
  return (
    <div className="mt-7">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
        <Sparkles size={13} />
        모델 카탈로그
      </div>

      {loading && !entries && !error ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[0, 1].map(i => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--surface-2)]" />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-xs text-[var(--warning)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="mt-2 flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              다시 시도
            </button>
          </div>
        </div>
      ) : entries && entries.length > 0 ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {entries.map(entry => (
            <div key={entry.provider} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-2.5">
                <span className="flex-1 text-xs font-bold text-[var(--text)]">{providerLabel(entry.provider)}</span>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1 text-[10.5px] font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                >
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                  새로고침
                </button>
              </div>
              {entry.models.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-[var(--text-3)]">등록된 모델이 없어요</div>
              ) : (
                entry.models.map((m, i) => (
                  <div
                    key={m.name}
                    className={`px-3 py-1.5 font-mono text-xs text-[var(--text-2)] ${i > 0 ? 'border-t border-dashed border-[var(--border-soft)]' : ''}`}
                  >
                    {m.name}
                  </div>
                ))
              )}
              <div className="bg-[var(--surface-2)] px-3 py-1.5 text-[10px] text-[var(--text-3)]">
                출처: {entry.source === 'known' ? '알려진 모델 별칭 목록' : '실시간 조회'}
                {entry.probed_at ? ` · ${new Date(entry.probed_at).toLocaleString('ko-KR')}` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-xs text-[var(--text-3)]">
          조회된 모델 카탈로그가 없어요
        </div>
      )}

      <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-2)]">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        모델 변경은 새 세션부터 적용돼요. 목록에 없는 모델은 프로필에서 직접 입력할 수 있어요 — CAO는 모델 문자열을 CLI에 그대로 전달해요.
      </p>
    </div>
  )
}
