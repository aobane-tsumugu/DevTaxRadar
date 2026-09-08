import type { EvidenceRecord } from '../../planning/types'
import { recordedTime } from '../recordedTime'

export type EvidenceExplanation = Pick<
  EvidenceRecord,
  'id' | 'note' | 'occurredOn' | 'recordedAt' | 'strength'
>

export default function EvidenceReferences({
  ids,
  records,
}: {
  ids: readonly string[]
  records?: readonly EvidenceExplanation[]
}) {
  if (!ids.length) return <p>根拠の参照は未登録です。</p>
  return (
    <details>
      <summary>対応する根拠を確認（{ids.length}件）</summary>
      <ul>
        {[...new Set(ids)].map((id) => {
          const matches = records?.filter((row) => row.id === id)
          const record = matches?.length === 1 ? matches[0] : undefined
          return (
            <li key={id}>
              {record ? (
                <>
                  <p>{record.note || '根拠の説明が未入力です。'}</p>
                  <p>
                    出所：
                    {
                      {
                        automatic: '自動取得した記録',
                        external: '外部の資料',
                        'self-recorded': '本人が記録した内容',
                      }[record.strength]
                    }
                  </p>
                  <p>
                    資料の対象日：{record.occurredOn ?? '未記録'} / 記録日時：
                    {recordedTime(record.recordedAt)}
                  </p>
                </>
              ) : (
                <p>
                  {records === undefined
                    ? 'この表示には根拠の説明が未収録です。'
                    : matches!.length > 1
                      ? '同じ参照IDの記録が複数あり、根拠を特定できません。'
                      : '対応する根拠の記録がありません。'}
                </p>
              )}
              <small>参照ID：{id}</small>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
