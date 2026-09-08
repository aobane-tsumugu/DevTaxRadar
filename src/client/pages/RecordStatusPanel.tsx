import type { PlanningSnapshot } from '../../planning/types'
import { assessCostPresence } from '../../planning/costPresence'

export default function RecordStatusPanel({
  planning,
  sessionCount,
  onEdit,
}: {
  planning: PlanningSnapshot
  sessionCount: number
  onEdit: () => void
}) {
  const presence = assessCostPresence(planning, planning.costPresence ?? [])
  const records = [
    ['制作物', planning.taxUnits.length],
    ['設備', planning.equipment.length],
    ['自宅費用', planning.homeCosts.length],
    ['直接費', planning.directCosts.length],
    ['根拠資料の参照', planning.evidence.length],
  ] as const
  return (
    <section className="panel" aria-label="保存資料の登録状況">
      <h2>説明に使う資料の登録状況</h2>
      <p>
        登録の有無を示します。登録済みでも、内容の確認や税務上の扱いが確定したことにはなりません。
      </p>
      <dl className="cost-totals">
        <div>
          <dt>AI履歴</dt>
          <dd>{sessionCount > 0 ? `取込済み ${sessionCount}件` : '取込済みの履歴なし'}</dd>
        </div>
        {records.map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count > 0 ? `登録あり ${count}件` : '未登録'}</dd>
          </div>
        ))}
      </dl>
      <h3>{planning.profile.taxYear}年の費用項目確認</h3>
      <dl className="cost-totals">
        {presence.map((row) => (
          <div key={row.category}>
            <dt>{row.label}の年度確認</dt>
            <dd>
              {
                {
                  unreviewed: '未確認',
                  'has-records': '対象記録あり',
                  'not-applicable': '該当なし（本人記録）',
                  deferred: '保留',
                  conflict: '不一致',
                }[row.status]
              }
            </dd>
            <dd>
              {row.explanation}
              {row.declaration &&
                ` 理由: ${row.declaration.reason} / 記録日時: ${row.declaration.recordedAt}`}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        履歴の取得範囲や原本の内容は別途確認が必要です。未登録の項目は「該当なし」と確認した状態ではありません。
      </p>
      <button className="text-button" onClick={onEdit}>
        登録内容を確認・編集
      </button>
    </section>
  )
}
