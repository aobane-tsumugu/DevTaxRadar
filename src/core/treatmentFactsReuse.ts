import type { AnnualCostProjection } from '../accounting/costs.js'
import type { PlanningSnapshot } from '../planning/types.js'
import { canonicalTreatmentValue, type CostTreatmentFacts } from './costTreatmentFacts.js'

/** Reuse common facts as an editable proposal, never the prior amount, claim or confirmation. */
export function proposeCommonTreatmentFacts(
  costs: AnnualCostProjection, planning: PlanningSnapshot,
  target: CostTreatmentFacts, source: CostTreatmentFacts,
): CostTreatmentFacts {
  const stored = (planning.costTreatmentFacts ?? []).find((row) => row.id === source.id)
  if (!stored || canonicalTreatmentValue(stored) !== canonicalTreatmentValue(source))
    throw new Error('参照する保存済み条件が変わっています。読み直してください。')
  if (target.costYear !== costs.year || source.costYear > costs.year || source.id === target.id)
    throw new Error('同じ対象の過去の条件を選択してください。未来の条件は流用しません。')
  const destination = costs.contributions.find((row) => row.id === target.contributionId)
  const period = costs.bases.find((row) => row.id === destination?.basisId)?.period
  if (!destination || destination.consumedByBasisId || destination.target.kind !== 'tax-unit' || !period)
    throw new Error('制作物へ対応する現在の最終配分が必要です。')
  const basis = JSON.parse(source.costBasis) as {
    year?: number; contributions?: AnnualCostProjection['contributions']; bases?: AnnualCostProjection['bases'];
    evidence?: PlanningSnapshot['evidence']; unit?: { id: string; unitType?: string; usageMode?: string }
  }
  const original = basis.contributions?.find((row) => row.id === source.contributionId)
  const originalPeriod = basis.bases?.find((row) => row.id === original?.basisId)?.period
  const unit = planning.taxUnits.find((row) => destination.target.kind === 'tax-unit' && row.id === destination.target.taxUnitId)
  if (!unit || original?.target.kind !== 'tax-unit' || original.target.taxUnitId !== unit.id ||
      basis.unit?.id !== unit.id || basis.unit.unitType !== unit.unitType || basis.unit.usageMode !== unit.usageMode ||
      basis.year !== source.costYear || !originalPeriod || originalPeriod.endedOn > period.startedOn)
    throw new Error('別の制作物・用途・将来期間の条件を流用しません。')
  if (planning.lifecycleEvents.some((row) => row.taxUnitId === unit.id &&
      ['internal-use-started', 'improvement-started', 'retired', 'abandoned'].includes(row.eventType) &&
      row.occurredOn > originalPeriod.endedOn && row.occurredOn <= period.endedOn))
    throw new Error('前の条件以後に供用・改良・終了の出来事があります。この期間の実態を確認してください。')
  for (const id of source.evidenceIds) {
    const then = basis.evidence?.find((row) => row.id === id)
    const now = planning.evidence.find((row) => row.id === id)
    if (!then || !now) throw new Error('共通条件の根拠が欠けています。')
    const { localReference: _private, ...current } = now
    if (canonicalTreatmentValue(then) !== canonicalTreatmentValue(current))
      throw new Error('共通条件の根拠内容が変わっています。先に確認してください。')
  }
  let placedInService: CostTreatmentFacts['placedInService'] = 'unknown'
  const starts = planning.lifecycleEvents.filter((row) => row.taxUnitId === unit.id && row.eventType === 'internal-use-started')
  if (unit.usageMode === 'internal' && starts.length === 1) {
    const date = starts[0]!.occurredOn
    if (date <= period.startedOn) placedInService = 'after'
    else if (date > period.endedOn) placedInService = 'before'
  }
  return {
    ...structuredClone(target), workPurpose: source.workPurpose, assetKind: source.assetKind,
    directlyAttributable: source.directlyAttributable, reason: source.reason,
    evidenceIds: [...source.evidenceIds], placedInService,
    // Payment, performance, year-end state, liability, methods and the destination seal stay separate.
  }
}

export function reusableTreatmentFacts(costs: AnnualCostProjection, planning: PlanningSnapshot, target: CostTreatmentFacts): CostTreatmentFacts[] {
  return (planning.costTreatmentFacts ?? []).filter((source) => {
    try { proposeCommonTreatmentFacts(costs, planning, target, source); return source.workPurpose !== 'unknown' }
    catch { return false }
  })
}
