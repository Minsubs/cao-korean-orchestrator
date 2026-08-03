import { useEffect, useMemo, useState } from 'react'
import { Blocks, Check, ChevronDown, ChevronRight, Folder, Pencil, Pin, Plus, Search, Sidebar as SidebarIcon, Sparkles, Trash2 } from 'lucide-react'
import type { Session } from '../../api'
import { useStore } from '../../store'
import {
  emptyProjectsData,
  findGroupById,
  loadProjectsData,
  matchWorkingDirectoryToProject,
  removeGroup,
  removeProject,
  saveProjectsData,
  togglePinned,
  updateGroup,
  updateProject,
} from './projects'
import { useSessionLocations } from './useSessionLocations'
import type { ProjectsData } from './types'
import { ProjectModal } from './ProjectModal'
import { ProjectEditModal, type ProjectEditTarget } from './ProjectEditModal'
import { ConfirmModal } from '../../components/ConfirmModal'
import { statusDotColor } from './statusColor'
import { displaySessionName } from './displayName'
import { isSessionCompleted } from './sessionCompletion'
import type { FleetSessionSummary } from './useFleetSummaries'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewTask: (prefill?: { targetPath?: string; targetLabel?: string }) => void
  /** Feedback #16: per-session terminal summaries (shared with Overview via Workspace.tsx) used only to compute the "완료" badge. Optional — absent simply means no badge, never a guess. */
  sessionSummaries?: Record<string, FleetSessionSummary>
}

