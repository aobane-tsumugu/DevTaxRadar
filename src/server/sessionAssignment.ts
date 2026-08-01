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
 * Picks the rule in effect when the session started. Overlapping rules are
 * resolved deterministically so the same input always yields the same
 * allocation: a provider-specific rule wins, then the later start date, then
 * the lexicographically smaller id.
 */
export function resolveSessionAssignment(
  session: { projectKey: string; provider: UsageProvider; startedAt: string },
  rules: ProjectRuleRecord[],
  timeZone: string = resolvedTimeZone(),
): SessionAssignment {
  const day = localDateFromTimestamp(session.startedAt, timeZone)
  if (!day) return unassigned

  const candidates = rules.filter((rule) =>
    rule.projectKey === session.projectKey &&
    (!rule.provider || rule.provider === session.provider) &&
    rule.effectiveFrom <= day &&
    (!rule.effectiveTo || rule.effectiveTo >= day),
  )
  if (candidates.length === 0) return unassigned

  const [winner] = candidates.sort((left, right) => {
    const specificity = Number(Boolean(right.provider)) - Number(Boolean(left.provider))
    if (specificity !== 0) return specificity
    if (left.effectiveFrom !== right.effectiveFrom) {
      return left.effectiveFrom < right.effectiveFrom ? 1 : -1
    }
    return left.id < right.id ? -1 : 1
  })

  return {
    taxUnitId: winner!.taxUnitId ?? null,
    classification: winner!.classification,
    ruleId: winner!.id,
  }
}
