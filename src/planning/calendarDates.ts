import type { PlanningSnapshot } from './types.js'
import { validIsoCalendarDate } from '../core/chargePeriods.js'

export type PlanningDateIssue = {
  path: (string | number)[]
  label: string
  value: string
  optional: boolean
}
export function planningDateIssues(snapshot: PlanningSnapshot): PlanningDateIssue[] {
  const issues: PlanningDateIssue[] = []
  function check(
    value: string | undefined,
    path: (string | number)[],
    label: string,
    optional = false,
  ) {
    if (value !== undefined && !validIsoCalendarDate(value))
      issues.push({ path, label, value, optional })
  }
  check(snapshot.profile.activityStartedOn, ['profile', 'activityStartedOn'], '活動の開始日', true)
  snapshot.equipment.forEach((item, index) => {
    for (const [field, label] of [
      ['orderedOn', '注文日'],
      ['deliveredOn', '納品日'],
      ['acquiredOn', '取得日'],
      ['businessUseStartedOn', '業務利用開始日'],
    ] as const)
      check(
        item[field],
        ['equipment', index, field],
        `${item.name} / ${label}`,
        field !== 'acquiredOn',
      )
  })
  snapshot.projectRules.forEach((item, index) => {
    check(
      item.effectiveFrom,
      ['projectRules', index, 'effectiveFrom'],
      `割当 ${item.projectKey} / 開始日`,
    )
    check(
      item.effectiveTo,
      ['projectRules', index, 'effectiveTo'],
      `割当 ${item.projectKey} / 終了日`,
      true,
    )
  })
  snapshot.lifecycleEvents.forEach((item, index) =>
    check(item.occurredOn, ['lifecycleEvents', index, 'occurredOn'], `出来事 ${item.id} / 発生日`),
  )
  snapshot.directCosts.forEach((item, index) =>
    check(item.incurredOn, ['directCosts', index, 'incurredOn'], `直接費 ${item.id} / 発生日`),
  )
  snapshot.evidence.forEach((item, index) =>
    check(item.occurredOn, ['evidence', index, 'occurredOn'], `根拠資料 ${item.id} / 発生日`, true),
  )
  return issues
}

/** Only repairs a currently invalid field; all other draft input is preserved. */
export function repairPlanningDate(
  snapshot: PlanningSnapshot,
  issue: PlanningDateIssue,
  value: string,
): PlanningSnapshot {
  const current = planningDateIssues(snapshot).find(
    (row) => JSON.stringify(row.path) === JSON.stringify(issue.path) && row.value === issue.value,
  )
  if (!current || (!validIsoCalendarDate(value) && !(value === '' && current.optional)))
    return snapshot
  const next = structuredClone(snapshot)
  let parent = next as unknown as Record<string | number, unknown>
  for (const key of current.path.slice(0, -1))
    parent = parent[key] as Record<string | number, unknown>
  const field = current.path[current.path.length - 1]!
  if (value === '') delete parent[field]
  else parent[field] = value
  return next
}
