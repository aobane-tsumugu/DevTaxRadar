import { useState } from 'react'
import { mergeWorkspaceDrafts } from '../../core/workspaceMerge'
import { WORKSPACE_ATTEMPT_LIMIT } from '../../planning/workspaceLimits'
import WorkspaceValue from './WorkspaceValue'
import {
  decodeWorkspaceAttempt,
  listWorkspaceAttempts,
  removeWorkspaceAttempt,
  type WorkspaceAttempt,
} from '../workspaceAttempt'
export default function WorkspaceAttemptPanel({
  datasetId,
  disabled,
  onRetry,
}: {
  datasetId: string
  disabled: boolean
  onRetry: (record: WorkspaceAttempt) => Promise<void>
}) {
  const [records, setRecords] = useState<WorkspaceAttempt[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  function inspect() {
    try {
      const result = listWorkspaceAttempts(window.localStorage, datasetId)
      setRecords(result.records)
      setMessage(
        result.unreadable
          ? '読めない保存要求があります。控えは保持しています。'
          : result.records.length
            ? '保存対象を確認してから、同じ要求を再送できます。'
            : '未確認の保存要求はありません。',
      )
    } catch {
      setMessage('ブラウザ内の控えを読み込めません。ファイル控えは下から読み込めます。')
    }
  }
  return (
    <details aria-label="料金と計画の保存要求の復旧">
      <summary>前回の料金・計画の保存を確認する</summary>
      <p>
        通信が途切れた場合の送信控えです。再送は保存済みならその結果を確認し、別の保存が進んでいれば比較へ戻ります。編集中の画面を閉じてから操作してください。控えの削除では保存済みの料金・計画は消えません。
      </p>
      <button disabled={busy || disabled} onClick={inspect}>
        料金・計画の保存要求を確認
      </button>
      <label>
        個人用の送信控えファイルを読み込む
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy || disabled}
          onChange={async (event) => {
            const input = event.currentTarget
            const file = input.files?.[0]
            if (!file) return
            setBusy(true)
            try {
              if (file.size > WORKSPACE_ATTEMPT_LIMIT) throw new Error('控えファイルが大きすぎます。')
              const record = decodeWorkspaceAttempt(await file.text())
              if (record.datasetId !== datasetId)
                throw new Error('別のデータセットの控えです。この資料へは再送できません。')
              const existing = records.find((row) => row.request.requestId === record.request.requestId)
              if (
                existing &&
                JSON.stringify([existing.base, existing.request]) !== JSON.stringify([record.base, record.request])
              )
                throw new Error('同じ要求IDで内容の異なる控えがあります。送信せず確認してください。')
              setRecords([record, ...records.filter((row) => row.request.requestId !== record.request.requestId)])
              setMessage('ファイル控えを読み込みました。まだ送信していません。対象と変更内容を確認してください。')
            } catch (error) {
              setMessage(error instanceof Error ? error.message : '控えファイルを読み込めませんでした。')
            } finally {
              input.value = ''
              setBusy(false)
            }
          }}
        />
      </label>
      <p>
        ファイル控えは料金・計画と自由記述を含む個人用です。第三者へ渡す相談資料とは異なります。読込みだけでは保存せず、元ファイルも削除しません。
      </p>
      {message && <p role="status">{message}</p>}
      {records.map((record) => (
        <article key={record.request.requestId}>
          <p>
            {record.createdAt} / 保存元の版 {record.base.revision} / 要求ID{' '}
            {record.request.requestId}
          </p>
          <p>
            対象年 {record.request.planning.profile.taxYear}
            年。以下は保存元から送信時までの変更で、現在の保存内容との差分ではありません。
          </p>
          <AttemptChanges record={record} />
          <details>
            <summary>照合用の送信データを表示</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(record.request, null, 2)}
            </pre>
          </details>
          <button
            disabled={busy || disabled}
            onClick={() => {
              try {
                removeWorkspaceAttempt(window.localStorage, record)
                setRecords((current) => current.filter((row) => row.request.requestId !== record.request.requestId))
                setMessage('ブラウザの控えと一覧から取り除きました。端末上のファイル控えは削除していません。')
              } catch (error) {
                setMessage(error instanceof Error ? error.message : '控えを削除できませんでした。')
              }
            }}
          >
            この送信控えだけを削除
          </button>
          <button
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true)
              try {
                await onRetry(record)
                setRecords((current) => current.filter((row) => row.request.requestId !== record.request.requestId))
                setMessage('保存結果を確認しました。端末上のファイル控えは必要に応じてご自身で整理してください。')
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : '保存結果を確認できませんでした。',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            この料金・計画の保存を再確認する
          </button>
        </article>
      ))}
    </details>
  )
}

function AttemptChanges({ record }: { record: WorkspaceAttempt }) {
  try {
    const { changes } = mergeWorkspaceDrafts(record.base, record.request, record.base)
    return changes.length ? (
      <details>
        <summary>送信した変更を確認（{changes.length}件）</summary>
        {changes.map((row) => (
          <section key={row.key}>
            <h3>{row.label}</h3>
            <h4>保存元の内容</h4>
            <WorkspaceValue
              value={row.base}
              field={row.key.startsWith('charges:') ? 'amountJpy' : row.key}
            />
            <h4>送信した内容</h4>
            <WorkspaceValue
              value={row.local}
              field={row.key.startsWith('charges:') ? 'amountJpy' : row.key}
            />
          </section>
        ))}
      </details>
    ) : (
      <p>保存元から料金・計画の変更はありません。保存結果の確認はできます。</p>
    )
  } catch {
    return (
      <p role="alert">
        変更内容を比較できません。照合用の送信データを確認してください。控えは保持しています。
      </p>
    )
  }
}
