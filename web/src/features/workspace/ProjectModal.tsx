import { useState, type ReactNode } from 'react'
import { Blocks, Folder, FolderOpen, RefreshCw, X } from 'lucide-react'
import { apiUi, type FsEntry } from '../../api.ui'
import { DirectoryPicker } from './DirectoryPicker'
import { addGroup, addProject } from './projects'
import type { ProjectsData } from './types'

/** Last path segment, for auto-filling a display name from a picked folder. */
function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

interface ProjectModalProps {
  existing: ProjectsData
  onClose: () => void
  onSave: (next: ProjectsData) => void
}

type Mode = 'single' | 'group'

/** Add-project/group modal (spec §1) — group mode scans subfolders via `/fs/list`, falling back to manual entry when that call fails. */
export function ProjectModal({ existing, onClose, onSave }: ProjectModalProps) {
  const [mode, setMode] = useState<Mode>('single')

  const [singlePath, setSinglePath] = useState('')
  const [singleName, setSingleName] = useState('')
  const [singleGroupId, setSingleGroupId] = useState('')

  const [groupRoot, setGroupRoot] = useState('')
  const [groupName, setGroupName] = useState('')
  const [scanEntries, setScanEntries] = useState<FsEntry[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [manualRows, setManualRows] = useState<{ name: string; path: string }[]>([])
  const [manualName, setManualName] = useState('')
  const [manualPath, setManualPath] = useState('')

  const [picker, setPicker] = useState<null | 'single' | 'group'>(null)

  const runScan = async (rootOverride?: string) => {
    const root = (rootOverride ?? groupRoot).trim()
    if (!root) return
    setScanning(true)
    setScanError(null)
    try {
      const res = await apiUi.listFsEntries(root)
      const dirs = res.entries.filter(e => e.is_dir)
      setScanEntries(dirs)
      setSelected(Object.fromEntries(dirs.map(d => [d.name, true])))
    } catch {
      setScanEntries(null)
      setScanError('하위 폴더를 조회하지 못했어요 (fs/list 사용 불가) — 아래에 직접 추가해 주세요.')
    } finally {
      setScanning(false)
    }
  }

  const addManualRow = () => {
    if (!manualName.trim() || !manualPath.trim()) return
    setManualRows(current => [...current, { name: manualName.trim(), path: manualPath.trim() }])
    setManualName('')
    setManualPath('')
  }

  const canSave = mode === 'single' ? singlePath.trim() && singleName.trim() : groupRoot.trim() && groupName.trim()

  const handleSave = () => {
    if (mode === 'single') {
      if (!singlePath.trim() || !singleName.trim()) return
      onSave(addProject(existing, { name: singleName.trim(), path: singlePath.trim(), groupId: singleGroupId || undefined }))
      return
    }
    const root = groupRoot.trim().replace(/\/+$/, '')
    const children = scanEntries
      ? scanEntries.filter(d => selected[d.name]).map(d => ({ name: d.name, path: `${root}/${d.name}` }))
      : manualRows
    onSave(addGroup(existing, { name: groupName.trim(), root: groupRoot.trim(), children }))
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="프로젝트 추가">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <Folder size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 text-sm font-semibold text-[var(--text)]">프로젝트 추가</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">유형</label>
            <div className="flex gap-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'single'}
                onClick={() => setMode('single')}
                className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold ${
                  mode === 'single' ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-2)]'
                }`}
              >
                <Folder size={13} />
                단일 프로젝트
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'group'}
                onClick={() => setMode('group')}
                className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold ${
                  mode === 'group' ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-2)]'
                }`}
              >
                <Blocks size={13} />
                프로젝트 그룹
              </button>
            </div>
            <p className="mt-1.5 text-[10.5px] text-[var(--text-3)]">그룹은 한 제품(솔루션)을 이루는 연관 프로젝트 묶음이에요 — 예: 알람 솔루션 = web + engine.</p>
          </div>

          {mode === 'single' ? (
            <>
              <Field label="Working Directory">
                <div className="flex gap-1.5">
                  <input
                    value={singlePath}
                    onChange={e => setSinglePath(e.target.value)}
                    placeholder="~/work/my-project"
                    className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => setPicker('single')}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                  >
                    <FolderOpen size={13} />
                    찾아보기
                  </button>
                </div>
                <p className="mt-1 text-[10.5px] text-[var(--text-3)]">직접 입력하거나, 찾아보기로 서버의 폴더를 골라요.</p>
              </Field>
              <Field label="표시 이름">
                <input
                  value={singleName}
                  onChange={e => setSingleName(e.target.value)}
                  placeholder="프로젝트 이름"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </Field>
              {existing.groups.length > 0 && (
                <Field label="소속 그룹">
                  <select
                    value={singleGroupId}
                    onChange={e => setSingleGroupId(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">없음 (독립 프로젝트)</option>
                    {existing.groups.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name} — {g.root}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="그룹 루트 디렉터리">
                <div className="flex gap-1.5">
                  <input
                    value={groupRoot}
                    onChange={e => setGroupRoot(e.target.value)}
                    onBlur={() => void runScan()}
                    placeholder="~/work/a-solution"
                    className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => setPicker('group')}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                  >
                    <FolderOpen size={13} />
                    찾아보기
                  </button>
                </div>
                <p className="mt-1 text-[10.5px] text-[var(--text-3)]">이 폴더 아래 하위 폴더들을 프로젝트로 등록해요. 그룹 루트 자체로도 세션을 열 수 있어요.</p>
              </Field>
              <Field label="그룹 이름">
                <input
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="예: 알람 솔루션"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </Field>

              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <label className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">하위 프로젝트</label>
                  <button
                    type="button"
                    onClick={() => void runScan()}
                    disabled={!groupRoot.trim() || scanning}
                    className="flex h-6 items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 text-[11px] font-semibold text-[var(--text-2)] disabled:opacity-40"
                  >
                    <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
                    다시 스캔
                  </button>
                </div>

                {scanEntries && scanEntries.length > 0 && (
                  <div className="space-y-1">
                    {scanEntries.map(entry => (
                      <label key={entry.name} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!selected[entry.name]}
                          onChange={e => setSelected(prev => ({ ...prev, [entry.name]: e.target.checked }))}
                          className="accent-[var(--accent)]"
                        />
                        <span className="flex-1 text-xs font-medium text-[var(--text)]">
                          {entry.name}
                          {entry.markers.length > 0 && (
                            <span className="ml-1.5 rounded bg-[var(--surface-3)] px-1 py-0.5 text-[9px] font-semibold text-[var(--text-2)]">
                              감지: {entry.markers.join(', ')}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {scanEntries && scanEntries.length === 0 && (
                  <p className="text-[11px] text-[var(--text-3)]">하위 폴더를 찾지 못했어요.</p>
                )}

                {scanError && (
                  <div className="space-y-2">
                    <p className="rounded-lg bg-[var(--warning-bg)] px-2.5 py-2 text-[11px] text-[var(--warning)]">{scanError}</p>
                    <div className="flex gap-1.5">
                      <input
                        value={manualName}
                        onChange={e => setManualName(e.target.value)}
                        placeholder="이름"
                        className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                      <input
                        value={manualPath}
                        onChange={e => setManualPath(e.target.value)}
                        placeholder="~/work/a-solution/web"
                        className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                      <button type="button" onClick={addManualRow} className="rounded-lg bg-[var(--surface-2)] px-2.5 text-xs font-semibold text-[var(--text-2)]">
                        추가
                      </button>
                    </div>
                    {manualRows.map((row, i) => (
                      <div key={`${row.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs">
                        <span className="font-medium text-[var(--text)]">{row.name}</span>
                        <span className="flex-1 truncate font-mono text-[10.5px] text-[var(--text-3)]">{row.path}</span>
                        <button
                          type="button"
                          onClick={() => setManualRows(current => current.filter((_, idx) => idx !== i))}
                          className="text-[var(--text-3)] hover:text-[var(--danger)]"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <button type="button" onClick={onClose} className="h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-2)]">
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="h-8 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-40"
          >
            프로젝트 추가
          </button>
        </div>
      </div>

      {picker && (
        <DirectoryPicker
          initialPath={(picker === 'single' ? singlePath : groupRoot) || '~'}
          onClose={() => setPicker(null)}
          onSelect={path => {
            if (picker === 'single') {
              setSinglePath(path)
              if (!singleName.trim()) setSingleName(basename(path))
            } else {
              setGroupRoot(path)
              if (!groupName.trim()) setGroupName(basename(path))
              void runScan(path)
            }
          }}
        />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">{label}</label>
      {children}
    </div>
  )
}
