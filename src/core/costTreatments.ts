import { buildCostMethodComparisons } from './costMethodConnection.js'
import type { AnnualMethodComparison } from './annualMethodComparison.js'
import type { AnnualCostProjection } from '../accounting/costs.js'
import type { PlanningSnapshot } from '../planning/types.js'
import type { TaxCandidate, TaxDecision } from './types.js'
import { decideTaxCandidate } from './taxDecision.js'
import {
  canonicalTreatmentValue, validateCostTreatmentFacts, type CostTreatmentFacts,
} from './costTreatmentFacts.js'

type Contribution = AnnualCostProjection['contributions'][number]
export type CostTreatmentItem = {
  contributionId: string
  basisId: string
  sourceIds: string[]
  taxUnitId?: string
  label: string
  amountJpy: number
  factsId?: string
  status: 'conditional' | 'needs-facts' | 'stale' | 'excluded' | 'allocation-needed' | 'unsupported'
  candidate: TaxCandidate
  currentYearExpenseJpy: number | null
  futureCostJpy: number | null
  reasons: string[]
  missingFacts: string[]
  appliedRuleIds: string[]
}
export type CostTreatmentProjection = {
  methodComparisons?: AnnualMethodComparison[]
  version: 1
  engineVersion: 'cost-treatment/1'
  year: number
  taxTreatmentVerified: false
  automaticPosting: false
  items: CostTreatmentItem[]
  unknownBases: { basisId: string; reasons: string[]; taxUnitIds: string[] }[]
  orphanFactIds: string[]
  totals: {
    currentYearExpenseCandidateJpy: number
    futureCostCandidateJpy: number
    unresolvedKnownJpy: number
    excludedJpy: number
  }
}
const unique = <T>(values: T[]): T[] => [...new Set(values)]
const compareId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const yen = (value: number) => Number.isSafeInteger(value) && value >= 0

/** Bind the selected terminal cost and its ancestors, not a total or decoded opaque ID. */
export function costTreatmentBasis(
  costs: AnnualCostProjection, planning: PlanningSnapshot, contributionId: string,
  selectedEvidenceIds: readonly string[] = [],
): string {
  const one = <T extends { id: string }>(values: T[], id: string): T => {
    const found = values.filter((row) => row.id === id)
    if (found.length !== 1) throw new Error('費用の参照を一意に確認できません。')
    return found[0]!
  }
  const cost = one(costs.contributions, contributionId)
  if (cost.consumedByBasisId) throw new Error('組入れ済みの中間原価は選択できません。')
  const bases = new Map<string, AnnualCostProjection['bases'][number]>()
  const contributions = new Map<string, Contribution>()
  const sources = new Map<string, AnnualCostProjection['sources'][number]>()
  const visiting = new Set<string>()
  function visit(row: Contribution) {
    if (visiting.has(row.id)) throw new Error('費用参照が循環しています。')
    if (contributions.has(row.id)) return
    visiting.add(row.id)
    const basis = one(costs.bases, row.basisId)
    bases.set(basis.id, basis)
    if (basis.sourceId) sources.set(basis.sourceId, one(costs.sources, basis.sourceId))
    for (const sourceId of row.sourceIds) sources.set(sourceId, one(costs.sources, sourceId))
    for (const parentId of basis.parentContributionIds) visit(one(costs.contributions, parentId))
    visiting.delete(row.id)
    contributions.set(row.id, row)
  }
  visit(cost)
  const taxUnitId = cost.target.kind === 'tax-unit' ? cost.target.taxUnitId : undefined
  const unit = taxUnitId ? one(planning.taxUnits, taxUnitId) : undefined
  const events = planning.lifecycleEvents.filter((row) => row.taxUnitId === taxUnitId &&
    row.occurredOn <= `${costs.year}-12-31`).sort(compareId)
  const relevantEvidence = unique([
    ...selectedEvidenceIds,
    ...[...sources.values()].flatMap((row) => [...row.evidenceIds,
      ...(row.adjustments ?? []).flatMap((adjustment) => adjustment.evidenceIds)]),
    ...[...contributions.values()].flatMap((row) => row.evidenceIds),
    ...events.flatMap((row) => row.evidenceIds),
  ]).sort()
  const evidence = relevantEvidence.map((id) => {
    const rows = planning.evidence.filter((row) => row.id === id)
    if (rows.length > 1) throw new Error('証拠の参照が重複しています。')
    if (!rows.length) return { id, missing: true }
    const { localReference: _private, ...record } = rows[0]!
    return record
  })
  return canonicalTreatmentValue({
    version: 1, year: costs.year, contributionId,
    bases: [...bases.values()].sort(compareId),
    contributions: [...contributions.values()].sort(compareId),
    sources: [...sources.values()].sort(compareId),
    // Do not bind the current, undated lifecycleStatus as evidence of a historical year.
    unit: unit ? { id: unit.id, unitType: unit.unitType, usageMode: unit.usageMode,
      revenueModel: unit.revenueModel, predecessorId: unit.predecessorId,
      sameAsExternalVersion: unit.sameAsExternalVersion } : null,
    events, evidence,
  })
}

