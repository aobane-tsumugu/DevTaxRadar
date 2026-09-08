import Value from './WorkspaceValue'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceDraft, WorkspaceSave, WorkspaceView } from '../../planning/workspace.js'
import {
  mergeWorkspaceDrafts,
  type MergeChoice,
  type WorkspaceContents,
} from '../../core/workspaceMerge.js'
import { createFocusTrap } from '../focusTrap.js'

export type WorkspaceComparison = {
  base: WorkspaceDraft
  local: WorkspaceSave
  latest: WorkspaceView | null
  loadError?: string
  requirePreview?: boolean
}

export default function WorkspaceConflictPanel({
  comparison,
  onSave,
  onRetry,
  onCancel,
}: {
  comparison: WorkspaceComparison
  onSave: (contents: WorkspaceContents) => Promise<void>
  onRetry: () => void
  onCancel: () => void
}) {
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)
  const close = useRef(onCancel)
  close.current = busy ? () => {} : onCancel
  useEffect(
    () => (ref.current ? createFocusTrap(ref.current, () => close.current()) : undefined),
    [],
  )
  const analysis = useMemo(() => {
    if (!comparison.latest) return null
    try {
      return {
        result: mergeWorkspaceDrafts(comparison.base, comparison.local, comparison.latest, choices),
      }
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : '比較に失敗しました。' }
    }
  }, [comparison, choices])
  const result = analysis?.result
  const remaining = result?.changes.filter((item) => !item.choice).length ?? 0
  async function save() {
    if (!result?.contents || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave(result.contents)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存結果を確認できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="workspace-comparison"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-comparison-title"
        ref={ref}
      >
        <h2 id="workspace-comparison-title">保存内容の違いを確認</h2>
        <p>
          別の画面で保存されています。変更前、この画面の入力、現在の保存内容を比較し、残す内容を選びます。片方だけの変更はその側を選択しています。同じ記録の金額・期間・割合・理由は一組として扱います。
        </p>
        <p>
          {comparison.requirePreview
            ? '選択中は保存されません。選んだ内容の金額・期間への影響を確認してから保存します。'
            : '選択中は保存されません。「選んだ内容を保存」で最新の版を照合し、参照関係も検証して一括保存します。'}
        </p>
        {comparison.latest ? (
          <p>
            変更前の版 {comparison.base.revision} → 現在の保存版 {comparison.latest.revision} /
            選択が必要な記録 {remaining}件
          </p>
        ) : comparison.loadError ? (
          <>
            <p role="alert">{comparison.loadError}</p>
            <button onClick={onRetry}>最新の内容をもう一度読む</button>
          </>
        ) : (
          <p role="status">最新の保存内容を読み込んでいます。</p>
        )}
        {analysis?.error && <p role="alert">{analysis.error}</p>}
        {result?.changes.map((row) => (
          <fieldset
            key={row.key}
            disabled={busy}
            className={row.conflict ? 'comparison-conflict' : ''}
          >
            <legend>
              {row.label}
              {row.conflict ? '（両方で変更）' : ''}
            </legend>
            <div className="comparison-columns">
              <article>
                <h3>変更前</h3>
                <Value
                  value={row.base}
                  field={row.key.startsWith('charges:') ? 'amountJpy' : row.key}
                />
              </article>
              {(['local', 'latest'] as const).map((side) => (
                <article key={side}>
                  <label>
                    <input
                      type="radio"
                      name={row.key}
                      checked={row.choice === side}
                      onChange={() => setChoices((current) => ({ ...current, [row.key]: side }))}
                    />
                    {side === 'local' ? 'この画面の入力を残す' : '現在の保存内容を残す'}
                  </label>
                  <Value
                    value={row[side]}
                    field={row.key.startsWith('charges:') ? 'amountJpy' : row.key}
                  />
                </article>
              ))}
            </div>
          </fieldset>
        ))}
        {result && result.changes.length === 0 && (
          <p>入力内容に違いはありません。保存元の版を更新して続けられます。</p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="comparison-actions">
          <button className="secondary-button" disabled={busy} onClick={onCancel}>
            入力を保持して戻る
          </button>
          <button
            className="primary-button"
            disabled={!result?.contents || busy}
            onClick={() => void save()}
          >
            {busy
              ? '内容を確認中…'
              : comparison.requirePreview
                ? '選んだ内容の影響を確認'
                : '選んだ内容を保存'}
          </button>
        </div>
      </section>
    </div>
  )
}
