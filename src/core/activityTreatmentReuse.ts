import { activeUnitLinks } from '../planning/activityFacts.js'
import type { AnnualCostProjection } from '../accounting/costs.js'
import type { PlanningSnapshot } from '../planning/types.js'
import type { ActivityFact } from '../planning/activityFacts.js'
import { canonicalTreatmentValue, type CostTreatmentFacts } from './costTreatmentFacts.js'
import { costTreatmentBasis } from './costTreatments.js'

/** Only a reviewed purpose covering the full exact cost period can be proposed. */
export function applicableActivityFacts(
  costs: AnnualCostProjection,
  planning: PlanningSnapshot,
  target: CostTreatmentFacts,
): ActivityFact[] {
  const contribution = costs.contributions.find(
    (row) => row.id === target.contributionId && !row.consumedByBasisId,
  )
  const period = costs.bases.find((row) => row.id === contribution?.basisId)?.period
  if (
    !contribution ||
    contribution.target.kind !== 'tax-unit' ||
    !period ||
    target.costYear !== costs.year
  )
    return []
  const unitId = contribution.target.taxUnitId
  const ledger = planning.activityLedger
  if (!ledger) return []
  const productId = activeUnitLinks(ledger).find((link) => link.taxUnitId === unitId)?.productId
  const active = ledger.facts.filter(
    (row) => !ledger.facts.some((next) => next.correctsId === row.id),
  )
  return active.filter(
    (fact) =>
      fact.productId === productId &&
      fact.taxUnitId === unitId &&
      fact.state === 'confirmed' &&
      fact.purpose !== 'unknown' &&
      fact.time.kind === 'period' &&
      fact.time.startedOn <= period.startedOn &&
      fact.time.endedOn !== undefined &&
      fact.time.endedOn >= period.endedOn &&
      !active.some(
        (other) =>
          other.id !== fact.id &&
          other.productId === productId &&
          (!other.taxUnitId || other.taxUnitId === unitId) &&
          (other.state === 'conflicted' ||
            (other.state === 'confirmed' && other.purpose !== fact.purpose)) &&
          (other.time.kind === 'unknown' || other.time.kind === 'date'
            ? other.time.kind === 'unknown' ||
              (other.time.occurredOn >= period.startedOn && other.time.occurredOn <= period.endedOn)
            : other.time.startedOn <= period.endedOn &&
              (!other.time.endedOn || other.time.endedOn >= period.startedOn)),
      ),
  )
}
export function proposeActivityTreatmentFacts(
  costs: AnnualCostProjection,
  planning: PlanningSnapshot,
  target: CostTreatmentFacts,
  fact: ActivityFact,
): CostTreatmentFacts {
  if (
    !applicableActivityFacts(costs, planning, target).some(
      (row) => canonicalTreatmentValue(row) === canonicalTreatmentValue(fact),
    )
  )
    throw new Error('対象・全期間・本人確認・矛盾のない活動事実だけを使用できます。')
  const evidenceIds = [...new Set([...target.evidenceIds, ...fact.evidenceIds])]
  if (evidenceIds.length > 100) throw new Error('証拠は100件までです。')
  return {
    ...structuredClone(target),
    workPurpose: fact.purpose,
    reason: `活動事実 ${fact.id}: ${fact.reason}`.slice(0, 2000),
    evidenceIds,
    costBasis:
      target.costBasis ===
      costTreatmentBasis(costs, planning, target.contributionId, target.evidenceIds)
        ? costTreatmentBasis(costs, planning, target.contributionId, evidenceIds)
        : target.costBasis,
  }
}
