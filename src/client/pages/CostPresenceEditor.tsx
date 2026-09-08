import { useId } from 'react'
import type { PlanningSnapshot } from '../../planning/types'
import {
  assessCostPresence,
  costPresenceRecordsSchema,
  type CostPresenceRecord,
} from '../../planning/costPresence'

const categories = { equipment: '設備', home: '自宅費用', direct: '直接費' } as const
export default function CostPresenceEditor({
  planning,
  onChange,
}: {
  planning: PlanningSnapshot
  onChange: (records: CostPresenceRecord[]) => void
}) {
  const prefix = useId(),
    year = planning.profile.taxYear
  const records = planning.costPresence ?? []
  const validYear = Number.isInteger(year) && year >= 2000 && year <= 2100
  const parsed = costPresenceRecordsSchema.safeParse(records)
  const assessed = validYear && parsed.success ? assessCostPresence(planning, parsed.data) : []
  if (!validYear)
    return <p role="alert">年度別の確認を記録するには、対象年を2000〜2100年で入力してください。</p>
  const update = (category: CostPresenceRecord['category'], status: string, reason: string) => {
    const existing = records.find((row) => row.taxYear === year && row.category === category)
    const others = records.filter((row) => row.taxYear !== year || row.category !== category)
    onChange(
      status === 'unreviewed'
        ? others
        : [
            ...others,
            {
              id: existing?.id ?? crypto.randomUUID(),
              taxYear: year,
              category,
              status: status as CostPresenceRecord['status'],
              reason,
              recordedAt: new Date().toISOString(),
            },
          ],
    )
  }
  return (
    <section className="panel" aria-label="年度別の費用項目確認">
      <h4>{year}年の費用項目を確認する</h4>
      <p>
        登録がない項目についても、該当なし・保留とその理由を記録できます。本人の記録であり、税務条件の確認完了ではありません。費用は消えず、翌年度へ自動継承しません。
      </p>
      {(Object.keys(categories) as CostPresenceRecord['category'][]).map((category) => {
        const row = records.find((item) => item.taxYear === year && item.category === category)
        const state = assessed.find((item) => item.category === category)
        const id = `${prefix}-${category}`
        return (
          <fieldset key={category} style={{ minWidth: 0, marginBlock: 16 }}>
            <legend>{categories[category]}</legend>
            <label htmlFor={id} style={{ display: 'block', marginBlock: 8 }}>
              確認状態
            </label>
            <select
              id={id}
              aria-label={`${categories[category]}の確認状態`}
              value={row?.status ?? 'unreviewed'}
              style={{ fontSize: 16, minHeight: 44, width: '100%', maxWidth: '100%' }}
              onChange={(event) => update(category, event.target.value, row?.reason ?? '')}
            >
              <option value="unreviewed">確認記録なし</option>
              <option value="not-applicable">該当なし（この年度の本人記録）</option>
              <option value="deferred">保留</option>
            </select>
            {row && (
              <>
                <label htmlFor={`${id}-reason`} style={{ display: 'block', marginBlock: 8 }}>
                  理由（保存に必要）
                </label>
                <textarea
                  id={`${id}-reason`}
                  aria-label={`${categories[category]}の確認理由`}
                  value={row.reason}
                  maxLength={2000}
                  style={{ fontSize: 16, width: '100%', boxSizing: 'border-box' }}
                  onChange={(event) => update(category, row.status, event.target.value)}
                />
                {!row.reason.trim() && (
                  <p>理由を入力してください。空欄のままでは保存できません。</p>
                )}
                <p>記録日時: {row.recordedAt}</p>
              </>
            )}
            {state && (
              <p
                role={state.status === 'conflict' ? 'alert' : undefined}
                style={{ overflowWrap: 'anywhere' }}
              >
                {state.status === 'conflict' ? '不一致: ' : ''}
                {state.explanation}
                {state.recordIds.length > 0 && ` 対象記録: ${state.recordIds.join('、')}`}
              </p>
            )}
          </fieldset>
        )
      })}
      <p>
        「確認記録なし」へ戻すと、その年度・項目の確認だけを取り除きます。費用・設備の登録は保持します。変更は計画と一緒に保存します。
      </p>
    </section>
  )
}
