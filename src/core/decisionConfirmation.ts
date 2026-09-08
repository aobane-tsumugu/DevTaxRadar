import type { DecisionRecord } from '../planning/types.js'
export const MANUAL_DECISION_VERSION = 'manual-decision/1'
export function decisionIsConfirmed(decision: DecisionRecord): boolean {
  const created = Date.parse(decision.createdAt)
  const confirmed = Date.parse(decision.confirmedAt ?? '')
  return (
    decision.status !== 'pending' &&
    Boolean(decision.selectedCandidate?.trim()) &&
    Boolean(decision.reason?.trim()) &&
    Number.isFinite(created) &&
    Number.isFinite(confirmed) &&
    confirmed >= created
  )
}
export function reviseDecision(
  decision: DecisionRecord,
  patch: Partial<
    Pick<DecisionRecord, 'candidate' | 'selectedCandidate' | 'reason' | 'taxUnitId' | 'taxYear'>
  >,
): DecisionRecord {
  return {
    ...decision,
    ...patch,
    engineVersion: MANUAL_DECISION_VERSION,
    status: 'pending',
    confirmedAt: undefined,
  }
}
