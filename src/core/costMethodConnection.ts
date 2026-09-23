import type { AnnualCostProjection } from '../accounting/costs.js'
import type { PlanningSnapshot } from '../planning/types.js'
import { canonicalTreatmentValue, type CostTreatmentFacts } from './costTreatmentFacts.js'
import {
  compareAnnualMethods,
  validateAnnualMethodFacts,
  type AnnualMethodComparison,
  type AnnualMethodFacts,
} from './annualMethodComparison.js'

export type TreatmentBasisReader = (
  costs: AnnualCostProjection,
  planning: PlanningSnapshot,
  id: string,
  evidenceIds?: readonly string[],
) => string

/** A scope seal binds every selected allocation and supporting record, not just a sum. */
export function methodComparisonScope(
  costs: AnnualCostProjection,
  planning: PlanningSnapshot,
  fact: CostTreatmentFacts,
  readBasis: TreatmentBasisReader,
): string {
  const method = fact.methodComparison
  if (!method) throw new Error('方法比較の対象を指定してください。')
  validateAnnualMethodFacts(method)
  const ids = [...method.contributionIds].sort()
  if (fact.costYear !== costs.year || !ids.includes(fact.contributionId))
    throw new Error('処理条件と比較対象の年・代表配分が一致しません。')
  const records = ids.map((id) => JSON.parse(readBasis(costs, planning, id, fact.evidenceIds)))
  const equipmentSources = new Set(
    method.assetKind === 'tangible-equipment'
      ? ids.flatMap((id) => costs.contributions.find((row) => row.id === id)?.sourceIds ?? [])
      : [],
  )
  const equipment = planning.equipment
    .filter((row) => equipmentSources.has('equipment:' + row.id))
    .map((row) => ({
      record: row,
      annual: (planning.equipmentMethods ?? [])
        .filter((annual) => annual.equipmentId === row.id && annual.taxYear === costs.year)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    }))
    .sort((a, b) => (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0))
  return canonicalTreatmentValue({
    version: 1,
    year: costs.year,
    assetKind: method.assetKind,
    records,
    ...(equipmentSources.size ? { equipment } : {}),
  })
}
export function newAnnualMethodFacts(costYear: number, contributionId: string): AnnualMethodFacts {
  return {
    assetKind: 'unknown',
    contributionIds: [contributionId],
    scopeBasis: '',
    completeCostConfirmed: null,
    businessOnly: null,
    acquiredOn: null,
    usedOn: null,
    usefulLifeYears: null,
    taxpayer: 'unknown',
    ordinaryConditions: null,
    rentalUse: 'unknown',
    throughYear: Math.min(costYear + 10, 2151),
    eligibleSmallBusiness: null,
    annualSpecialUsedJpy: null,
    businessMonths: null,
    statementReady: null,
    roundingConfirmed: null,
    reason: '',
  }
}

