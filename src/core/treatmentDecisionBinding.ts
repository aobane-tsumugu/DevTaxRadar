import type { DecisionRecord, PlanningSnapshot } from '../planning/types.js'
import type { AnnualCostProjection } from '../accounting/costs.js'
import { canonicalTreatmentValue } from './costTreatmentFacts.js'
import { projectCostTreatments } from './costTreatments.js'
export type TreatmentDecisionBinding = {
  costYear: number
  contributionId: string
  factsId: string
  /** Exact canonical evidence, not a checksum claimed to be a third-party signature. */
  basis: string
}
export function validateTreatmentDecisionBinding(value: unknown): asserts value is TreatmentDecisionBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('候補元の対応が不正です。')
  const b = value as TreatmentDecisionBinding
  if (Object.keys(b).sort().join(',') !== 'basis,contributionId,costYear,factsId' ||
      !Number.isInteger(b.costYear) || b.costYear < 2000 || b.costYear > 2100 ||
      typeof b.contributionId !== 'string' || !b.contributionId.trim() || b.contributionId.length > 500 ||
      typeof b.factsId !== 'string' || !b.factsId.trim() || b.factsId.length > 120 ||
      typeof b.basis !== 'string' || !b.basis || b.basis.length > 4 * 1024 * 1024)
    throw new Error('候補元の年・配分・条件・確認元を確認してください。')
  let parsed: unknown
  try { parsed = JSON.parse(b.basis) } catch { throw new Error('候補元の確認記録が不正です。') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || canonicalTreatmentValue(parsed) !== b.basis)
    throw new Error('候補元の確認記録は正規化した資料である必要があります。')
}
export function treatmentDecisionBasis(costs: AnnualCostProjection, planning: PlanningSnapshot, id: string) {
  const report = projectCostTreatments(costs, planning)
  const item = report.items.find((row) => row.contributionId === id)
  const fact = (planning.costTreatmentFacts ?? []).find((row) => row.id === item?.factsId)
  if (!item || item.status !== 'conditional' || !item.taxUnitId || !fact)
    throw new Error('条件付き金額と対象制作物がそろった候補だけを判断案へ取り込めます。')
  const binding: TreatmentDecisionBinding = {
    costYear: costs.year, contributionId: id, factsId: fact.id,
    basis: canonicalTreatmentValue({ version: 1, item, fact }),
  }
  validateTreatmentDecisionBinding(binding)
  return { item, binding }
}
export function treatmentDecisionBindingMatches(
  decision: DecisionRecord, costs: AnnualCostProjection, planning: PlanningSnapshot,
): boolean {
  if (!decision.treatmentBinding) return true
  try {
    validateTreatmentDecisionBinding(decision.treatmentBinding)
    const { item, binding } = treatmentDecisionBasis(costs, planning, decision.treatmentBinding.contributionId)
    return decision.taxYear === costs.year && decision.taxUnitId === item.taxUnitId &&
      decision.selectedCandidate === item.candidate &&
      canonicalTreatmentValue(binding) === canonicalTreatmentValue(decision.treatmentBinding)
  } catch { return false }
}
