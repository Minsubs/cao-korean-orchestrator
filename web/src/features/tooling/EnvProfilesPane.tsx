import { useMemo, useRef, useState } from 'react'
import {
  ENV_SNAPSHOT_SECTIONS,
  InvalidSnapshotError,
  buildEnvSnapshot,
  defaultSnapshotLabel,
  deleteSnapshot,
  downloadSnapshot,
  loadSavedSnapshots,
  parseSnapshotJson,
  saveSnapshot,
  type EnvSnapshot,
  type EnvSnapshotSection,
} from './envProfile'
import { computeEnvDiff, type EnvProfileDiffResult } from './envProfileDiff'
import { CompareSection, type CompareCandidate } from './EnvProfileCompareSection'
import { ImportSnapshotSection, SavedSnapshotsSection, SnapshotCreateSection } from './EnvProfileSnapshotSections'

export function EnvProfilesPane() {
  const [saved, setSaved] = useState<EnvSnapshot[]>(() => loadSavedSnapshots())
  const [labelInput, setLabelInput] = useState(() => defaultSnapshotLabel())
  const [creating, setCreating] = useState(false)
  const [createFailedSections, setCreateFailedSections] = useState<EnvSnapshotSection[] | null>(null)
  const [createBlocked, setCreateBlocked] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importedSnapshot, setImportedSnapshot] = useState<EnvSnapshot | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [comparing, setComparing] = useState(false)
  const [compareFailedSections, setCompareFailedSections] = useState<EnvSnapshotSection[] | null>(null)
  const [diffResult, setDiffResult] = useState<EnvProfileDiffResult | null>(null)

  const compareCandidates: CompareCandidate[] = useMemo(() => {
    const candidates = saved.map(snapshot => ({ key: snapshot.captured_at, snapshot }))
    return importedSnapshot ? [{ key: 'imported', snapshot: importedSnapshot }, ...candidates] : candidates
  }, [importedSnapshot, saved])
  const selectedSnapshot = compareCandidates.find(candidate => candidate.key === selectedKey)?.snapshot ?? null

  async function handleCreateSnapshot() {
    setCreating(true)
    setCreateFailedSections(null)
    setCreateBlocked(false)
    try {
      const { snapshot, failedSections } = await buildEnvSnapshot(labelInput)
      if (failedSections.length === ENV_SNAPSHOT_SECTIONS.length) {
        setCreateFailedSections(failedSections)
        setCreateBlocked(true)
        return
      }
      setSaved(saveSnapshot(snapshot))
      setCreateFailedSections(failedSections.length ? failedSections : null)
      setLabelInput(defaultSnapshotLabel())
    } finally {
      setCreating(false)
    }
  }

  function handleDelete(capturedAt: string) {
    setSaved(deleteSnapshot(capturedAt))
    if (selectedKey === capturedAt) setSelectedKey('')
  }

  function applyImportedText(raw: string) {
    try {
      const snapshot = parseSnapshotJson(raw)
      setImportedSnapshot(snapshot)
      setImportError(null)
      setSelectedKey('imported')
    } catch (error) {
      setImportedSnapshot(null)
      setImportError(error instanceof InvalidSnapshotError ? error.message : '가져오기에 실패했어요')
    }
  }

  function handleFileChange(file: File) {
    const reader = new FileReader()
    reader.onload = () => applyImportedText(String(reader.result ?? ''))
    reader.onerror = () => setImportError('파일을 읽지 못했어요')
    reader.readAsText(file)
  }

  async function handleCompare() {
    if (!selectedSnapshot) return
    setComparing(true)
    setCompareFailedSections(null)
    setDiffResult(null)
    try {
      const { snapshot: live, failedSections } = await buildEnvSnapshot('현재 환경')
      setCompareFailedSections(failedSections.length ? failedSections : null)
      if (failedSections.length !== ENV_SNAPSHOT_SECTIONS.length) setDiffResult(computeEnvDiff(selectedSnapshot, live))
    } finally {
      setComparing(false)
    }
  }

  return (
    <div className="space-y-5">
      <SnapshotCreateSection label={labelInput} creating={creating} blocked={createBlocked} failedSections={createFailedSections} onLabelChange={setLabelInput} onCreate={handleCreateSnapshot} />
      <SavedSnapshotsSection snapshots={saved} onDelete={handleDelete} onExport={downloadSnapshot} />
      <ImportSnapshotSection text={importText} error={importError} imported={importedSnapshot} fileInputRef={fileInputRef} onTextChange={setImportText} onImport={() => applyImportedText(importText)} onFile={handleFileChange} />
      <CompareSection candidates={compareCandidates} selectedKey={selectedKey} selectedSnapshot={selectedSnapshot} comparing={comparing} failedSections={compareFailedSections} diff={diffResult} onSelect={key => { setSelectedKey(key); setDiffResult(null) }} onCompare={handleCompare} />
    </div>
  )
}
