import { useState } from 'react'
import { Check, Folder, FolderOpen, X } from 'lucide-react'
import { DirectoryPicker } from './DirectoryPicker'

export interface ProjectEditTarget {
  kind: 'project' | 'group'
  id: string
  name: string
  /** Project folder, or group root. */
  path: string
}

interface ProjectEditModalProps {
  target: ProjectEditTarget
  onClose: () => void
  onSave: (input: { name: string; path: string }) => void
}

/**
 * Rename a project/group or point it at a different folder.
 *
 * The two differ only in wording — a group's folder is its root, and its
 * children keep their own paths — so one modal covers both rather than two
 * near-identical ones drifting apart.
 */
export function ProjectEditModal({ target, onClose, onSave }: ProjectEditModalProps) {
  const [name, setName] = useState(target.name)
  const [path, setPath] = useState(target.path)
  const [picking, setPicking] = useState(false)

  const isGroup = target.kind === 'group'
  const trimmedName = name.trim()
  const trimmedPath = path.trim()
  const canSave = trimmedName.length > 0 && trimmedPath.length > 0

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={isGroup ? '그룹 편집' : '프로젝트 편집'}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-3">
          <Folder size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 text-sm font-semibold text-[var(--text)]">{isGroup ? '그룹 편집' : '프로젝트 편집'}</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[var(--text-2)]">이름</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              aria-label="이름"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[var(--text-2)]">{isGroup ? '그룹 루트 경로' : '폴더 경로'}</span>
            <span className="flex gap-1.5">
              <input
                value={path}
                onChange={e => setPath(e.target.value)}
                aria-label={isGroup ? '그룹 루트 경로' : '폴더 경로'}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
              >
                <FolderOpen size={13} />
                찾아보기
              </button>
            </span>
          </label>

          {isGroup && (
            // Said out loud because the alternative — silently rewriting child
            // paths under the new root — would break any child living elsewhere.
            <p className="text-[11px] leading-relaxed text-[var(--text-3)]">
              하위 프로젝트의 경로는 그대로 유지돼요. 루트만 바뀝니다.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-soft)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onSave({ name: trimmedName, path: trimmedPath })}
            className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-[var(--on-accent)] disabled:opacity-40"
          >
            <Check size={13} />
            저장
          </button>
        </div>
      </div>

      {picking && (
        <DirectoryPicker
          initialPath={trimmedPath || undefined}
          onClose={() => setPicking(false)}
          onSelect={selected => {
            setPath(selected)
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}
