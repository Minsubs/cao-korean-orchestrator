// Knowledge-graph sub-view for the Memory panel (Issue #348).
//
// Renders the memory graph with Sigma over a graphology graph in the web/ React
// stack: lets you click a node to READ that topic's content (plain text —
// memory bodies are untrusted agent output), and export the loaded scope to an
// Obsidian vault. All I/O goes through api.ts; this component never fetch()es.
//
// Visual constants mirror cao_mcp_apps/src/graph/GraphView.tsx exactly.

import { useEffect, useRef, useState } from 'react'
import Graph from 'graphology'
import { circular } from 'graphology-layout'
import Sigma from 'sigma'
import { Brain, Download, RefreshCw, X } from 'lucide-react'
import { api, ApiError, GraphView, MemoryDetail } from '../api'
import { useStore } from '../store'

const HUB_SIZE = 12
const DEFAULT_SIZE = 6
const ORPHAN_COLOR = '#9ca3af'
const DEFAULT_NODE_COLOR = '#2563eb'
const CONTRADICTION_COLOR = '#dc2626'
const DEFAULT_EDGE_COLOR = '#94a3b8'

// The graph endpoint requires a concrete, non-private provider scope. session /
// agent are refused server-side (400, private tier), and '' (all scopes) can't
// project a single graph — so only these two are fetchable.
const GRAPHABLE_SCOPES = new Set(['global', 'project'])

interface MemoryGraphViewProps {
  scope: string
  scopeId: string
}

/**
 * Build a graphology graph from the GraphView wire shape, mirroring
 * GraphView.tsx buildGraph(). circular.assign gives every node an x/y — Sigma
 * throws at construction otherwise. Edges referencing unknown nodes (or
 * duplicates) are skipped rather than throwing.
 */
export function buildGraph(view: GraphView): Graph {
  const graph = new Graph()
  for (const node of view.nodes) {
    const attrs = node.attrs || {}
    graph.addNode(node.id, {
      label: node.label,
      size: attrs.is_hub ? HUB_SIZE : DEFAULT_SIZE,
      color: attrs.is_orphan ? ORPHAN_COLOR : DEFAULT_NODE_COLOR,
    })
  }
  for (const edge of view.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
    if (graph.hasEdge(edge.source, edge.target)) continue
    graph.addEdge(edge.source, edge.target, {
      color: edge.type === 'contradiction' ? CONTRADICTION_COLOR : DEFAULT_EDGE_COLOR,
    })
  }
  circular.assign(graph)
  return graph
}

