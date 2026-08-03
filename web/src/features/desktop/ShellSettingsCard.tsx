import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info, TerminalSquare } from 'lucide-react'
import { getShellSettings, setShellMode, type NativeShellSettings } from '../../native'

/**
 * Shell / WSL distro selection — desktop app only.
 *
 * Renders nothing in a browser, where there is no server process to configure.
 * Every option comes from live detection in main: an entry that is not usable
 * arrives disabled *with its reason*, so a user never picks something that
 * quietly does nothing.
 */
export function ShellSettingsCard() {
  const [settings, setSettings] = useState<NativeShellSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMode, setSavedMode] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setSettings(await getShellSettings())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!settings) return null

  const choose = async (mode: string) => {
    setSaving(true)
    setError(null)
    const result = await setShellMode(mode)
    setSaving(false)

    if (!result.ok) {
      // The reason comes from main's live check — the shell may have been
      // uninstalled since this list was rendered.
      setError(result.error ?? '설정을 저장하지 못했어요.')
      void refresh()
      return
    }
    setSavedMode(mode)
    void refresh()
  }

  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <TerminalSquare size={15} className="text-[var(--text-3)]" />
        <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wide">서버 실행 셸</h3>
      </div>

      <p className="text-xs text-[var(--text-3)] mb-4">
        서버와 에이전트 터미널이 어떤 셸에서 실행될지 정합니다. 로그인 셸로 실행해야 <code>.zshrc</code> 등에
        설정한 PATH(uv·nvm·pyenv)가 적용돼 CLI 를 정상적으로 찾습니다. 설치되어 있지 않은 항목은 이유와 함께
        선택할 수 없게 표시됩니다.
      </p>

      {settings.fellBackToAuto && (
        <p
          role="status"
          className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--warn-border,var(--border))] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-2)]"
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--warn-text,var(--text-3))]" />
          이전에 선택한 셸을 지금은 쓸 수 없어 <strong>자동</strong>으로 되돌렸어요.
        </p>
      )}

      <div className="space-y-2" role="radiogroup" aria-label="서버 실행 셸">
        {settings.choices.map(choice => {
          const selected = settings.mode === choice.mode
          return (
            <label
              key={choice.mode}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                choice.available ? 'cursor-pointer border-[var(--border)]' : 'cursor-not-allowed border-[var(--border-soft)] opacity-60'
              } ${selected ? 'bg-[var(--surface-3)]' : 'bg-[var(--surface)]'}`}
            >
              <input
                type="radio"
                name="shell-mode"
                className="mt-0.5"
                value={choice.mode}
                checked={selected}
                disabled={!choice.available || saving}
                onChange={() => void choose(choice.mode)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-[var(--text)]">
                  {choice.label}
                  {choice.mode === 'auto' && settings.autoResolvesTo && (
                    <span className="ml-1.5 font-mono text-[11px] text-[var(--text-3)]">
                      → {settings.autoResolvesTo}
                    </span>
                  )}
                </span>
                {choice.unavailableReason && (
                  <span className="mt-0.5 block text-[11px] text-[var(--text-3)]">{choice.unavailableReason}</span>
                )}
                {choice.caveat && (
                  <span className="mt-0.5 flex items-start gap-1 text-[11px] text-[var(--text-3)]">
                    <Info size={11} className="mt-0.5 shrink-0" />
                    {choice.caveat}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      {savedMode && !error && settings.restartRequired && (
        // A running server cannot move into another shell; saying nothing here
        // reads as "the setting did not take".
        <p role="status" className="mt-3 text-xs text-[var(--text-3)]">
          저장했어요. 서버를 다시 시작하면 적용됩니다.
        </p>
      )}
    </div>
  )
}
