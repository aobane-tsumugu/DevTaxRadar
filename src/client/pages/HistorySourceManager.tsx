import { useState } from 'react'
import { sourceAvailabilityCopy, sourceTestCopy, type SourceStatusTone } from '../historySources'
import type {
  HistorySource,
  HistorySourceInput,
  HistorySourceTestResult,
  ProviderKey,
} from '../types'

type SourceDraft = Required<HistorySourceInput>

const emptyDraft: SourceDraft = { provider: 'claude', name: '', root: '', enabled: true }

function providerLabel(provider: ProviderKey): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex'
}

function sourceDraft(source: HistorySource): SourceDraft {
  return {
    provider: source.provider,
    name: source.name,
    root: source.root,
    enabled: source.enabled,
  }
}

function draftIsComplete(draft: SourceDraft): boolean {
  return Boolean(draft.name.trim() && draft.root.trim())
}

export default function HistorySourceManager({
  sources,
  disabled,
  onSave,
  onTest,
  onRemove,
}: {
  sources: HistorySource[]
  disabled?: boolean
  onSave: (source: HistorySourceInput, sourceId?: string) => Promise<void>
  onTest: (source: HistorySourceInput) => Promise<HistorySourceTestResult>
  onRemove: (sourceId: string) => Promise<void>
}) {
  const [draft, setDraft] = useState<SourceDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null)
  const [result, setResult] = useState<{ tone: SourceStatusTone; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removeCandidate, setRemoveCandidate] = useState<HistorySource | null>(null)

  const editable = sources.filter((source) => source.kind === 'configured')

  function updateDraft(patch: Partial<SourceDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setResult(null)
    setError(null)
  }

  function resetForm() {
    setDraft(emptyDraft)
    setEditingId(null)
    setResult(null)
    setError(null)
  }

  async function testDraft() {
    if (!draftIsComplete(draft)) {
      setError('名前と絶対フォルダパスを入力してから接続を確認してください。')
      return
    }
    setBusy('test')
    setError(null)
    try {
      setResult(sourceTestCopy(await onTest(draft)))
    } catch (caught) {
      setError(`接続を確認できませんでした。${caught instanceof Error ? caught.message : ''}`)
    } finally {
      setBusy(null)
    }
  }

  async function saveDraft() {
    if (!draftIsComplete(draft)) {
      setError('名前と絶対フォルダパスを入力してください。')
      return
    }
    setBusy('save')
    setError(null)
    try {
      await onSave(draft, editingId ?? undefined)
      setResult({
        tone: 'ready',
        text: editingId ? '読み取り元を更新しました。' : '読み取り元を追加しました。',
      })
      setDraft(emptyDraft)
      setEditingId(null)
    } catch (caught) {
      setError(`保存できませんでした。${caught instanceof Error ? caught.message : ''}`)
    } finally {
      setBusy(null)
    }
  }

  async function removeSource() {
    if (!removeCandidate) return
    setBusy('remove')
    setError(null)
    try {
      await onRemove(removeCandidate.id)
      setResult({ tone: 'ready', text: '読み取り元を削除しました。' })
      setRemoveCandidate(null)
      if (editingId === removeCandidate.id) resetForm()
    } catch (caught) {
      setError(`削除できませんでした。${caught instanceof Error ? caught.message : ''}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="history-source-manager" aria-labelledby="history-sources-heading">
      <div className="history-source-heading">
        <div>
          <h4 id="history-sources-heading">読み取り元を管理</h4>
          <p>この画面だけで、ローカル・マウント済み・共有フォルダの絶対パスを確認できます。</p>
        </div>
      </div>
      <p className="history-source-hint">
        走査中は履歴JSONL全体が、指定した共有フォルダからこのPCへ読み取られます。本文やコードは抽出・保存・表示・外部送信しません。
      </p>

      <ul className="history-source-list" aria-label="設定済みの読み取り元">
        {sources.map((source) => {
          const status = sourceAvailabilityCopy(source)
          return (
            <li
              key={source.id}
              className={source.kind === 'default' ? 'source-default' : undefined}
            >
              <div className="history-source-copy">
                <strong>{source.name || providerLabel(source.provider)}</strong>
                <small>{providerLabel(source.provider)}</small>
                <code>{source.root}</code>
                <p className={`history-source-status ${status.tone}`} role="status">
                  {status.text}
                </p>
              </div>
              {source.kind === 'default' ? (
                <small className="source-default-note">既定の読み取り元</small>
              ) : (
                <div className="history-source-actions">
                  <button
                    className="text-button"
                    disabled={disabled || busy !== null}
                    aria-label={`${source.name}を編集`}
                    onClick={() => {
                      setDraft(sourceDraft(source))
                      setEditingId(source.id)
                      setResult(null)
                      setError(null)
                    }}
                  >
                    編集
                  </button>
                  <button
                    className="text-button danger"
                    disabled={disabled || busy !== null}
                    aria-label={`${source.name}を削除`}
                    onClick={() => setRemoveCandidate(source)}
                  >
                    削除
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {removeCandidate && (
        <div className="history-source-remove" role="alert">
          <strong>「{removeCandidate.name}」を削除しますか？</strong>
          <p>
            この読み取り元の取り込み済み集計も削除されます。元の履歴ファイルは変更・削除しません。
          </p>
          <div className="history-source-actions">
            <button
              className="secondary-button"
              disabled={busy === 'remove'}
              onClick={() => setRemoveCandidate(null)}
            >
              キャンセル
            </button>
            <button className="danger-button" disabled={busy === 'remove'} onClick={removeSource}>
              {busy === 'remove' ? '削除中…' : '取り込み分を削除する'}
            </button>
          </div>
        </div>
      )}

      <form
        className="history-source-form"
        onSubmit={(event) => {
          event.preventDefault()
          void saveDraft()
        }}
      >
        <h5>{editingId ? '読み取り元を編集' : '読み取り元を追加'}</h5>
        <label>
          <span>AIサービス</span>
          <select
            value={draft.provider}
            disabled={disabled || busy !== null || editingId !== null}
            onChange={(event) => updateDraft({ provider: event.target.value as ProviderKey })}
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <label>
          <span>表示名</span>
          <input
            value={draft.name}
            disabled={disabled || busy !== null}
            placeholder="例：経理用NAS"
            onChange={(event) => updateDraft({ name: event.target.value })}
          />
        </label>
        <label className="history-source-root">
          <span>絶対フォルダパス</span>
          <input
            value={draft.root}
            disabled={disabled || busy !== null}
            placeholder="例：\\\\server\\share\\.claude\\projects"
            spellCheck={false}
            onChange={(event) => updateDraft({ root: event.target.value })}
          />
        </label>
        <label className="source-enabled">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={disabled || busy !== null}
            onChange={(event) => updateDraft({ enabled: event.target.checked })}
          />
          この読み取り元を走査する
        </label>
        <div className="history-source-actions history-source-form-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || busy !== null}
            onClick={() => void testDraft()}
          >
            {busy === 'test' ? '接続を確認中…' : '接続を確認'}
          </button>
          <button type="submit" className="primary-button" disabled={disabled || busy !== null}>
            {busy === 'save' ? '保存中…' : editingId ? '更新する' : '追加する'}
          </button>
          {editingId && (
            <button
              type="button"
              className="text-button"
              disabled={busy !== null}
              onClick={resetForm}
            >
              編集をやめる
            </button>
          )}
        </div>
      </form>

      {result && (
        <p className={`history-source-result ${result.tone}`} role="status" aria-live="polite">
          {result.text}
        </p>
      )}
      {error && (
        <p className="history-source-result warning" role="alert">
          {error}
        </p>
      )}
      {editable.length === 0 && (
        <p className="history-source-hint">
          既定の読み取り元は自動で使われます。必要なときだけ追加してください。
        </p>
      )}
    </section>
  )
}
