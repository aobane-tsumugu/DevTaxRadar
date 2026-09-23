import { localDateFromTimestamp, resolvedTimeZone } from '../adapters/localTime.ts'
import type { UsageProvider } from '../adapters/types.ts'
import type { ProjectRuleRecord } from '../planning/types.js'

export type SessionAssignment = {
  taxUnitId: string | null
  classification: ProjectRuleRecord['classification']
  ruleId: string | null
}

const unassigned: SessionAssignment = {
  taxUnitId: null,
  classification: 'unclassified',
  ruleId: null,
}

/**
 * Resolve reported usage instants, or an interval only when one effective rule
 * covers its entire span. No start-date guess when the purpose changed within
 * an old monthly aggregate. Provider-specific, latest-start, lexical-ID order
 * is retained for overlapping rules.
 */
export function resolveSessionAssignment(
  session: {
    projectKey: string
    provider: UsageProvider
    startedAt: string
    endedAt?: string
    timePrecision?: 'instant' | 'interval' | 'unknown'
  },
  rules: ProjectRuleRecord[],
  timeZone: string = resolvedTimeZone(),
): SessionAssignment {
  if (session.timePrecision === 'unknown') return unassigned
  const day = localDateFromTimestamp(session.startedAt, timeZone)
  const end =
    session.endedAt === undefined ? day : localDateFromTimestamp(session.endedAt, timeZone)
  if (!day || !end || end < day) return unassigned
  const relevant = rules.filter(
    (rule) =>
      rule.projectKey === session.projectKey &&
      (!rule.provider || rule.provider === session.provider),
  )
  function at(date: string): SessionAssignment {
    const [winner] = relevant
      .filter(
        (rule) => rule.effectiveFrom <= date && (!rule.effectiveTo || rule.effectiveTo >= date),
      )
      .sort((left, right) => {
        const specificity = Number(Boolean(right.provider)) - Number(Boolean(left.provider))
        if (specificity !== 0) return specificity
        if (left.effectiveFrom !== right.effectiveFrom)
          return left.effectiveFrom < right.effectiveFrom ? 1 : -1
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      })
    return winner
      ? {
          taxUnitId: winner.taxUnitId ?? null,
          classification: winner.classification,
          ruleId: winner.id,
        }
      : unassigned
  }
  const first = at(day)
  if (end === day) return first
  const boundaries = new Set([end])
  for (const rule of relevant) {
    if (day < rule.effectiveFrom && rule.effectiveFrom <= end) boundaries.add(rule.effectiveFrom)
    if (rule.effectiveTo && day <= rule.effectiveTo && rule.effectiveTo < end) {
      const after = new Date(rule.effectiveTo + 'T00:00:00.000Z')
      after.setUTCDate(after.getUTCDate() + 1)
      boundaries.add(after.toISOString().slice(0, 10))
    }
  }
  return [...boundaries].every((date) => JSON.stringify(at(date)) === JSON.stringify(first))
    ? first
    : unassigned
}
