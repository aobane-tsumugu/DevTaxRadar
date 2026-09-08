import { useRef, useState } from 'react'
import {
  ApiRequestError,
  getRestoreSources,
  getRuntime,
  saveRestoreSources,
  type RestoreSourcePreview,
} from '../api'

export default function RestoreSourcesPanel({ onComplete }: { onComplete: () => void }) {
  const [view, setView] = useState<RestoreSourcePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [stale, setStale] = useState(false)
  const [done, setDone] = useState(false)
  const [oldInputs, setOldInputs] = useState<RestoreSourcePreview['plan']['sources'] | null>(null)
  const loading = useRef(false)
  async function load() {
    if (loading.current) return
    loading.current = true
    setBusy(true)
    setError('')
    try {
      const next = await getRestoreSources()
      setOldInputs(view ? structuredClone(view.plan.sources) : null)
      setView(next)
      setConfirmed(false)
      setStale(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '読み取り元を取得できません。')
    } finally {
      loading.current = false
      setBusy(false)
    }
  }
  async function save() {
    if (!view || !confirmed || stale || loading.current) return
    loading.current = true
    setBusy(true)
    setError('')
    try {
      const runtime = await getRuntime()
      await saveRestoreSources(runtime.csrfToken, view.plan)
      setDone(true)
      onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '再接続できません。')
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setStale(true)
        setConfirmed(false)
      }
    } finally {
      loading.current = false
      setBusy(false)
    }
  }
  return (
    <section className="panel" aria-label="復元後の履歴再接続">
      <h2>復元した資料と履歴の接続を確認</h2>
      <p>
        元の識別子と保存済みの記録を保持しています。再接続が完了するまで走査を停止します。元と同じ履歴があるフォルダを指定し、接続できない読み取り元は走査対象から外してください。
      </p>
      {error && <p role="alert">{error} 入力は保持しています。</p>}
      {done ? (
        <p role="status">
          再接続を保存しました。この操作では走査していません。月次確認から履歴を確認できます。
        </p>
      ) : (
        <>
          <button disabled={busy} onClick={() => void load()}>
            {view ? '入力を控えて最新の接続情報を読み直す' : '復元した読み取り元を確認'}
          </button>
          {oldInputs && (
            <details>
              <summary>読み直す前の入力の控え</summary>
              <ul>
                {oldInputs.map((row) => (
                  <li key={row.sourceId}>
                    {row.sourceId}：{row.root} ／ {row.enabled ? '走査対象' : '走査しない'}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {view && (
            <fieldset disabled={busy || stale}>
              <legend>復元先の接続先と走査対象</legend>
              {view.plan.sources.map((row, index) => {
                const description = view.descriptions.find((d) => d.sourceId === row.sourceId)
                const change = (update: Partial<typeof row>) => {
                  setView(
                    (current) =>
                      current && {
                        ...current,
                        plan: {
                          ...current.plan,
                          sources: current.plan.sources.map((s, i) =>
                            i === index ? { ...s, ...update } : s,
                          ),
                        },
                      },
                  )
                  setConfirmed(false)
                }
                return (
                  <article key={row.sourceId}>
                    <h3>
                      {description?.name ?? row.sourceId} ／{' '}
                      {description?.provider === 'claude' ? 'Claude Code' : 'Codex'}
                    </h3>
                    <label>
                      履歴フォルダ（{description?.name ?? row.sourceId}）{' '}
                      <input
                        type="text"
                        value={row.root}
                        onChange={(e) => change({ root: e.target.value })}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => change({ enabled: e.target.checked })}
                      />
                      この読み取り元を走査対象にする（{description?.name ?? row.sourceId}）
                    </label>
                    {!row.enabled && <p>元ログを読み直さず、保存済みの数値資料を保持します。</p>}
                  </article>
                )
              })}
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                元と同じ履歴の接続先と、走査しない読み取り元を確認しました
              </label>
              <button disabled={!confirmed} onClick={() => void save()}>
                この接続先を保存して走査保留を解除
              </button>
            </fieldset>
          )}
          {stale && (
            <p role="alert">
              確認中に記録が変わりました。入力の控えを残して最新の接続情報を読み直し、再確認してください。
            </p>
          )}
          <p>
            接続先を変えた元のキャッシュだけを無効化し、数値資料や採用履歴は保持します。保存だけでは走査を始めません。再起動後は通常の自動走査設定に従います。
          </p>
        </>
      )}
    </section>
  )
}