export function Sidebar({ collapsed, onToggleCollapsed, activeSessionId, onSelectSession, onNewTask, sessionSummaries }: SidebarProps) {
  const sessions = useStore(s => s.sessions)
  const terminalStatuses = useStore(s => s.terminalStatuses)
  const locations = useSessionLocations(sessions)

  const [data, setData] = useState<ProjectsData>(() => (typeof window === 'undefined' ? emptyProjectsData() : loadProjectsData()))
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ProjectEditTarget | null>(null)
  // Deleting is confirmed rather than undoable: the entry only lives in
  // localStorage, so there is nothing to restore it from afterwards.
  const [deleteTarget, setDeleteTarget] = useState<(ProjectEditTarget & { childCount?: number }) | null>(null)
  // Ported from the classic AgentPanel.tsx session list's search box (Phase
  // 2c feature-mapping table) — the new Sidebar had no free-text way to find
  // a session in a long list, only the group-focus click filter below.
  const [sessionSearch, setSessionSearch] = useState('')

  const updateData = (next: ProjectsData) => {
    setData(next)
    saveProjectsData(next)
  }

  const matches = useMemo(() => {
    const out: Record<string, ReturnType<typeof matchWorkingDirectoryToProject>> = {}
    sessions.forEach(s => {
      out[s.id] = matchWorkingDirectoryToProject(locations[s.name] ?? locations[s.id], data)
    })
    return out
  }, [sessions, locations, data])

  const visibleSessions = useMemo(() => {
    let list = focusedGroupId ? sessions.filter(s => matches[s.id]?.groupId === focusedGroupId) : sessions
    const query = sessionSearch.trim()
    if (query) list = list.filter(s => s.id.includes(query) || s.name.includes(query))
    return list
  }, [sessions, matches, focusedGroupId, sessionSearch])
  const pinnedSessions = visibleSessions.filter(s => data.pinned.includes(s.id) || data.pinned.includes(s.name))
  const otherSessions = visibleSessions.filter(s => !data.pinned.includes(s.id) && !data.pinned.includes(s.name))

  const sessionStatus = (session: Session): string | undefined => {
    // Any terminal currently processing/waiting/error takes priority over idle/completed.
    const priority = ['error', 'waiting_user_answer', 'processing', 'completed', 'idle']
    const known = Object.entries(terminalStatuses)
      .filter(([, v]) => !!v)
      .map(([, v]) => v.toLowerCase())
    for (const p of priority) {
      if (known.includes(p)) return p
    }
    return undefined
  }

  // Fully hidden when collapsed — re-expanding happens from the Workspace
  // toolbar's persistent toggle (mirrors the mockup: an internal collapse
  // button plus an always-visible external toggle).
  if (collapsed) return null

  return (
    <aside
      className="flex w-[236px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"
      aria-label="프로젝트와 세션"
    >
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-3)]">
          <Folder size={13} />
          프로젝트
        </span>
        <span className="flex gap-0.5">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            title="프로젝트 추가"
            aria-label="프로젝트 추가"
            className="rounded-lg p-1 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="사이드바 접기"
            aria-label="사이드바 접기"
            className="rounded-lg p-1 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <SidebarIcon size={14} />
          </button>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto pb-3">
        {data.groups.length === 0 && data.projects.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--text-3)]">
            아직 등록된 프로젝트가 없어요. + 버튼으로 폴더를 추가하면 세션을 프로젝트별로 모아볼 수 있어요.
          </p>
        ) : (
          <>
            {data.groups.map(group => {
              const open = openGroups[group.id] !== false
              const isFocused = focusedGroupId === group.id
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    aria-selected={isFocused}
                    onClick={() => setFocusedGroupId(current => (current === group.id ? null : group.id))}
                    className={`group mx-1.5 my-0.5 flex w-[calc(100%-12px)] items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-2)] ${
                      isFocused ? 'bg-[var(--accent-soft)]' : ''
                    }`}
                    title="그룹 루트 — 하위 프로젝트 전체에 걸친 세션은 여기서 시작해요"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: 'var(--p-lilac)', color: 'var(--p-lilac-ink)' }}
                    >
                      <Blocks size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`flex items-center gap-1 truncate text-[12.5px] font-semibold ${isFocused ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'}`}>
                        {group.name}
                        <span className="rounded px-1 text-[9px] font-bold" style={{ background: 'var(--p-lilac)', color: 'var(--p-lilac-ink)' }}>
                          그룹
                        </span>
                      </span>
                      <span className="block truncate font-mono text-[10px] text-[var(--text-3)]">{group.root}</span>
                    </span>
                    <RowActions
                      label={group.name}
                      onEdit={() => setEditTarget({ kind: 'group', id: group.id, name: group.name, path: group.root })}
                      onDelete={() =>
                        setDeleteTarget({
                          kind: 'group',
                          id: group.id,
                          name: group.name,
                          path: group.root,
                          childCount: group.children.length,
                        })
                      }
                    />
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={e => {
                        e.stopPropagation()
                        setOpenGroups(prev => ({ ...prev, [group.id]: !open }))
                      }}
                      className="text-[var(--text-3)]"
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  </button>
                  {open && (
                    <div className="ml-5 mr-1.5 border-l border-dashed border-[var(--border)] pl-2">
                      {group.children.map(child => (
                        <div key={child.id} className="group my-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-2)]">
                          <Folder size={13} className="shrink-0 text-[var(--text-3)]" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-[var(--text)]">{child.name}</span>
                            <span className="block truncate font-mono text-[10px] text-[var(--text-3)]">{child.path}</span>
                          </span>
                          <RowActions
                            label={child.name}
                            onEdit={() => setEditTarget({ kind: 'project', id: child.id, name: child.name, path: child.path })}
                            onDelete={() => setDeleteTarget({ kind: 'project', id: child.id, name: child.name, path: child.path })}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {data.projects.map(project => (
              <div
                key={project.id}
                className="group mx-1.5 my-0.5 flex w-[calc(100%-12px)] items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-3)] text-[var(--text-2)]">
                  <Folder size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-[var(--text)]">{project.name}</span>
                  <span className="block truncate font-mono text-[10px] text-[var(--text-3)]">{project.path}</span>
                </span>
                <RowActions
                  label={project.name}
                  onEdit={() => setEditTarget({ kind: 'project', id: project.id, name: project.name, path: project.path })}
                  onDelete={() => setDeleteTarget({ kind: 'project', id: project.id, name: project.name, path: project.path })}
                />
              </div>
            ))}
          </>
        )}

        {sessions.length > 3 && (
          <div className="relative px-3 pt-2">
            <Search size={12} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              placeholder="세션 검색..."
              aria-label="세션 검색"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-7 pr-2 text-[11.5px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        )}

        {pinnedSessions.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-3)]">
              <Pin size={12} />
              고정됨
            </div>
            {pinnedSessions.map(session => (
              <SessionRow
                key={session.id}
                session={session}
                label={matches[session.id]?.label}
                status={sessionStatus(session)}
                active={activeSessionId === session.id}
                pinned
                completed={sessionSummaries?.[session.id] ? isSessionCompleted(sessionSummaries[session.id].terminals) : false}
                onSelect={() => onSelectSession(session.id)}
                onTogglePin={() => updateData(togglePinned(data, session.id))}
              />
            ))}
          </>
        )}

        <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-3)]">
          <Sparkles size={12} />
          세션
        </div>
        {otherSessions.length === 0 ? (
          <p className="px-3 py-1 text-[11px] text-[var(--text-3)]">
            {sessionSearch.trim()
              ? '검색과 일치하는 세션이 없어요.'
              : focusedGroupId
                ? '이 그룹에 매핑된 세션이 없어요.'
                : '활성 세션이 없어요.'}
          </p>
        ) : (
          otherSessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              label={matches[session.id]?.label}
              status={sessionStatus(session)}
              active={activeSessionId === session.id}
              pinned={false}
              completed={sessionSummaries?.[session.id] ? isSessionCompleted(sessionSummaries[session.id].terminals) : false}
              onSelect={() => onSelectSession(session.id)}
              onTogglePin={() => updateData(togglePinned(data, session.id))}
            />
          ))
        )}
      </div>

      <div className="border-t border-[var(--border-soft)] p-2.5">
        <button
          type="button"
          onClick={() => {
            const group = focusedGroupId ? findGroupById(data, focusedGroupId) : undefined
            onNewTask(group ? { targetPath: group.root, targetLabel: `${group.name} · 그룹 루트` } : undefined)
          }}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-[var(--border)] text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
        >
          <Plus size={14} />새 세션
        </button>
      </div>

      {modalOpen && (
        <ProjectModal
          existing={data}
          onClose={() => setModalOpen(false)}
          onSave={next => {
            updateData(next)
            setModalOpen(false)
          }}
        />
      )}

      {editTarget && (
        <ProjectEditModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={input => {
            updateData(
              editTarget.kind === 'group'
                ? updateGroup(data, editTarget.id, { name: input.name, root: input.path })
                : updateProject(data, editTarget.id, input),
            )
            setEditTarget(null)
          }}
        />
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        variant="danger"
        title={deleteTarget?.kind === 'group' ? '그룹을 삭제할까요?' : '프로젝트를 삭제할까요?'}
        message={
          deleteTarget?.kind === 'group'
            ? '목록에서만 사라지고 폴더와 세션은 그대로 남아요. 이 그룹에 속한 하위 프로젝트도 함께 목록에서 제거됩니다.'
            : '목록에서만 사라지고 폴더와 세션은 그대로 남아요. 이 프로젝트에 연결돼 있던 세션은 "기타"로 표시됩니다.'
        }
        details={
          deleteTarget
            ? [
                { label: '이름', value: deleteTarget.name },
                { label: deleteTarget.kind === 'group' ? '루트' : '경로', value: deleteTarget.path },
                ...(deleteTarget.kind === 'group'
                  ? [{ label: '하위 프로젝트', value: `${deleteTarget.childCount ?? 0}개` }]
                  : []),
              ]
            : undefined
        }
        confirmLabel="삭제"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return
          updateData(
            deleteTarget.kind === 'group'
              ? removeGroup(data, deleteTarget.id)
              : removeProject(data, deleteTarget.id),
          )
          if (deleteTarget.kind === 'group' && focusedGroupId === deleteTarget.id) setFocusedGroupId(null)
          setDeleteTarget(null)
        }}
      />
    </aside>
  )
}