export function buildCostMethodComparisons(
  costs: AnnualCostProjection,
  planning: PlanningSnapshot,
  readBasis: TreatmentBasisReader,
  checkedItems: readonly { contributionId: string; status: string; candidate: string }[],
): AnnualMethodComparison[] {
  const records = (planning.costTreatmentFacts ?? []).filter(
    (f) => f.costYear === costs.year && f.methodComparison,
  )
  const claimed = new Map<string, number>()
  for (const record of records)
    for (const id of record.methodComparison!.contributionIds)
      claimed.set(id, (claimed.get(id) ?? 0) + 1)
  return records.map((fact): AnnualMethodComparison => {
    const method = fact.methodComparison!
    const pending = (
      status: 'stale' | 'missing-facts' | 'unsupported',
      reason: string,
    ): AnnualMethodComparison => ({
      engineVersion: 'annual-method-comparison/1',
      ownerFactsId: fact.id,
      year: costs.year,
      amountJpy: null,
      basisMeaning: 'whole-asset-before-business-allocation',
      status,
      reasons: [reason],
      scenarios: [],
      sourceUrls: [],
      automaticPosting: false,
      taxTreatmentVerified: false,
    })
    if (method.contributionIds.some((id) => claimed.get(id)! > 1))
      return pending(
        'unsupported',
        '同じ配分が複数の資産比較へ含まれています。一つの比較へ整理してください。',
      )
    try {
      if (
        !method.scopeBasis ||
        method.scopeBasis !== methodComparisonScope(costs, planning, fact, readBasis)
      )
        return pending(
          'stale',
          '資産比較に含めた原価・根拠が変わりました。全体の範囲を確認し直してください。',
        )
      const selected = method.contributionIds.map((id) =>
        costs.contributions.find((row) => row.id === id)!,
      )
      if (selected.some((row) => row.consumedByBasisId || row.target.kind !== 'tax-unit'))
        return pending('unsupported', '中間原価・私用・配分待ちを資産の取得原価へ仮定しません。')
      const unitIds = new Set(
        selected.map((row) => (row.target.kind === 'tax-unit' ? row.target.taxUnitId : '')),
      )
      if (unitIds.size !== 1)
        return pending('unsupported', '異なる制作物・資産の原価を一つの資産へ合算しません。')
      const sources = [...new Set(selected.flatMap((row) => row.sourceIds))].map((id) =>
        costs.sources.find((row) => row.id === id)!,
      )
      let amount: number | null = null
      let priorClosing: { taxYear: number; amountJpy: number; reference: string } | undefined
      if (method.assetKind === 'tangible-equipment') {
        if (sources.length !== 1 || sources[0]?.kind !== 'equipment')
          return pending(
            'unsupported',
            '有形設備は一つの設備原額から比較してください。異なる設備を合算しません。',
          )
        // Thresholds use the purchase amount before annual depreciation and private/business allocation.
        amount = sources[0].originalAmountJpy
        const equipmentRecords = planning.equipment.filter(
          (row) => 'equipment:' + row.id === sources[0].id,
        )
        if (equipmentRecords.length !== 1)
          return pending('missing-facts', '比較する設備の保存記録を一意に確認できません。')
        const equipment = equipmentRecords[0]!
        const annualRecords = (planning.equipmentMethods ?? []).filter(
          (row) => row.equipmentId === equipment.id && row.taxYear === costs.year,
        )
        if (annualRecords.length > 1)
          return pending(
            'missing-facts',
            '設備の年度条件が重複しています。方法を選び直してください。',
          )
        const annual = annualRecords[0]
        if (equipment.acquisitionCostJpy !== amount || equipment.acquiredOn !== method.acquiredOn)
          return pending('stale', '設備の保存済み取得額・取得日と比較条件が一致しません。')
        if (equipment.businessUseStartedOn && equipment.businessUseStartedOn !== method.usedOn)
          return pending('stale', '設備の保存済み供用日と比較条件の供用日が一致しません。')
        if (
          equipment.convertedFromPrivate ||
          annual?.ordinaryTreatment === 'special-or-adjusted' ||
          annual?.useThroughYearEnd === 'ended-or-interrupted' ||
          annual?.taxpayer === 'corporation' ||
          annual?.assetKind === 'intangible'
        )
          return pending(
            'unsupported',
            '保存された設備の転用・特殊調整・中断・対象区分を通常の比較条件で上書きしません。',
          )
        const businessRatio = annual?.allocation
          ? annual.allocation.businessUseRatio
          : equipment.businessUseRatio
        if (businessRatio !== 1)
          return pending(
            'missing-facts',
            '保存された設備の業務割合が100%と確認されていません。業務専用の比較額へ補完しません。',
          )
        const life = annual ? annual.usefulLifeYears : equipment.usefulLifeYears
        if (life != null && life !== method.usefulLifeYears)
          return pending('stale', '設備の保存済み耐用年数と比較条件が一致しません。')
        if (annual?.priorClosing) priorClosing = annual.priorClosing
        if (sources[0].adjustments?.length)
          return pending(
            'unsupported',
            '設備の返金・訂正は元額を単純減算せず個別に確認してください。',
          )
        if (sources[0].acquiredOn && sources[0].acquiredOn !== method.acquiredOn)
          return pending('stale', '設備の取得日と比較条件の取得日が一致しません。')
      } else if (method.assetKind === 'software') {
        if (sources.some((source) => source.kind === 'opening-balance'))
          return pending('unsupported', '旧版残高を新規支払としてソフト取得原価へ合算しません。')
        if (
          costs.bases.some(
            (basis) =>
              basis.amount.status === 'unknown' &&
              basis.affectedTaxUnitIds.some((id) => unitIds.has(id)),
          )
        )
          return pending(
            'missing-facts',
            '対象制作物に未算定の原価があります。既知小計を資産全体額として使いません。',
          )
        const sum = selected.reduce((total, row) => total + BigInt(row.amountJpy), 0n)
        if (sum > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error('資産取得原価が安全な整数円を超えています。')
        amount = Number(sum)
        const factsByCost = new Map(
          (planning.costTreatmentFacts ?? [])
            .filter((f) => f.costYear === costs.year)
            .map((f) => [f.contributionId, f]),
        )
        if (
          selected.some((row) => {
            const f = factsByCost.get(row.id)
            const checked = checkedItems.find((item) => item.contributionId === row.id)
            return (
              !checked ||
              checked.status !== 'conditional' ||
              checked.candidate !== 'software-acquisition-cost' ||
              !f ||
              f.assetKind !== 'software' ||
              f.workPurpose !== 'new-development' ||
              f.placedInService !== 'before' ||
              f.directlyAttributable !== true ||
              f.serviceProvidedInCurrentPeriod !== true ||
              !f.reason.trim() ||
              !f.evidenceIds.length ||
              f.costBasis !== readBasis(costs, planning, row.id, f.evidenceIds)
            )
          })
        )
          return pending(
            'missing-facts',
            '含めたすべての配分について、新規ソフト製作の作業実態・直接対応・根拠を確認してください。',
          )
        if (
          selected.some(
            (row) =>
              costs.bases.find((basis) => basis.id === row.basisId)!.period.endedOn >
              (method.acquiredOn ?? ''),
          )
        )
          return pending(
            'missing-facts',
            '製作完了日より後の原価を含みます。資産の対象範囲と日付を確認してください。',
          )
      }
      return compareAnnualMethods(
        amount,
        method,
        planning.profile,
        fact.id,
        costs.year,
        priorClosing,
      )
    } catch (error) {
      return pending(
        'missing-facts',
        error instanceof Error ? error.message : '資産比較の対象を確認できません。',
      )
    }
  })
}
