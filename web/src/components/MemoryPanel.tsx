import { useState, useEffect } from 'react'
import { api, MemorySummary, MemoryDetail } from '../api'
import { useStore } from '../store'
import { ConfirmModal } from './ConfirmModal'
import { Brain, Search, Trash2, ChevronDown, ChevronRight, List, Share2 } from 'lucide-react'
import { CustomSelect } from './CustomSelect'
import { MemoryGraphView } from './MemoryGraphView'

type ViewMode = 'list' | 'graph'

const SCOPE_OPTIONS = [
  { value: '', label: '모든 범위' },
  { value: 'global', label: '전역' },
  { value: 'project', label: '프로젝트' },
  { value: 'session', label: '세션' },
  { value: 'agent', label: '에이전트' },
]

const TYPE_OPTIONS = [
  { value: '', label: '모든 유형' },
  { value: 'user', label: '사용자' },
  { value: 'feedback', label: '피드백' },
  { value: 'project', label: '프로젝트' },
  { value: 'reference', label: '참고자료' },
]

const SCOPE_PILL: Record<string, string> = {
  global: 'bg-blue-900/50 text-blue-400',
  project: 'bg-emerald-900/50 text-emerald-400',
  session: 'bg-yellow-900/50 text-yellow-400',
  agent: 'bg-purple-900/50 text-purple-400',
}

const SCOPE_LABELS: Record<string, string> = {
  global: '전역',
  project: '프로젝트',
  session: '세션',
  agent: '에이전트',
}

const TYPE_LABELS: Record<string, string> = {
  user: '사용자',
  feedback: '피드백',
  project: '프로젝트',
  reference: '참고자료',
}

// Keys are unique only within (scope, scope_id), so rows need a composite id
function rowId(m: MemorySummary): string {
  return `${m.scope}:${m.scope_id ?? ''}:${m.key}`
}

