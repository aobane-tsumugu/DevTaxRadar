import { useState } from 'react'
import { mergeWorkspaceDrafts } from '../../core/workspaceMerge'
import WorkspaceValue from './WorkspaceValue'
import {
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
      setMessage('保存要求の控えを読み込めませんでした。')
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
                inspect()
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
                inspect()
                setMessage('保存結果を確認しました。')
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