/** Draft facts never infer a purpose, service date, or tax method from names. */
export function newCostTreatmentFacts(
  costs: AnnualCostProjection, planning: PlanningSnapshot, contributionId: string,
  id: string, recordedAt: string,
): CostTreatmentFacts {
  const record: CostTreatmentFacts = {
    id, contributionId, costYear: costs.year,
    costBasis: costTreatmentBasis(costs, planning, contributionId), recordedAt,
    workPurpose: 'unknown', placedInService: 'unknown', assetKind: 'unknown',
    directlyAttributable: null, serviceProvidedInCurrentPeriod: null, paidByYearEnd: null,
    workInProgressAtPeriodEnd: null, liabilityFixedAtYearEnd: null, reason: '', evidenceIds: [],
  }
  validateCostTreatmentFacts([record])
  return record
}

/** All figures start from final allocations; private-use ratios must not be applied twice. */
export function projectCostTreatments(
  costs: AnnualCostProjection, planning: PlanningSnapshot,
): CostTreatmentProjection {
  validateCostTreatmentFacts(planning.costTreatmentFacts ?? [])
  if (!costs.invariantSatisfied || !Number.isInteger(costs.year) || costs.year < 1900 || costs.year > 9999)
    throw new Error('費用資料の年または整合性を確認できません。')
  for (const records of [costs.sources, costs.bases, costs.contributions])
    if (new Set(records.map((row) => row.id)).size !== records.length)
      throw new Error('費用資料の参照IDが重複しています。')
  const facts = (planning.costTreatmentFacts ?? []).filter((row) => row.costYear === costs.year)
  const used = new Set<string>()
  const items = costs.contributions.filter((row) => !row.consumedByBasisId).map((row): CostTreatmentItem => {
    if (!yen(row.amountJpy)) throw new Error('費用配分は安全な整数円である必要があります。')
    const basis = costs.bases.find((b) => b.id === row.basisId)
    if (!basis || basis.amount.status !== 'known' || !yen(basis.amount.amountJpy) || !row.sourceIds.length)
      throw new Error('費用配分の基礎または出典を確認できません。')
    const sources = row.sourceIds.map((id) => costs.sources.find((source) => source.id === id))
    if (new Set(row.sourceIds).size !== row.sourceIds.length || sources.some((source) => !source)) throw new Error('元費用の参照が欠けています。')
    const item: CostTreatmentItem = {
      contributionId: row.id, basisId: row.basisId, sourceIds: [...row.sourceIds],
      ...(row.target.kind === 'tax-unit' ? { taxUnitId: row.target.taxUnitId } : {}),
      label: [sources.map((source) => source!.label).join(' + '),
        row.target.kind === 'tax-unit'
          ? planning.taxUnits.find((unit) => row.target.kind === 'tax-unit' && unit.id === row.target.taxUnitId)?.name ?? row.target.taxUnitId
          : { general: '通常業務', private: '私用', unallocated: '未配分', unobserved: '捕捉外', rounding: '端数' }[row.target.kind],
        basis.period.startedOn + '〜' + basis.period.endedOn].join(' / '), amountJpy: row.amountJpy,
      status: 'needs-facts', candidate: 'unclassified', currentYearExpenseJpy: null, futureCostJpy: null,
      reasons: [], missingFacts: [], appliedRuleIds: [],
    }
    const fact = facts.find((value) => value.contributionId === row.id)
    if (fact) { used.add(fact.id); item.factsId = fact.id }
    if (row.target.kind === 'private') return { ...item, status: 'excluded', candidate: 'private-use',
      currentYearExpenseJpy: 0, futureCostJpy: 0, reasons: ['配分済みの私用額です。業務額へ戻しません。'] }
    if (!['tax-unit', 'general'].includes(row.target.kind)) return { ...item, status: 'allocation-needed',
      missingFacts: ['未配分・捕捉外・端数は、特定の処理候補へ自動配分しません。'] }
    if (!fact) return { ...item, missingFacts: ['この費用配分の作業実態と対象年の処理条件'] }
    const currentBasis = costTreatmentBasis(costs, planning, row.id, fact.evidenceIds)
    if (fact.costBasis !== currentBasis) return { ...item, status: 'stale',
      missingFacts: ['金額・期間・方法・対応先・根拠が確認元から変わっています。結び直してください。'] }
    if (sources.some((source) => source!.kind === 'opening-balance'))
      return { ...item, status: 'unsupported', missingFacts: ['旧版残高は新しい費用にせず、既存の振替へ対応させてください。'] }
    const missing = [...item.missingFacts]
    if (!fact.reason.trim()) missing.push('登録した作業実態の理由')
    if (!fact.evidenceIds.length) missing.push('処理条件に対応する根拠参照')
    const evidenceIds = unique([...fact.evidenceIds, ...row.evidenceIds,
      ...sources.flatMap((source) => source!.evidenceIds)])
    if (evidenceIds.some((id) => !planning.evidence.some((e) => e.id === id)))
      missing.push('存在する根拠参照')
    // A period-wide condition cannot override an explicit in-period lifecycle transition.
    if (row.target.kind === 'tax-unit') {
      const unit = planning.taxUnits.find((u) => row.target.kind === 'tax-unit' && u.id === row.target.taxUnitId)
      const events = planning.lifecycleEvents.filter((e) => e.taxUnitId === unit?.id)
      if (events.some((e) => ['retired', 'abandoned'].includes(e.eventType) && e.occurredOn <= basis.period.endedOn))
        missing.push('終了・中止の事実と、費用対象期間・継続作業との対応')
      if (unit?.usageMode === 'internal') {
        const dates = events.filter((e) => e.eventType === 'internal-use-started').map((e) => e.occurredOn).sort()
        const start = dates[0]
        if (start && start > basis.period.startedOn && start <= basis.period.endedOn)
          missing.push('供用開始をまたぐ費用期間の区分（全額へ同じ扱いを適用しません）')
        else if (start && ((fact.placedInService === 'before' && start <= basis.period.startedOn) ||
            (fact.placedInService === 'after' && start > basis.period.endedOn)))
          missing.push('登録済みの実際の供用開始日と作業時点の状態の不一致')
      }
    }
    const privatePurpose = ['hobby', 'private-research', 'general-learning'].includes(fact.workPurpose)
    if (privatePurpose) return { ...item, status: 'needs-facts',
      missingFacts: ['業務へ配分した額と私用の作業実態が矛盾しています。先に配分を見直してください。'] }
    if (fact.serviceProvidedInCurrentPeriod === null) missing.push('対象年末までのサービス提供状況')
    if (fact.workPurpose === 'sales-production' && fact.directlyAttributable !== true)
      missing.push('販売物への直接対応')
    if (fact.workPurpose === 'new-development' && fact.assetKind !== 'software')
      missing.push('製作する対象がソフトウエアであること')
    // The existing decision tree is reused; no thresholds or depreciation method are guessed.
    const decision: TaxDecision = decideTaxCandidate({
      amountJpy: row.amountJpy, businessUse: 'business', workPurpose: fact.workPurpose,
      placedInService: fact.placedInService,
      ...(fact.directlyAttributable === null ? {} : { directlyAttributable: fact.directlyAttributable }),
      ...(fact.serviceProvidedInCurrentPeriod === null ? {} : { serviceProvidedInCurrentPeriod: fact.serviceProvidedInCurrentPeriod }),
      ...(fact.workInProgressAtPeriodEnd === null ? {} : { workInProgressAtPeriodEnd: fact.workInProgressAtPeriodEnd }),
      userConfirmed: false,
    })
    if (['software-acquisition-cost', 'production-cost', 'capital-expenditure'].includes(decision.candidate) &&
        row.target.kind !== 'tax-unit') missing.push('製作・改良の対象となる制作物への配分')
    if (decision.candidate === 'prepaid-expense' && fact.paidByYearEnd !== true)
      missing.push('対象年末までに実際に支払済みであること（未履行の債務だけでは前払にしません）')
    if (decision.candidate === 'ordinary-expense' && fact.liabilityFixedAtYearEnd !== true)
      missing.push('当年の債務確定（減価償却等は別の方法確認が必要）')
    if (decision.candidate === 'ordinary-expense' && sources.some((source) => source!.kind === 'equipment'))
      missing.push('設備年額の配賦先での費用認識条件（この候補層では確定しません）')
    if (decision.candidate === 'prepaid-expense' && sources.some((source) => source!.kind === 'equipment'))
      missing.push('設備の購入・償却を未提供サービスとして処理できません')
    const missingFacts = unique([...missing, ...decision.missingFacts])
    const calculated = missingFacts.length === 0 && decision.estimateStatus === 'estimated'
    return { ...item, status: calculated ? 'conditional' : 'needs-facts', candidate: decision.candidate,
      currentYearExpenseJpy: calculated ? decision.currentYearExpenseEstimate : null,
      futureCostJpy: calculated ? decision.futureBalanceEstimate : null,
      reasons: [...decision.reasons, fact.reason, '登録した条件の候補です。採用済みの費用・残高へ自動記帳しません。'],
      missingFacts, appliedRuleIds: [...decision.appliedRuleIds] }
  })
  const total = { currentYearExpenseCandidateJpy: 0n, futureCostCandidateJpy: 0n,
    unresolvedKnownJpy: 0n, excludedJpy: 0n }
  for (const item of items) {
    if (item.status === 'excluded') total.excludedJpy += BigInt(item.amountJpy)
    else if (item.status === 'conditional') {
      if (item.currentYearExpenseJpy === null || item.futureCostJpy === null ||
          !yen(item.currentYearExpenseJpy) || !yen(item.futureCostJpy) ||
          BigInt(item.currentYearExpenseJpy) + BigInt(item.futureCostJpy) !== BigInt(item.amountJpy))
        throw new Error('処理候補の金額保存則が成立しません。')
      total.currentYearExpenseCandidateJpy += BigInt(item.currentYearExpenseJpy)
      total.futureCostCandidateJpy += BigInt(item.futureCostJpy)
    } else total.unresolvedKnownJpy += BigInt(item.amountJpy)
  }
  if (!yen(costs.totals.knownBasisJpy) || Object.values(total).reduce((a, b) => a + b, 0n) !== BigInt(costs.totals.knownBasisJpy))
    throw new Error('処理候補の対象額が費用基礎と一致しません。')
  if (Object.values(total).some((value) => value > BigInt(Number.MAX_SAFE_INTEGER)))
    throw new Error('処理候補の合計が安全な整数円を超えています。')
  return {
    ...(facts.some((fact) => fact.methodComparison) ? { methodComparisons: buildCostMethodComparisons(costs, planning, costTreatmentBasis, items) } : {}),
    version: 1, engineVersion: 'cost-treatment/1', year: costs.year,
    taxTreatmentVerified: false, automaticPosting: false, items,
    unknownBases: costs.bases.filter((basis) => basis.amount.status === 'unknown').map((basis) => ({
      basisId: basis.id, reasons: basis.amount.status === 'unknown' ? [...basis.amount.reasons] : [],
      taxUnitIds: [...basis.affectedTaxUnitIds],
    })),
    orphanFactIds: facts.filter((fact) => !used.has(fact.id)).map((fact) => fact.id),
    totals: {
      currentYearExpenseCandidateJpy: Number(total.currentYearExpenseCandidateJpy),
      futureCostCandidateJpy: Number(total.futureCostCandidateJpy),
      unresolvedKnownJpy: Number(total.unresolvedKnownJpy), excludedJpy: Number(total.excludedJpy),
    },
  }
}

/** Keep old/no-fact years byte-compatible: never add a derived layer just because code was upgraded. */
export function attachCostTreatments(
  costs: AnnualCostProjection, planning: PlanningSnapshot,
): AnnualCostProjection {
  if (!(planning.costTreatmentFacts ?? []).some((fact) => fact.costYear === costs.year)) return costs
  return { ...costs, treatments: projectCostTreatments(costs, planning) }
}
