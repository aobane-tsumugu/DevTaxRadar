import { useState } from 'react'
import { chargeContractBasis, type ProviderChargePeriod } from '../../core/chargePeriods'
import type { ChargeUsageScope, ChargeUsageSelector } from '../../core/contractUsage'
import { getFolders, getHistorySources, getSessions } from '../api'
import type { FolderSummary, HistorySource, SessionSummary } from '../types'

export default function ChargeUsageEditor({
  period,
  index,
  onChange,
}: {
  period: ProviderChargePeriod
  index: number
  onChange: (period: ProviderChargePeriod) => void
}) {
  const [sources, setSources] = useState<HistorySource[]>([])
  const [folders, setFolders] = useState<FolderSummary[]>([])
  const [sessions, setSessions] = useState<Record<string, SessionSummary[]>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const scope = period.contractConfirmation?.usageScope
  const sourceOptions = sources.filter((source) => source.provider === period.provider)
  function update(value: ChargeUsageScope | undefined) {
    onChange({
      ...period,
      contractConfirmation: {
        reference: '',
        reason: '',
        basis: chargeContractBasis(period),
        ...period.contractConfirmation,
        usageScope: value,
      },
    })
  }
  function selector(at: number, value: ChargeUsageSelector) {
    if (!scope) return
    update({
      ...scope,
      selectors: scope.selectors.map((row, position) => (position === at ? value : row)),
    })
  }
  async function load() {
    setBusy(true)
    try {
      const [sourceResult, folderResult] = await Promise.all([getHistorySources(), getFolders()])
      setSources(sourceResult.sources)
      setFolders(folderResult.folders)
      setMessage('取得済みの履歴を読み込みました。原本の会話本文や認証情報は使用しません。')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : '履歴の一覧を読み込めませんでした。編集中の設定は保持しています。',
      )
    } finally {
      setBusy(false)
    }
  }
  async function loadSessions(projectKey: string) {
    if (!projectKey || sessions[projectKey]) return
    try {
      const result = await getSessions(projectKey)
      setSessions((current) => ({ ...current, [projectKey]: result.sessions }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '会話の一覧を読み込めませんでした。')
    }
  }
  return (
    <details>
      <summary>請求{index + 1}の履歴範囲・捕捉外割合</summary>
      <p>
        単一契約では既存の取得範囲を利用できます。複数契約が重なる場合は、各契約で使った取得元・フォルダ・会話を選びます。同じPC内の別契約も分けられます。
      </p>
      <label>
        <input
          type="checkbox"
          checked={Boolean(scope)}
          onChange={(event) =>
            update(
              event.target.checked
                ? { kind: 'all', selectors: [], unobservedRatio: null, reason: '' }
                : undefined,
            )
          }
        />
        この請求の契約・利用期間に固有の範囲を指定する
      </label>
      {scope && (
        <fieldset>
          <legend>請求{index + 1}の配分基準</legend>
          <label>
            使用した履歴
            <select
              value={scope.kind}
              onChange={(event) =>
                update({ ...scope, kind: event.target.value as ChargeUsageScope['kind'] })
              }
            >
              <option value="all">このサービスの全取得記録</option>
              <option value="selected">取得元・フォルダ・会話を選択</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void load()}>
            {busy ? '一覧を読込中' : '取得元とフォルダの一覧を読む'}
          </button>
          {message && <p role="status">{message}</p>}
          {scope.kind === 'selected' && (
            <>
              {scope.selectors.map((row, at) => {
                const availableFolders = folders.filter(
                  (folder) =>
                    folder.providers.includes(period.provider) &&
                    folder.sources.some((source) => source.id === row.sourceId),
                )
                const availableSessions = (sessions[row.projectKey ?? ''] ?? []).filter(
                  (session) =>
                    session.sourceId === row.sourceId && session.provider === period.provider,
                )
                const label = `請求${index + 1} 範囲${at + 1}`
                return (
                  <fieldset key={at}>
                    <legend>履歴範囲 {at + 1}</legend>
                    <label>
                      取得元
                      <select
                        aria-label={`${label} 取得元`}
                        value={row.sourceId}
                        onChange={(event) => selector(at, { sourceId: event.target.value })}
                      >
                        {!sourceOptions.some((source) => source.id === row.sourceId) && (
                          <option value={row.sourceId}>保存済みの取得元</option>
                        )}
                        {sourceOptions.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.name}
                            {source.enabled ? '' : '（現在停止中）'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      フォルダ
                      <select
                        aria-label={`${label} フォルダ`}
                        value={row.projectKey ?? ''}
                        onChange={(event) => {
                          const projectKey = event.target.value || undefined
                          selector(at, { ...row, projectKey, sessionKey: undefined })
                          if (projectKey) void loadSessions(projectKey)
                        }}
                      >
                        <option value="">この取得元の全フォルダ</option>
                        {row.projectKey &&
                          !availableFolders.some(
                            (folder) => folder.projectKey === row.projectKey,
                          ) && <option value={row.projectKey}>保存済みのフォルダ</option>}
                        {availableFolders.map((folder) => (
                          <option key={folder.projectKey} value={folder.projectKey}>
                            {folder.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {row.projectKey && (
                      <label>
                        会話
                        <select
                          aria-label={`${label} 会話`}
                          value={row.sessionKey ?? ''}
                          onFocus={() => void loadSessions(row.projectKey!)}
                          onChange={(event) =>
                            selector(at, { ...row, sessionKey: event.target.value || undefined })
                          }
                        >
                          <option value="">このフォルダの全会話</option>
                          {row.sessionKey &&
                            !availableSessions.some(
                              (session) => session.sessionKey === row.sessionKey,
                            ) && <option value={row.sessionKey}>保存済みの会話</option>}
                          {availableSessions
                            .filter(
                              (session, position, values) =>
                                values.findIndex(
                                  (value) => value.sessionKey === session.sessionKey,
                                ) === position,
                            )
                            .map((session) => (
                              <option key={session.sessionKey} value={session.sessionKey}>
                                {session.startedAt.slice(0, 10)} / {session.messageCount}件 /{' '}
                                {session.sessionKey.slice(-6)}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <label>
                      範囲の開始日（省略時は請求の開始日）
                      <input
                        type="date"
                        aria-label={`${label} 開始日`}
                        value={row.startedOn ?? ''}
                        onChange={(event) =>
                          selector(at, { ...row, startedOn: event.target.value || undefined })
                        }
                      />
                    </label>
                    <label>
                      範囲の終了日（省略時は請求の終了日）
                      <input
                        type="date"
                        aria-label={`${label} 終了日`}
                        value={row.endedOn ?? ''}
                        onChange={(event) =>
                          selector(at, { ...row, endedOn: event.target.value || undefined })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          ...scope,
                          selectors: scope.selectors.filter((_, position) => position !== at),
                        })
                      }
                    >
                      この範囲を外す
                    </button>
                  </fieldset>
                )
              })}
              <button
                type="button"
                disabled={sourceOptions.length === 0}
                onClick={() =>
                  update({
                    ...scope,
                    selectors: [...scope.selectors, { sourceId: sourceOptions[0]!.id }],
                  })
                }
              >
                履歴範囲を追加
              </button>
              {scope.selectors.length === 0 && (
                <p>未選択のまま保存できます。その場合、原額は配分未算定として残ります。</p>
              )}
            </>
          )}
          <label>
            この契約・期間で履歴にない利用の割合（%、空欄は不明）
            <input
              type="number"
              min="0"
              max="95"
              step="0.1"
              aria-label={`請求${index + 1} 捕捉外割合`}
              value={scope.unobservedRatio === null ? '' : scope.unobservedRatio * 100}
              onChange={(event) =>
                update({
                  ...scope,
                  unobservedRatio:
                    event.target.value === '' ? null : Number(event.target.value) / 100,
                })
              }
            />
          </label>
          <p>
            0は捕捉外の利用がないという入力です。不明を0に置き換えません。取得元の停止や過去値の使用は、取得状態として別に残します。
          </p>
          <label>
            履歴範囲・割合の根拠
            <textarea
              maxLength={2000}
              value={scope.reason}
              onChange={(event) => update({ ...scope, reason: event.target.value })}
            />
          </label>
          {sourceOptions.length > 1 && (
            <label>
              <input
                type="checkbox"
                checked={sourceOptions.every((source) =>
                  scope.independentSourceIds?.includes(source.id),
                )}
                onChange={(event) =>
                  update({
                    ...scope,
                    independentSourceIds: event.target.checked
                      ? sourceOptions.map((source) => source.id)
                      : undefined,
                  })
                }
              />
              一覧の取得元は互いのコピーではなく、独立した利用である（
              {sourceOptions.map((source) => source.name).join('、')}）
            </label>
          )}
          <p>
            コピーの履歴がある場合は、正本の取得元だけを選択してください。この画面は履歴そのものを削除しません。利用時点が分からない集計を、選択した日付で機械的に日割りすることもありません。
          </p>
        </fieldset>
      )}
    </details>
  )
}
