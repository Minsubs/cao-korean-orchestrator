import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Blocks, Loader2 } from 'lucide-react'
import {
  toolingApi,
  type CatalogItem,
  type ToolingDiagnostic,
  type ToolingEnvironment,
  type ToolingExtension,
  type ToolingProvider,
  type ToolingSources,
} from '../../api.tooling'
import { OverviewPane } from './OverviewPane'
import { InstalledPane } from './InstalledPane'
import { DiagnosticsPane } from './DiagnosticsPane'
import { UpdatesPane } from './UpdatesPane'
import { DiscoverPane } from './DiscoverPane'
import { SourcesPane } from './SourcesPane'
import { EnvProfilesPane } from './EnvProfilesPane'
import { PreviewModal } from './PreviewModal'
import { useToolingOperations } from './useToolingOperations'
import { SkeletonBlock } from './shared'

type TabKey = 'overview' | 'installed' | 'discover' | 'updates' | 'sources' | 'envprofiles' | 'diagnostics'

const DISABLED_TITLE = 'Phase 4~6에서 제공돼요'

// Phase 6c activates the last two tabs (소스/환경 프로필) — every tab is now
// active. `active` stays on each entry (rather than dropping the flag
// outright) so a future tab can be added disabled the same way these two
// were, without a second code path.
const TABS: { key: TabKey; label: string; active: boolean }[] = [
  { key: 'overview', label: '개요', active: true },
  { key: 'installed', label: '설치됨', active: true },
  { key: 'discover', label: '탐색·추천', active: true },
  { key: 'updates', label: '업데이트', active: true },
  { key: 'sources', label: '소스', active: true },
  { key: 'envprofiles', label: '환경 프로필', active: true },
  { key: 'diagnostics', label: '진단', active: true },
]

// Placeholder shown until /tooling/environment has ever returned successfully
// (and reused if it fails) — every field null renders as "확인할 수 없음"
// (OverviewPane already handles a fully-null environment; see its tests).
const EMPTY_ENVIRONMENT: ToolingEnvironment = {
  os: null,
  os_version: null,
  arch: null,
  shell: null,
  is_wsl: null,
  server_version: null,
  python_version: null,
  checked_at: null,
}

/**
 * Tools & Extensions — Phase 3b (read-only: Overview/Installed/Diagnostics)
 * + Phase 4b (write path: Updates tab — Skill 관리 + Operation Queue, and
 * the Installed tab's per-extension [업데이트]/[삭제] buttons) + Phase 5b
 * (탐색 탭 — 인기 확장 카탈로그, and provider-native items folded into the
 * Installed tab's filters) + Phase 6c (소스 탭 — 디렉터리 소스/큐레이션
 * 카탈로그 출처/마켓플레이스 조회; 환경 프로필 탭 — 스냅샷/내보내기·
 * 가져오기/비교, no new backend, built entirely from four already-existing
 * endpoints — see features/tooling/envProfile.ts). All tabs share the
 * adapters/operations state and Preview-modal flow owned by
 * useToolingOperations (lifted here so the Updates tab's in-progress
 * spinner/badge stays correct even while a different sub-tab is active) — a
 * catalog install is just another onRequestAction call into that same
 * plan→Preview→execute→Queue flow.
 *
 * Integration note for the AppShell owner: ToolingView is already wired in
 * (AppShell.tsx's 'tooling' case renders <ToolingView />) — nothing further
 * to do there for this phase.
 */
