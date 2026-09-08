import { useState } from 'react'
import type { PlanningSnapshot } from '../../planning/types'
import {
  planningDateIssues,
  repairPlanningDate,
  type PlanningDateIssue,
} from '../../planning/calendarDates'
import { validIsoCalendarDate } from '../../core/chargePeriods'
import DateInput from './DateInput'

function RepairRow({
  issue,
  onRepair,
}: {
  issue: PlanningDateIssue
  onRepair: (value: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <li>
      <p>
        <strong>{issue.label}</strong>：元の値 <code>{issue.value}</code>
      </p>
      <label>
        {issue.label}の修正日
        <DateInput value={value} onValueChange={setValue} />
      </label>
      <button type="button" disabled={!validIsoCalendarDate(value)} onClick={() => onRepair(value)}>
        この日付を編集内容に反映
      </button>
      {issue.optional && (
        <button type="button" onClick={() => onRepair('')}>
          日付を未入力に戻す
        </button>
      )}
    </li>
  )
}

export default function PlanningDateRepairPanel({
  planning,
  onChange,
}: {
  planning: PlanningSnapshot
  onChange: (next: PlanningSnapshot) => void
}) {
  const issues = planningDateIssues(planning)
  if (!issues.length) return null
  return (
    <section aria-label="日付の修正が必要な記録" className="onboarding-section">
      <h3>日付の修正が必要な記録</h3>
      <p>
        実在しない日付が{issues.length}
        件あります。元の値を確認して修正してください。反映後に「ここまで保存」で保存します。必須の日付は空欄へ置き換えません。
      </p>
      <ul>
        {issues.map((issue) => (
          <RepairRow
            key={JSON.stringify([issue.path, issue.value])}
            issue={issue}
            onRepair={(value) => onChange(repairPlanningDate(planning, issue, value))}
          />
        ))}
      </ul>
    </section>
  )
}