function SessionRow({
  session,
  label,
  status,
  active,
  pinned,
  completed,
  onSelect,
  onTogglePin,
}: {
  session: Session
  label: string | undefined
  status: string | undefined
  active: boolean
  pinned: boolean
  /** Feedback #16 — all of this session's (non-killed) terminals settled with at least one completed. */
  completed: boolean
  onSelect: () => void
  onTogglePin: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={active}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
      className={`group mx-1.5 my-0.5 flex w-[calc(100%-12px)] cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
        active ? 'shadow-[inset_0_0_0_1.5px_var(--accent)] bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'
      }`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusDotColor(status) }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-xs font-semibold text-[var(--text)]">
          <span className="truncate">{displaySessionName(session.name)}</span>
          {completed && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--success-bg)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--success)]">
              <Check size={9} />
              완료
            </span>
          )}
        </span>
        <span className="block truncate text-[10.5px] text-[var(--text-3)]">{label || '기타'}</span>
      </span>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          onTogglePin()
        }}
        title={pinned ? '고정 해제' : '고정'}
        aria-label={pinned ? `${displaySessionName(session.name)} 고정 해제` : `${displaySessionName(session.name)} 고정`}
        className={`shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 ${pinned ? 'text-[var(--accent-text)] opacity-100' : 'text-[var(--text-3)]'}`}
      >
        <Pin size={12} />
      </button>
    </div>
  )
}

/**
 * Per-row edit/delete affordances.
 *
 * Spans with `role="button"` rather than real buttons: the group row is itself
 * a `<button>`, and nesting one inside another is invalid HTML that browsers
 * resolve by dropping the inner element — the same reason the chevron beside
 * these is already a span.
 *
 * Visible on hover *and* on focus, so keyboard users are not left without them.
 */
function RowActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  // Dimmed but present, not hidden until hover. Hover-only affordances are how
  // a feature that exists reads as missing — which is exactly the report that
  // prompted adding these.
  const base =
    'rounded p-1 text-[var(--text-3)] opacity-45 transition-opacity hover:bg-[var(--surface-3)] hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100'
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span
        role="button"
        tabIndex={0}
        aria-label={`${label} 편집`}
        title="편집"
        className={base}
        onClick={e => {
          e.stopPropagation()
          onEdit()
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onEdit()
          }
        }}
      >
        <Pencil size={12} />
      </span>
      <span
        role="button"
        tabIndex={0}
        aria-label={`${label} 삭제`}
        title="삭제"
        className={`${base} hover:text-[var(--danger)]`}
        onClick={e => {
          e.stopPropagation()
          onDelete()
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }
        }}
      >
        <Trash2 size={12} />
      </span>
    </span>
  )
}