export function MemoryPanel() {
  const { showSnackbar } = useStore()

  // Memory list state
  const [memories, setMemories] = useState<MemorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [scopeFilter, setScopeFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  // List⇄Graph view toggle. Component state only (no persistence).
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  // scope_id for the graph view in project scope. Shared with the list clear
  // logic conceptually, but the list doesn't need one. Defaulted from the
  // listed memories when a project scope_id is discoverable.
  const [graphScopeId, setGraphScopeId] = useState('')

  // Expanded detail state; detail is keyed by row id so a slow fetch for a
  // previously-expanded row can't land under the currently-expanded one
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ id: string; data: MemoryDetail } | null>(null)

  // Delete / clear confirmation state
  const [pendingDelete, setPendingDelete] = useState<MemorySummary | null>(null)
  const [pendingClear, setPendingClear] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchMemories = async () => {
    try {
      const data = await api.listMemories({
        scope: scopeFilter || undefined,
        type: typeFilter || undefined,
      })
      setMemories(data)
    } catch {
      setMemories([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMemories()
  }, [scopeFilter, typeFilter])

  // Default the graph's project scope_id from the listed memories when one is
  // discoverable and the user hasn't typed their own. Keeps the graph view
  // usable in project scope without forcing the user to know the canonical id.
  useEffect(() => {
    if (scopeFilter !== 'project' || graphScopeId) return
    const discovered = memories.find(m => m.scope === 'project' && m.scope_id)?.scope_id
    if (discovered) setGraphScopeId(discovered)
  }, [scopeFilter, memories, graphScopeId])

  const handleExpand = async (m: MemorySummary) => {
    const id = rowId(m)
    if (expandedKey === id) {
      setExpandedKey(null)
      return
    }
    setExpandedKey(id)
    setDetail(null)
    try {
      const d = await api.getMemory(m.key, m.scope, m.scope_id ?? undefined)
      // A stale slow fetch must not clobber the detail of a row expanded later
      setExpandedKey(current => {
        if (current === id) setDetail({ id, data: d })
        return current
      })
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '메모리를 불러오지 못했습니다' })
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setBusy(true)
    try {
      await api.deleteMemory(pendingDelete.key, pendingDelete.scope, pendingDelete.scope_id ?? undefined)
      showSnackbar({ type: 'success', message: `메모리 "${pendingDelete.key}"을(를) 삭제했습니다` })
      await fetchMemories()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '메모리를 삭제하지 못했습니다' })
    } finally {
      setBusy(false)
      setPendingDelete(null)
    }
  }

  const handleClear = async () => {
    if (!pendingClear) return
    setBusy(true)
    let deleted = 0
    let failures = 0
    try {
      if (pendingClear === 'global') {
        const res = await api.clearMemories(pendingClear)
        deleted = res.deleted_count
      } else {
        // Server requires scope_id for non-global scopes. Re-fetch the scope
        // unfiltered (the view may be narrowed by a type filter or the default
        // page size), then clear each scope_id best-effort (matching the
        // server's own warn-and-continue semantics)
        const scopeMemories = await api.listMemories({ scope: pendingClear, limit: 100 })
        const scopeIds = [...new Set(
          scopeMemories.filter(m => m.scope_id).map(m => m.scope_id as string)
        )]
        for (const scopeId of scopeIds) {
          try {
            const res = await api.clearMemories(pendingClear, scopeId)
            deleted += res.deleted_count
          } catch {
            failures++
          }
        }
      }
      if (failures > 0) {
        showSnackbar({ type: 'error', message: `${deleted}개를 삭제했지만 범위 ID ${failures}개는 실패했습니다` })
      } else {
        showSnackbar({ type: 'success', message: `메모리 ${deleted}개를 삭제했습니다` })
      }
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '메모리를 비우지 못했습니다' })
    } finally {
      // Refetch even after failure — some deletions may already have landed
      await fetchMemories()
      setBusy(false)
      setPendingClear(null)
    }
  }

  const filtered = memories.filter(m => !search || m.key.includes(search.toLowerCase()))

  return (
    <div className="space-y-6">
      {/* View-mode toggle + shared scope selector. The scope (and, in graph +
          project mode, scope_id) is shared across both views. */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden" role="tablist" aria-label="메모리 보기 방식">
          <button
            role="tab"
            aria-selected={viewMode === 'list'}
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
              viewMode === 'list' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <List size={14} />
            목록
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'graph'}
            onClick={() => setViewMode('graph')}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
              viewMode === 'graph' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <Share2 size={14} />
            그래프
          </button>
        </div>

        <CustomSelect
          value={scopeFilter}
          onChange={setScopeFilter}
          options={SCOPE_OPTIONS}
          className="w-40"
        />

        {/* Graph + project needs a concrete scope_id (defaulted from the listed
            memories when discoverable). Only shown where it applies. */}
        {viewMode === 'graph' && scopeFilter === 'project' && (
          <input
            type="text"
            value={graphScopeId}
            onChange={e => setGraphScopeId(e.target.value)}
            placeholder="프로젝트 scope_id (예: github-com-…)"
            className="bg-gray-900 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 w-72 focus:border-emerald-500 focus:outline-none font-mono"
          />
        )}
      </div>

      {viewMode === 'graph' ? (
        <MemoryGraphView scope={scopeFilter} scopeId={graphScopeId} />
      ) : loading ? (
        <div className="text-gray-500 text-sm py-8 text-center">메모리 불러오는 중…</div>
      ) : (
      /* Memory List */
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            메모리 ({filtered.length})
          </h3>
          <button
            onClick={() => setPendingClear(scopeFilter)}
            disabled={!scopeFilter}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            title={scopeFilter ? `${scopeFilter} 범위의 모든 메모리 비우기` : '범위를 선택하면 사용할 수 있습니다'}
          >
            <Trash2 size={14} />
            범위 비우기…
          </button>
        </div>

        {/* Filters (list-only: type + key search) */}
        <div className="flex items-center gap-3 mb-4">
          <CustomSelect
            value={typeFilter}
            onChange={setTypeFilter}
            options={TYPE_OPTIONS}
            className="w-40"
          />
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="키 검색..."
              className="bg-gray-900 border border-gray-700 text-gray-200 text-xs rounded-lg pl-8 pr-3 py-1.5 w-48 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <Brain size={32} className="mx-auto text-gray-600 mb-3" />
            <p className="text-gray-500 text-sm">저장된 메모리가 없습니다.</p>
            <p className="text-gray-600 text-xs mt-1">
              에이전트는 작업하면서 메모리를 저장합니다. CLI에서도 확인할 수 있습니다: <code className="text-emerald-400">cao memory list</code>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(m => (
              <div key={rowId(m)} className="bg-gray-900/50 border border-gray-700/30 rounded-lg">
                {/* Row header */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-800/50 transition-colors"
                  onClick={() => handleExpand(m)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Brain size={14} className="text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-200 font-medium truncate">{m.key}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${SCOPE_PILL[m.scope] || 'bg-gray-700 text-gray-400'}`}>
                      {SCOPE_LABELS[m.scope] || m.scope}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">{TYPE_LABELS[m.memory_type] || m.memory_type}</span>
                    {m.tags && (
                      <span className="text-xs text-gray-600 truncate">{m.tags}</span>
                    )}
                    <span className="text-xs text-gray-500 shrink-0">
                      {new Date(m.updated_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {/* Delete */}
                    <button
                      onClick={e => { e.stopPropagation(); setPendingDelete(m) }}
                      className="p-1.5 text-gray-500 hover:text-red-400 transition-colors rounded"
                      title="메모리 삭제"
                    >
                      <Trash2 size={14} />
                    </button>

                    {/* Expand chevron */}
                    {expandedKey === rowId(m) ? (
                      <ChevronDown size={14} className="text-gray-500" />
                    ) : (
                      <ChevronRight size={14} className="text-gray-500" />
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {expandedKey === rowId(m) && (
                  <div className="px-3 pb-3 text-xs text-gray-400 space-y-3 border-t border-gray-700/30 pt-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                      <div>생성: <span className="text-gray-300">{new Date(m.created_at).toLocaleString('ko-KR')}</span></div>
                      <div>수정: <span className="text-gray-300">{new Date(m.updated_at).toLocaleString('ko-KR')}</span></div>
                      {m.scope_id && (
                        <div className="col-span-2">범위 ID: <span className="text-gray-300 font-mono">{m.scope_id}</span></div>
                      )}
                      {m.tags && (
                        <div className="col-span-2">태그: <span className="text-gray-300">{m.tags}</span></div>
                      )}
                    </div>
                    {/* Plain text only — memory bodies are untrusted agent output */}
                    {detail && detail.id === rowId(m) ? (
                      <div className="bg-gray-950/60 border border-gray-700/30 rounded-lg p-3 text-sm text-gray-300 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                        {detail.data.content}
                      </div>
                    ) : (
                      <div className="text-gray-500">내용 불러오는 중…</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={!!pendingDelete}
        title="메모리 삭제"
        message="메모리와 기록을 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다."
        details={pendingDelete ? [
          { label: '키', value: pendingDelete.key },
          { label: '범위', value: pendingDelete.scope },
          { label: '범위 ID', value: pendingDelete.scope_id || '해당 없음' },
          { label: '유형', value: TYPE_LABELS[pendingDelete.memory_type] || pendingDelete.memory_type },
        ] : []}
        confirmLabel="메모리 삭제"
        variant="danger"
        loading={busy}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Clear Scope Confirmation Modal. No count shown: the server clears
          the ENTIRE scope (all types, all pages), which can exceed what the
          possibly-filtered view displays. */}
      <ConfirmModal
        open={!!pendingClear}
        title="범위 비우기"
        message="선택한 범위의 모든 메모리를 영구적으로 삭제합니다. 현재 유형 필터나 검색 결과에 보이지 않는 항목도 포함됩니다. 이 작업은 되돌릴 수 없습니다."
        details={pendingClear ? [
          { label: '범위', value: pendingClear },
        ] : []}
        confirmLabel="범위 비우기"
        variant="danger"
        loading={busy}
        onConfirm={handleClear}
        onCancel={() => setPendingClear(null)}
      />
    </div>
  )
}
