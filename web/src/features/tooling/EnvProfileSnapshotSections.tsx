import type { RefObject } from 'react'
import { Camera, FileUp, Loader2, Save } from 'lucide-react'
import { ENV_SNAPSHOT_SECTION_LABEL, type EnvSnapshot, type EnvSnapshotSection } from './envProfile'
import { SectionHeader, SnapshotCard } from './EnvProfileDisplay'
import { formatDateTime } from './shared'

export function PartialFailureList({ sections }: { sections: EnvSnapshotSection[] | null }) {
  if (!sections?.length) return null
  return (
    <div className="mt-2.5 space-y-0.5 text-[10.5px] text-[var(--warning)]">
      {sections.map(section => <div key={section}>{ENV_SNAPSHOT_SECTION_LABEL[section]} 조회 실패 — 이 항목 제외</div>)}
    </div>
  )
}

export function SnapshotCreateSection({ label, creating, blocked, failedSections, onLabelChange, onCreate }: {
  label: string
  creating: boolean
  blocked: boolean
  failedSections: EnvSnapshotSection[] | null
  onLabelChange: (label: string) => void
  onCreate: () => void
}) {
  return (
    <section>
      <SectionHeader icon={<Camera size={13} />} label="스냅샷 생성" />
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <p className="text-xs leading-relaxed text-[var(--text-3)]">
          현재 머신의 도구 환경(CLI 버전·인벤토리·확장·에이전트 프로필 개수)을 스냅샷으로 저장해요. 파일 내용이나 토큰은 절대 담지 않아요 — 이름·버전·개수만요.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="snapshot-label-input" className="sr-only">스냅샷 이름</label>
          <input id="snapshot-label-input" value={label} onChange={event => onLabelChange(event.target.value)} placeholder="스냅샷 이름" className="min-w-[180px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" />
          <button type="button" onClick={onCreate} disabled={creating} className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">
            {creating && <Loader2 size={13} className="animate-spin" />}
            {creating ? '스냅샷 만드는 중…' : '스냅샷 생성'}
          </button>
        </div>
        {blocked ? <p className="mt-2.5 text-[11px] text-[var(--danger)]">환경 정보를 하나도 가져오지 못했어요 — 서버 연결을 확인하세요</p> : <PartialFailureList sections={failedSections} />}
      </div>
    </section>
  )
}

export function SavedSnapshotsSection({ snapshots, onDelete, onExport }: {
  snapshots: EnvSnapshot[]
  onDelete: (capturedAt: string) => void
  onExport: (snapshot: EnvSnapshot) => void
}) {
  return (
    <section>
      <SectionHeader icon={<Save size={13} />} label="저장 목록" />
      <p className="mb-2 text-[10.5px] text-[var(--text-3)]">이 브라우저에만 저장돼요</p>
      {snapshots.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-xs text-[var(--text-3)]">저장된 스냅샷이 없어요</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {snapshots.map(snapshot => <SnapshotCard key={snapshot.captured_at} snapshot={snapshot} onDelete={() => onDelete(snapshot.captured_at)} onExport={() => onExport(snapshot)} />)}
        </div>
      )}
    </section>
  )
}

export function ImportSnapshotSection({ text, error, imported, fileInputRef, onTextChange, onImport, onFile }: {
  text: string
  error: string | null
  imported: EnvSnapshot | null
  fileInputRef: RefObject<HTMLInputElement>
  onTextChange: (text: string) => void
  onImport: () => void
  onFile: (file: File) => void
}) {
  return (
    <section>
      <SectionHeader icon={<FileUp size={13} />} label="가져오기" />
      <div className="space-y-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div>
          <label htmlFor="snapshot-file-input" className="mb-1 block text-[11px] font-semibold text-[var(--text)]">파일에서 가져오기</label>
          <input id="snapshot-file-input" ref={fileInputRef} type="file" accept="application/json,.json" aria-label="스냅샷 파일 선택" onChange={event => { const file = event.target.files?.[0]; if (file) onFile(file) }} className="block w-full text-xs text-[var(--text-2)] file:mr-2 file:rounded-full file:border file:border-[var(--border)] file:bg-[var(--surface)] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-[var(--text-2)]" />
        </div>
        <div>
          <label htmlFor="snapshot-paste-input" className="mb-1 block text-[11px] font-semibold text-[var(--text)]">또는 JSON 붙여넣기</label>
          <textarea id="snapshot-paste-input" aria-label="스냅샷 JSON 붙여넣기" value={text} onChange={event => onTextChange(event.target.value)} placeholder="내보낸 스냅샷 JSON을 붙여넣으세요" rows={4} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]" />
          <button type="button" onClick={onImport} disabled={!text.trim()} className="mt-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50">가져오기</button>
        </div>
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        {imported && !error && <p className="text-xs text-[var(--success)]">가져왔어요: {imported.label} ({formatDateTime(imported.captured_at)})</p>}
      </div>
    </section>
  )
}
