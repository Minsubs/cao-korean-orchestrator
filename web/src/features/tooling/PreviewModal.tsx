import { useEffect, useRef } from 'react'
import { AlertTriangle, Eye, Loader2, Play, X } from 'lucide-react'
import type { PreviewState } from './useToolingOperations'

interface PreviewModalProps {
  preview: PreviewState
  onExecute: () => void
  onClose: () => void
}

/**
 * Phase 4b 요구사항 12 — the single Preview-confirmation modal shared by
 * every write action (Skill 관리 install/update/remove/update_all in
 * UpdatesPane, and the [업데이트]/[삭제] buttons in InstalledPane's detail
 * view). Renders whatever `useToolingOperations`'s `preview` state currently
 * holds: plan-loading → plan error → plan ready (description/argv/cwd/
 * verify_description/warnings) → executing.
 */
export function PreviewModal({ preview, onExecute, onClose }: PreviewModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const open = preview.status !== 'idle'

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const loading = preview.status === 'loading'
  const executing = preview.status === 'executing'

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="실행 전 확인">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <Eye size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 text-sm font-semibold text-[var(--text)]">실행 전 확인</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 text-xs">
          {loading && (
            <div className="flex items-center gap-2 py-6 text-[var(--text-3)]" aria-busy="true">
              <Loader2 size={15} className="animate-spin" />
              실행 계획을 확인하는 중…
            </div>
          )}

          {preview.status === 'error' && (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--danger-bg)] px-3 py-2.5 text-[var(--danger)]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {preview.error}
            </div>
          )}

          {preview.plan && (
            <>
              <p className="leading-relaxed text-[var(--text)]">{preview.plan.description}</p>

              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)]">실행될 명령</div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--surface-2)] px-3 py-2 font-mono text-[11px] text-[var(--text)]">
                  {preview.plan.argv.join(' ')}
                </pre>
              </div>

              <dl className="grid grid-cols-[70px_1fr] gap-x-2 gap-y-1.5">
                <dt className="text-[var(--text-3)]">작업 폴더</dt>
                <dd className="min-w-0 break-all font-mono text-[var(--text-2)]">{preview.plan.cwd}</dd>
                <dt className="text-[var(--text-3)]">검증 방법</dt>
                <dd className="min-w-0 text-[var(--text-2)]">{preview.plan.verify_description}</dd>
              </dl>

              {preview.plan.warnings.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[var(--warning)]">
                  {preview.plan.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}

              {preview.error && (
                <div className="flex items-start gap-2 rounded-lg bg-[var(--danger-bg)] px-3 py-2.5 text-[var(--danger)]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {preview.error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-2)]"
          >
            취소
          </button>
          {preview.plan && (
            <button
              type="button"
              onClick={onExecute}
              disabled={executing || loading}
              className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {executing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {executing ? '실행하는 중...' : '실행하기'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
