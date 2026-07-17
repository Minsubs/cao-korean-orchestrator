import { useEffect, useState } from 'react'
import { ArrowUp, Check, FolderOpen, Folder, RefreshCw, X } from 'lucide-react'
import { apiUi, type FsEntry } from '../../api.ui'

interface DirectoryPickerProps {
  /** Path to open first; defaults to the server user's home (`~`). */
  initialPath?: string
  onClose: () => void
  onSelect: (path: string) => void
}

/**
 * Server-side directory browser backed by `GET /fs/list` (home-confined).
 * The browser cannot open a native picker for server paths, so this modal is
 * the "찾아보기" affordance — and the seam a native dialog replaces once the
 * app ships inside Electron.
 */
export function DirectoryPicker({ initialPath, onClose, onSelect }: DirectoryPickerProps) {
  const [input, setInput] = useState(initialPath?.trim() || '~')
  const [resolved, setResolved] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (target: string) => {
    if (!target.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiUi.listFsEntries(target.trim())
      setResolved(res.path)
      setInput(res.path)
      setEntries(res.entries.filter(e => e.is_dir))
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status
      setError(
        status === 403
          ? '홈 디렉터리 밖은 열 수 없어요.'
          : status === 404
            ? '존재하지 않는 경로예요.'
            : '폴더를 열 수 없어요 — 경로와 서버 연결을 확인해 주세요.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(input)
    // eslint 없음: 마운트 시 1회만 초기 경로를 연다
  }, [])

  const goUp = () => {
    if (!resolved) return
    const parent = resolved.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
    void load(parent)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="폴더 선택">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-3">
          <FolderOpen size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 text-sm font-semibold text-[var(--text)]">폴더 선택</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-[var(--border-soft)] px-3 py-2">
          <button
            type="button"
            onClick={goUp}
            disabled={loading || !resolved}
            title="상위 폴더"
            aria-label="상위 폴더"
            className="rounded-lg p-1.5 text-[var(--text-2)] hover:bg-[var(--surface-2)] disabled:opacity-40"
          >
            <ArrowUp size={14} />
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void load(input)
            }}
            aria-label="경로 직접 입력"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={() => void load(input)}
            disabled={loading}
            title="이동"
            aria-label="경로로 이동"
            className="rounded-lg p-1.5 text-[var(--text-2)] hover:bg-[var(--surface-2)] disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="min-h-[220px] flex-1 overflow-y-auto px-2 py-2">
          {error ? (
            <p className="px-2 py-6 text-center text-xs text-[var(--danger)]">{error}</p>
          ) : loading ? (
            <p className="px-2 py-6 text-center text-xs text-[var(--text-3)]">불러오는 중…</p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-[var(--text-3)]">하위 폴더가 없어요 — 이 폴더를 그대로 선택할 수 있어요.</p>
          ) : (
            entries.map(entry => (
              <button
                key={entry.name}
                type="button"
                onClick={() => resolved && void load(`${resolved.replace(/\/+$/, '')}/${entry.name}`)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
              >
                <Folder size={13} className="shrink-0 text-[var(--text-3)]" />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text)]">{entry.name}</span>
                {entry.markers.slice(0, 2).map(marker => (
                  <span key={marker} className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-2)]">
                    {marker}
                  </span>
                ))}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border-soft)] px-4 py-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-3)]" title={resolved ?? ''}>
            {resolved ?? '—'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!resolved || loading}
            onClick={() => resolved && (onSelect(resolved), onClose())}
            className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-[var(--on-accent)] disabled:opacity-40"
          >
            <Check size={13} />이 폴더 선택
          </button>
        </div>
      </div>
    </div>
  )
}