export function ToolingView() {
  const [tab, setTab] = useState<TabKey>('overview')

  // The four "core" reads (environment/providers/extensions/diagnostics) are
  // tracked independently rather than as one `data` blob: each can fail on its
  // own (WSL cold-probe timeout, one provider CLI missing, …) and previously a
  // single failure blanked the entire screen via Promise.all — see
  // handoff/RCA for the Tooling ERR_ABORTED bug. With independent state, a
  // failing endpoint only degrades the tab(s) that actually depend on it;
  // everything else keeps rendering real data.
  const [environment, setEnvironment] = useState<ToolingEnvironment>(EMPTY_ENVIRONMENT)
  const [environmentError, setEnvironmentError] = useState(false)
  const [providers, setProviders] = useState<ToolingProvider[]>([])
  const [providersError, setProvidersError] = useState(false)
  const [extensions, setExtensions] = useState<ToolingExtension[]>([])
  const [extensionsError, setExtensionsError] = useState(false)
  const [diagnostics, setDiagnostics] = useState<ToolingDiagnostic[]>([])
  const [diagnosticsError, setDiagnosticsError] = useState(false)

  const [loading, setLoading] = useState(true)
  const [rescanning, setRescanning] = useState(false)
  const [rescanError, setRescanError] = useState<string | null>(null)
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null)
  const [pendingQueueFocus, setPendingQueueFocus] = useState(false)

  // Phase 5b catalog — loaded and error-isolated independently of the main
  // `load()` below (same availability stance as adapters/operations in
  // useToolingOperations): /tooling/catalog can 404 on its own (Phase 5a
  // backend developed in parallel) without taking down the other tabs, so it
  // must never join that Promise.all. DiscoverPane alone degrades to an
  // honest error+retry state on failure.
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState(false)

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true)
    try {
      const list = await toolingApi.listCatalog()
      setCatalog(list)
      setCatalogError(false)
    } catch {
      setCatalog([])
      setCatalogError(true)
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  // Phase 6c sources — same independent-load/independent-error stance as
  // catalog above: `/tooling/sources` is built by a separate parallel
  // session and can 404 on its own without taking down any other tab.
  // SourcesPane alone degrades to an honest error+retry state on failure.
  const [sources, setSources] = useState<ToolingSources | null>(null)
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState(false)

  const loadSources = useCallback(async () => {
    setSourcesLoading(true)
    try {
      const result = await toolingApi.getSources()
      setSources(result)
      setSourcesError(false)
    } catch {
      setSources(null)
      setSourcesError(true)
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  // "완료 후 재검증 반영" (Phase 4b, extended in 5b to also cover catalog
  // install_status): re-fetch just extensions/diagnostics/catalog — not
  // environment/providers, and not through the full loading-skeleton path —
  // whenever an operation the queue is tracking finishes. Best effort: a
  // failed revalidation keeps showing the last known list rather than crash
  // the screen (the Operation Queue's own row still shows the real
  // succeeded/failed outcome regardless).
  const reloadAfterOperation = useCallback(async () => {
    // allSettled (not all): extensions/diagnostics fail independently, and a
    // failure on one must not discard the other's fresh result — best effort,
    // each keeps its last-known value on its own failure rather than crash.
    const [extensionsResult, diagnosticsResult] = await Promise.allSettled([
      toolingApi.listExtensions(),
      toolingApi.listDiagnostics(),
    ])
    if (extensionsResult.status === 'fulfilled') {
      setExtensions(extensionsResult.value)
      setExtensionsError(false)
    }
    if (diagnosticsResult.status === 'fulfilled') {
      setDiagnostics(diagnosticsResult.value)
      setDiagnosticsError(false)
    }
    loadCatalog()
  }, [loadCatalog])

  const {
    adapters,
    adaptersLoading,
    adaptersError,
    operations,
    operationsError,
    inProgressCount,
    refreshAll,
    preview,
    requestAction,
    closePreview,
    confirmExecute,
    cancelOperation,
    retryOperation,
    logs,
    logLoading,
    logError,
    toggleLog,
  } = useToolingOperations(reloadAfterOperation)

  // Preview 모달의 [실행하기] → execute 성공 시 "모달 닫고 Queue로 스크롤/포커스"
  // (요구사항 12). Executes regardless of which tab launched the action
  // (Installed 탭 상세의 업데이트/삭제 포함) — successful execute always
  // routes the user to the Updates tab's Operation Queue.
  const handleConfirmExecute = async () => {
    const ok = await confirmExecute()
    if (ok) {
      setPendingQueueFocus(true)
      setTab('updates')
    }
  }

  // All four endpoints load together, once, on mount. There is no polling
  // anywhere in this view (Phase 3b performance principle) — the single
  // manual "다시 검사" action in the Overview pane is the only refresh path,
  // and it re-runs this same load after POSTing /tooling/scan.
  //
  // allSettled (not all): these four probes are independent and one being
  // slow/dead (e.g. a WSL cold CLI probe exceeding its own timeout) must not
  // abort the other three's already-successful results. Each endpoint's
  // error state is tracked on its own; the full-screen error below only fires
  // when EVERY ONE of the four has failed — a partial failure instead
  // degrades just the tab(s) that depend on the missing piece (see the
  // `environmentError`/`providersError`/`extensionsError`/`diagnosticsError`
  // checks in the render below).
  const load = useCallback(async () => {
    const [environmentResult, providersResult, extensionsResult, diagnosticsResult] = await Promise.allSettled([
      toolingApi.getEnvironment(),
      toolingApi.listProviders(),
      toolingApi.listExtensions(),
      toolingApi.listDiagnostics(),
    ])

    if (environmentResult.status === 'fulfilled') {
      setEnvironment(environmentResult.value)
      setEnvironmentError(false)
    } else {
      setEnvironmentError(true)
    }

    if (providersResult.status === 'fulfilled') {
      setProviders(providersResult.value)
      setProvidersError(false)
    } else {
      setProvidersError(true)
    }

    if (extensionsResult.status === 'fulfilled') {
      setExtensions(extensionsResult.value)
      setExtensionsError(false)
    } else {
      setExtensionsError(true)
    }

    if (diagnosticsResult.status === 'fulfilled') {
      setDiagnostics(diagnosticsResult.value)
      setDiagnosticsError(false)
    } else {
      setDiagnosticsError(true)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  // Re-fires every read this view owns — not just the core four. A full
  // outage (router not mounted, network down) also takes catalog/sources down
  // with it, so "다시 시도" (both the full-screen and any per-section retry
  // below) must recover them too, not just leave them stuck in their own
  // stale error state until the user separately visits those tabs.
  const handleRetry = () => {
    setLoading(true)
    const reloads: Promise<unknown>[] = [load()]
    if (catalogError) reloads.push(loadCatalog())
    if (sourcesError) reloads.push(loadSources())
    Promise.all(reloads).finally(() => setLoading(false))
  }

  const handleRescan = async () => {
    setRescanning(true)
    setRescanError(null)
    try {
      const result = await toolingApi.scan()
      await load()
      setScannedAt(result.scanned_at)
    } catch {
      setRescanError('다시 검사에 실패했어요 — 서버 연결을 확인하세요')
    } finally {
      setRescanning(false)
    }
  }

  if (loading) {
    return <ToolingSkeleton />
  }

  // Whole-screen error only when every one of the four core reads has failed
  // — a single dead endpoint degrades just its own tab(s) below instead (see
  // `environmentError`/`providersError`/`extensionsError`/`diagnosticsError`).
  if (environmentError && providersError && extensionsError && diagnosticsError) {
    return <ToolingErrorScreen onRetry={handleRetry} />
  }

  const diagnosticsWarnCount = diagnostics.filter(d => d.severity !== 'info').length

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 pb-3">
        <h1 className="flex items-center gap-2 text-lg font-bold text-[var(--text)]">
          <Blocks size={20} className="text-[var(--accent-text)]" />
          도구 및 확장
        </h1>
        <p className="mt-0.5 text-xs text-[var(--text-3)]">설치된 AI 도구를 확인하고, 검증된 MCP·플러그인·스킬을 추천에서 추가해요.</p>
      </div>

      <div role="tablist" aria-label="도구 및 확장 하위 탭" className="grid grid-cols-3 gap-1 border-b border-[var(--border)] sm:flex sm:flex-wrap">
        {TABS.map(t => {
          if (!t.active) {
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={false}
                aria-disabled="true"
                disabled
                title={DISABLED_TITLE}
                className="cursor-not-allowed rounded-t-lg px-3 py-2 text-xs font-semibold text-[var(--text-3)] opacity-50"
              >
                {t.label}
              </button>
            )
          }
          const isActiveTab = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActiveTab}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-2 text-xs font-semibold transition-colors ${
                isActiveTab
                  ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--accent-text)]'
                  : 'border-transparent text-[var(--text-3)] hover:text-[var(--text)]'
              }`}
            >
              {t.label}
              {t.key === 'installed' && extensions.length > 0 && (
                <span
                  className="rounded-full px-1.5 py-[1px] text-[10px] font-bold"
                  style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-2)' }}
                >
                  {extensions.length}
                </span>
              )}
              {t.key === 'diagnostics' && diagnosticsWarnCount > 0 && (
                <span
                  className="rounded-full px-1.5 py-[1px] text-[10px] font-bold"
                  style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}
                >
                  {diagnosticsWarnCount}
                </span>
              )}
              {t.key === 'updates' && inProgressCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[10px] font-bold"
                  style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info)' }}
                >
                  <Loader2 size={10} className="animate-spin" />
                  {inProgressCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        {tab === 'overview' &&
          (environmentError || providersError ? (
            <ToolingSectionError onRetry={handleRetry} />
          ) : (
            <OverviewPane
              environment={environment}
              providers={providers}
              extensionCount={extensions.length}
              diagnosticsWarnCount={diagnosticsWarnCount}
              scannedAt={scannedAt ?? environment.checked_at}
              rescanning={rescanning}
              rescanError={rescanError}
              onRescan={handleRescan}
              onRequestAction={requestAction}
            />
          ))}
        {tab === 'installed' &&
          (extensionsError ? (
            <ToolingSectionError onRetry={handleRetry} />
          ) : (
            <InstalledPane
              extensions={extensions}
              selectedId={selectedExtensionId}
              onSelect={setSelectedExtensionId}
              adapters={adapters}
              adaptersLoading={adaptersLoading}
              adaptersError={adaptersError}
              onRequestAction={requestAction}
            />
          ))}
        {tab === 'diagnostics' &&
          (diagnosticsError ? <ToolingSectionError onRetry={handleRetry} /> : <DiagnosticsPane diagnostics={diagnostics} />)}
        {tab === 'discover' && (
          <DiscoverPane
            catalog={catalog}
            loading={catalogLoading}
            error={catalogError}
            onRetry={loadCatalog}
            adapters={adapters}
            onRequestAction={requestAction}
          />
        )}
        {tab === 'sources' && (
          <SourcesPane
            sources={sources}
            loading={sourcesLoading}
            error={sourcesError}
            onRetry={loadSources}
            adapters={adapters}
            onNavigateToDiscover={() => setTab('discover')}
          />
        )}
        {tab === 'envprofiles' && <EnvProfilesPane />}
        {tab === 'updates' && (
          <UpdatesPane
            adapters={adapters}
            adaptersLoading={adaptersLoading}
            adaptersError={adaptersError}
            extensions={extensions}
            operations={operations}
            operationsError={operationsError}
            logs={logs}
            logLoading={logLoading}
            logError={logError}
            onToggleLog={toggleLog}
            onRequestAction={requestAction}
            onCancelOperation={cancelOperation}
            onRetryOperation={retryOperation}
            onRefresh={refreshAll}
            autoFocusQueue={pendingQueueFocus}
            onQueueFocused={() => setPendingQueueFocus(false)}
          />
        )}
      </div>

      <PreviewModal preview={preview} onExecute={handleConfirmExecute} onClose={closePreview} />
    </div>
  )
}

function ToolingSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="도구 및 확장 불러오는 중">
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-16 w-32" />
        ))}
      </div>
      <SkeletonBlock className="h-40 w-full" />
      <SkeletonBlock className="h-56 w-full" />
    </div>
  )
}

/** Shared innards of the "can't reach Tooling API" state — the full-screen
 * version (`ToolingErrorScreen`) and the per-section version
 * (`ToolingSectionError`) differ only in their outer wrapper (full height vs.
 * scoped to one tab's content area). */
function ToolingErrorContent({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
        <AlertTriangle size={22} />
      </div>
      <h2 className="text-sm font-semibold text-[var(--text)]">Tooling API에 연결할 수 없어요</h2>
      <p className="max-w-sm text-xs leading-relaxed text-[var(--text-3)]">서버 버전을 확인하세요</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105"
      >
        다시 시도
      </button>
    </>
  )
}

function ToolingErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="region"
      aria-label="Tooling API에 연결할 수 없어요"
      className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center"
    >
      <ToolingErrorContent onRetry={onRetry} />
    </div>
  )
}

// Scoped version rendered INSIDE a single tab's content area when only that
// tab's data failed to load (e.g. just /tooling/diagnostics), so the rest of
// the screen — tab bar, other tabs' real data — stays intact instead of
// blanking to the full-screen error above.
function ToolingSectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="region"
      aria-label="Tooling API에 연결할 수 없어요"
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center"
    >
      <ToolingErrorContent onRetry={onRetry} />
    </div>
  )
}