export function MemoryGraphView({ scope, scopeId }: MemoryGraphViewProps) {
  const { showSnackbar } = useStore()

  const [view, setView] = useState<GraphView | null>(null)
  const [loading, setLoading] = useState(false)
  // Inline error message shown in the canvas area (unreachable / timeout / bad
  // scope), distinct from the friendly scope-guard below.
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Selected-topic side panel state. Keyed by node id so a slow fetch for a
  // previously-clicked node can't land under a later selection.
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ id: string; data: MemoryDetail } | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  // Latest scope/scopeId, so the clickNode handler (bound once per mount) reads
  // current values without being torn down and rebuilt on every scope change.
  const scopeRef = useRef({ scope, scopeId })
  scopeRef.current = { scope, scopeId }
  // Drag state for node dragging. `node` is the node under the pointer between
  // downNode and up; `moved` records whether the pointer actually moved so a
  // drag isn't mistaken for a click-to-read (Sigma can still fire clickNode on
  // mouse-up). Reset on every downNode.
  const dragRef = useRef<{ node: string | null; moved: boolean }>({ node: null, moved: false })
  // Monotonic id for the in-flight graph fetch. Each fetchGraph() call claims
  // the next id; only the latest may touch view/error/loading. Guards against a
  // stale request landing after the user switched scope/scopeId — mirrors the
  // latest-wins pattern openTopic() uses for the side panel.
  const fetchSeqRef = useRef(0)

  const graphable = GRAPHABLE_SCOPES.has(scope)

  // scope_id only belongs to the `project` tier. `global` has no scope_id, so a
  // stale value left in state from a prior project selection must NOT ride along
  // — it produces a 404 (global + a project scope_id names nothing). Compute the
  // effective scope_id from the scope so global always sends none, regardless of
  // what's in `scopeId`.
  const effectiveScopeId = scope === 'project' ? scopeId || undefined : undefined

  const openTopic = async (nodeId: string) => {
    const { scope: s } = scopeRef.current
    // Recompute from the current scope rather than trusting a captured scopeId,
    // so a global topic read never carries a stale project scope_id.
    const sid = s === 'project' ? scopeRef.current.scopeId || undefined : undefined
    setSelectedNode(nodeId)
    setDetail(null)
    setDetailError(null)
    try {
      const data = await api.getMemory(nodeId, s || undefined, sid)
      // Guard against a stale fetch clobbering a later selection.
      setSelectedNode(current => {
        if (current === nodeId) setDetail({ id: nodeId, data })
        return current
      })
    } catch (e) {
      const err = e as ApiError
      setSelectedNode(current => {
        if (current === nodeId) setDetailError(err.detail || err.message || '메모리를 불러오지 못했습니다')
        return current
      })
    }
  }

  const fetchGraph = async () => {
    if (!graphable) return
    // Claim this fetch's id; a later fetchGraph() (scope switch) bumps it, so
    // any state update below is skipped once we're no longer the latest.
    const seq = ++fetchSeqRef.current
    const isStale = () => fetchSeqRef.current !== seq
    setLoading(true)
    setError(null)
    try {
      const data = await api.getGraph('memory', scope, effectiveScopeId)
      if (isStale()) return
      setView(data)
    } catch (e) {
      if (isStale()) return
      const err = e as ApiError
      setView(null)
      if (err.status === 400) {
        setError(err.detail || '이 범위는 그래프로 볼 수 없습니다.')
      } else if (err.status === 404) {
        setError(err.detail || '그래프 provider를 찾을 수 없습니다. 메모리가 활성화되어 있는지 확인하세요.')
      } else if (err.name === 'AbortError') {
        // The AbortController in api.ts fired after the 120s graph budget. The
        // wiki-lint projection is ~30s typical / up to ~148s under load, so a
        // full timeout usually means the CAO server is stuck or down rather
        // than merely slow.
        setError(
          '그래프 요청 시간이 초과되었습니다(120초). wiki-lint 투영은 보통 약 30초, 부하 시 최대 약 148초가 걸립니다. :9889의 CAO 서버가 멈췄는지 확인한 뒤 새로고침하세요.',
        )
      } else if (err.status === undefined) {
        // No HTTP status = the fetch never reached a server (connection
        // refused / proxy target down). The web UI is same-origin: in dev Vite
        // proxies /graph + /memory to cao-server on :9889; the bundled UI is
        // served by that same server. Either way the target isn’t answering.
        setError(
          'CAO 서버에 연결할 수 없습니다. 개발 환경에서는 :9889의 cao-server가 실행 중인지 확인하세요(uv run cao-server).',
        )
      } else {
        setError(err.detail || err.message || 'CAO 서버가 오류를 반환했습니다.')
      }
    } finally {
      // Only the latest request may flip the spinner off — a stale finally
      // must not mask the current request's loading state.
      if (!isStale()) setLoading(false)
    }
  }

  // Refetch whenever the shared scope selector changes. Clears any open topic
  // so the side panel doesn't show a memory from the previous scope.
  useEffect(() => {
    setSelectedNode(null)
    setDetail(null)
    setDetailError(null)
    if (graphable) {
      fetchGraph()
    } else {
      setView(null)
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, scopeId])

  // Mount / rebuild the Sigma canvas whenever the snapshot changes. Never mount
  // against a zero-node snapshot. kill() before re-mount and on unmount so no
  // WebGL context leaks.
  useEffect(() => {
    if (sigmaRef.current) {
      sigmaRef.current.kill()
      sigmaRef.current = null
    }
    if (!containerRef.current || !view || view.nodes.length === 0) return

    const graph = buildGraph(view)
    const sigma = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelRenderedSizeThreshold: 0,
    })
    const container = containerRef.current

    // ── Node dragging (Sigma v3 canonical pattern) ──────────────────────
    // Sigma v3 does not move nodes on its own. On downNode we remember the
    // node and DISABLE the camera so the pan gesture doesn't fight the drag;
    // on moveBody we translate the pointer to graph coords and write x/y; on
    // mouse-up we clear state and RE-ENABLE the camera. `dragRef.moved`
    // distinguishes a drag from a click (see clickNode below).
    sigma.on('downNode', ({ node }) => {
      dragRef.current = { node, moved: false }
      sigma.getCamera().disable()
    })

    sigma.on('moveBody', ({ event }) => {
      const drag = dragRef.current
      if (!drag.node) return
      drag.moved = true
      const pos = sigma.viewportToGraph({ x: event.x, y: event.y })
      graph.setNodeAttribute(drag.node, 'x', pos.x)
      graph.setNodeAttribute(drag.node, 'y', pos.y)
      // Keep the camera from also panning during the drag.
      event.preventSigmaDefault()
      event.original.preventDefault()
      event.original.stopPropagation()
    })

    // Mouse-up may land on the node (upNode) or on empty canvas after the
    // pointer slid off (upStage) — end the drag on either and re-enable the
    // camera. Defer clearing the node so the trailing clickNode (below) can
    // still read `moved` to tell a drag from a click.
    const endDrag = () => {
      if (dragRef.current.node) {
        sigma.getCamera().enable()
        // Keep `moved` so the clickNode that fires right after a drag is
        // suppressed; only null the node so a fresh downNode starts clean.
        dragRef.current.node = null
      }
    }
    sigma.on('upNode', endDrag)
    sigma.on('upStage', endDrag)

    // Click-to-read: only when the pointer did NOT move between down and up.
    // A drag leaves `moved === true`, so it never opens the side panel.
    sigma.on('clickNode', ({ node }) => {
      if (dragRef.current.moved) {
        dragRef.current.moved = false
        return
      }
      void openTopic(node)
    })

    // Cursor affordance: grab on hover, grabbing while dragging.
    sigma.on('enterNode', () => {
      if (!dragRef.current.node) container.style.cursor = 'grab'
    })
    sigma.on('leaveNode', () => {
      if (!dragRef.current.node) container.style.cursor = ''
    })
    sigma.on('downNode', () => {
      container.style.cursor = 'grabbing'
    })
    sigma.on('upStage', () => {
      container.style.cursor = ''
    })
    sigma.on('upNode', () => {
      container.style.cursor = 'grab'
    })

    sigmaRef.current = sigma

    return () => {
      sigma.kill()
      sigmaRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const handleExport = async () => {
    setExporting(true)
    try {
      // dest is a RELATIVE vault name; the server confines it under
      // CAO_GRAPH_EXPORT_ROOT. Never send an absolute path.
      const dest = `${scope}-vault`
      const res = await api.exportGraph('memory', { sink: 'obsidian', dest }, scope, effectiveScopeId)
      const n = res.written_files.length
      const first = n ? ` (${res.written_files[0]})` : ''
      showSnackbar({
        type: 'success',
        message: `노트 ${n}개를 "${res.dest}" vault로 내보냈습니다${first}`,
      })
    } catch (e) {
      const err = e as ApiError
      let message: string
      if (err.status === 401 || err.status === 403) {
        message = '내보내기 권한이 없습니다(cao:write 필요).'
      } else if (err.status === 422) {
        // Secret gate: err.detail names only the matched PATTERN, never the
        // content. Surface it verbatim; nothing was written.
        message = `보안 검사에서 내보내기를 차단했습니다: ${err.detail || '비밀 패턴과 일치함'}. 파일은 작성되지 않았습니다.`
      } else if (err.status === 400) {
        message = err.detail || '내보낼 위치가 잘못되었거나 비공개 범위입니다.'
      } else {
        message = err.detail || err.message || '내보내기에 실패했습니다.'
      }
      showSnackbar({ type: 'error', message })
    } finally {
      setExporting(false)
    }
  }

  const hasGraph = !!view && view.nodes.length > 0

  // Friendly guard: don't fire a doomed request for '' / session / agent.
  if (!graphable) {
    return (
      <div className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl p-8 text-center">
        <Brain size={32} className="mx-auto text-[var(--text-3)] mb-3" />
        <p className="text-[var(--text-3)] text-sm">그래프를 보려면 <span className="text-[var(--accent-text)]">전역</span> 또는 <span className="text-[var(--accent-text)]">프로젝트</span>를 선택하세요.</p>
        <p className="text-[var(--text-3)] text-xs mt-1">
          <span className="text-[var(--text-3)]">모든 범위</span>, <span className="text-[var(--text-3)]">세션</span>, <span className="text-[var(--text-3)]">에이전트</span> 계층은 비공개이므로 그래프로 표시할 수 없습니다.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl p-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wide">
          지식 그래프{view ? ` (노드 ${view.nodes.length}개)` : ''}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchGraph}
            disabled={loading}
            className="flex items-center gap-2 bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] disabled:opacity-40 text-[var(--text)] text-sm font-medium px-3 py-2 rounded-lg transition-colors"
            title="그래프 다시 만들기"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>
          <button
            onClick={handleExport}
            disabled={!hasGraph || exporting}
            className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 text-[var(--on-accent)] text-sm font-medium px-3 py-2 rounded-lg transition-colors"
            title={hasGraph ? '이 그래프를 Obsidian vault로 내보내기' : '먼저 그래프를 불러오세요'}
          >
            <Download size={14} />
            {exporting ? '내보내는 중…' : 'Obsidian으로 내보내기'}
          </button>
        </div>
      </div>

      {/* Graph + side panel */}
      <div className="flex gap-4 h-[600px]">
        {/* Canvas area */}
        <div className="relative flex-1 min-w-0 bg-[var(--bg)] border border-[var(--border-soft)] rounded-lg overflow-hidden">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6" data-testid="graph-loading">
              <RefreshCw size={26} className="text-[var(--accent-text)] animate-spin mb-3" />
              <p className="text-[var(--text-2)] text-sm">그래프 만드는 중…</p>
              <p className="text-[var(--text-3)] text-xs mt-1">서버가 wiki-lint 검사를 실행하므로 약 30초, 부하 시 최대 약 148초가 걸릴 수 있습니다.</p>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6" data-testid="graph-error">
              <X size={28} className="text-[var(--danger)] mb-3" />
              <p className="text-[var(--danger)] text-sm">{error}</p>
              <button onClick={fetchGraph} className="mt-3 text-[var(--accent-text)] text-xs hover:underline">다시 시도</button>
            </div>
          ) : !hasGraph ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6" data-testid="graph-empty">
              <Brain size={32} className="text-[var(--text-3)] mb-3" />
              <p className="text-[var(--text-3)] text-sm">이 범위에는 그래프가 없습니다.</p>
              <p className="text-[var(--text-3)] text-xs mt-1">
                범위 <code className="text-[var(--accent-text)]">{scope}</code>{scopeId ? <> / <code className="text-[var(--accent-text)]">{scopeId}</code></> : null}에 아직 주제가 없습니다.
              </p>
            </div>
          ) : null}
          {/* Canvas is always mounted (but empty until Sigma attaches) so the
              ref exists for the mount effect. Overlays above cover it. */}
          <div ref={containerRef} data-testid="graph-canvas" className="absolute inset-0" />
        </div>

        {/* Side panel: click-to-read. Content renders as PLAIN TEXT only —
            memory bodies are untrusted agent output (matches MemoryPanel). */}
        <aside className="w-80 shrink-0 flex flex-col bg-[var(--bg)] border border-[var(--border-soft)] rounded-lg overflow-hidden">
          {selectedNode ? (
            <>
              <div className="px-4 py-3 border-b border-[var(--border-soft)]">
                <div className="text-sm font-semibold text-[var(--text)] break-all">{selectedNode}</div>
                {detail && detail.id === selectedNode && (
                  <div className="text-xs text-[var(--text-3)] mt-1">
                    {detail.data.memory_type}
                    {detail.data.updated_at ? ` · 수정 ${new Date(detail.data.updated_at).toLocaleString('ko-KR')}` : ''}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {detailError ? (
                  <div className="text-[var(--danger)] text-sm">{detailError}</div>
                ) : detail && detail.id === selectedNode ? (
                  <div className="text-sm text-[var(--text-2)] font-mono whitespace-pre-wrap leading-relaxed">
                    {detail.data.content}
                  </div>
                ) : (
                  <div className="text-[var(--text-3)] text-sm">“{selectedNode}” 불러오는 중…</div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center px-6">
              <p className="text-[var(--text-3)] text-sm">메모리를 읽으려면 그래프에서 노드를 클릭하세요.</p>
            </div>
          )}
        </aside>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-[var(--text-3)]">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: DEFAULT_NODE_COLOR }} /> 주제</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: ORPHAN_COLOR }} /> 고립 노드</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full" style={{ background: DEFAULT_NODE_COLOR }} /> 클수록 허브</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3.5 h-0.5" style={{ background: CONTRADICTION_COLOR }} /> 모순 연결선</span>
      </div>
    </div>
  )
}
