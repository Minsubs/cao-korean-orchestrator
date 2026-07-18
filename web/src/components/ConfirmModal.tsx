import { useEffect, useRef } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  details?: { label: string; value: string }[]
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  details,
  confirmLabel = '확인',
  cancelLabel = '취소',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  const colors = variant === 'danger'
    ? {
        icon: 'text-[var(--danger)] bg-[var(--danger-bg)]',
        btn: 'bg-[var(--danger)] text-[var(--on-accent)] hover:brightness-95 focus:ring-[var(--danger)]',
      }
    : {
        icon: 'text-[var(--warning)] bg-[var(--warning-bg)]',
        btn: 'bg-[var(--warning)] text-[var(--on-accent)] hover:brightness-95 focus:ring-[var(--warning)]',
      }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal */}
      <div className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-start gap-4 p-6 pb-4">
          <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${colors.icon}`}>
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
            <p className="mt-1 text-sm text-[var(--text-2)]">{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="닫기"
            className="shrink-0 rounded p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Details */}
        {details && details.length > 0 && (
          <div className="mx-6 mb-4 space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
            {details.map(d => (
              <div key={d.label} className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-3)]">{d.label}</span>
                <span className="font-mono text-[var(--text-2)]">{d.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-soft)] bg-[var(--surface-2)] px-6 py-4">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all focus:outline-none focus:ring-2 disabled:opacity-60 ${colors.btn}`}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? '처리 중...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
