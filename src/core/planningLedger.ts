import type {
  CostContribution,
  CostTreatment,
  EquipmentRecord,
  PlanningLedger,
  PlanningSnapshot,
  TaxUnitRecord,
} from '../planning/types.js'

function clampRatio(value: number, label: string, warnings: string[]): number {
  if (!Number.isFinite(value)) {
    warnings.push(`${label}が数値ではないため0%として未配賦にしました。`)
    return 0
  }
  if (value < 0 || value > 1) warnings.push(`${label}を0%から100%の範囲へ補正しました。`)
  return Math.min(1, Math.max(0, value))
}

function positiveYen(value: number, label: string, warnings: string[]): number {
  if (!Number.isFinite(value) || value < 0) {
    warnings.push(`${label}が不正なため0円として扱いました。`)
    return 0
  }
  return Math.round(value)
}

function monthsInYear(dateValue: string | undefined, year: number, warnings: string[]): number {
  if (!dateValue) {
    warnings.push('業務利用開始日がないため、取得日を月割開始候補にしました。')
    return -1
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
  if (!match) {
    warnings.push('業務利用開始日の形式を確認してください。')
    return 0
  }
  const startYear = Number(match[1])
  const startMonth = Number(match[2])
  if (startMonth < 1 || startMonth > 12) {
    warnings.push('業務利用開始月を確認してください。')
    return 0
  }
  if (startYear < year) return 12
  if (startYear > year) return 0
  return 13 - startMonth
}

function yearOf(dateValue: string | undefined): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue ?? '')
  if (!match) return undefined
  const month = Number(match[2])
  if (month < 1 || month > 12) return undefined
  return Number(match[1])
}

function contribution(params: {
  sourceType: CostContribution['sourceType']
  sourceId: string
  taxUnitId?: string
  gross: number
  businessRatio: number
  projectRatio: number
  treatment: CostTreatment
  warnings: string[]
  forceUnallocated?: boolean
}): CostContribution {
  const grossAmountJpy = Math.max(0, Math.round(params.gross))
  const businessAmountJpy = Math.round(grossAmountJpy * params.businessRatio)
  const privateAmountJpy = grossAmountJpy - businessAmountJpy
  const canAllocate =
    Boolean(params.taxUnitId) && !params.forceUnallocated && params.treatment !== 'general'
  const allocatedAmountJpy = canAllocate ? Math.round(businessAmountJpy * params.projectRatio) : 0
  const unallocatedAmountJpy = businessAmountJpy - allocatedAmountJpy

  return {
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    taxUnitId: params.taxUnitId,
    grossAmountJpy,
    businessAmountJpy,
    allocatedAmountJpy,
    privateAmountJpy,
    unallocatedAmountJpy,
    treatment: params.treatment,
    warnings: params.warnings,
  }
}

function equipmentContribution(item: EquipmentRecord, year: number): CostContribution {
  const warnings: string[] = []
  const acquisitionCost = positiveYen(item.acquisitionCostJpy, `${item.name}の取得価額`, warnings)
  const missingOpeningBalance =
    item.convertedFromPrivate && item.openingUnamortizedBalanceJpy === undefined
  const base = item.convertedFromPrivate
    ? positiveYen(
        item.openingUnamortizedBalanceJpy ?? acquisitionCost,
        `${item.name}の転用時未償却残高`,
        warnings,
      )
    : acquisitionCost
  const businessRatio = clampRatio(item.businessUseRatio, `${item.name}の業務利用割合`, warnings)
  const projectRatio = clampRatio(
    item.projectAllocationRatio,
    `${item.name}のプロジェクト割合`,
    warnings,
  )

  if (!item.taxUnitId) warnings.push('配賦先の制作物・改良計画が未登録です。')
  if (!item.evidenceIds.length) warnings.push('購入または転用の証拠が未登録です。')
  if (missingOpeningBalance)
    warnings.push('私用からの転用時未償却残高がないため、年額を算定していません。')

  const serviceYear = yearOf(item.businessUseStartedOn)
  if (!item.convertedFromPrivate && acquisitionCost < 100_000 && serviceYear !== undefined) {
    const currentYearAmount = serviceYear === year ? acquisitionCost : 0
    if (serviceYear === year) {
      warnings.push('取得価額10万円未満で対象年に供用したため、全額必要経費候補です。')
    } else if (serviceYear < year) {
      warnings.push(
        '取得価額10万円未満ですが、供用開始は対象年より前です。対象年へ重ねて計上しません。',
      )
    } else {
      warnings.push('取得価額10万円未満ですが、対象年には未供用です。')
    }
    return contribution({
      sourceType: 'equipment',
      sourceId: item.id,
      taxUnitId: item.taxUnitId,
      gross: currentYearAmount,
      businessRatio,
      projectRatio,
      treatment: 'shared',
      warnings,
    })
  }

  if (!item.usefulLifeYears || item.usefulLifeYears <= 0 || missingOpeningBalance) {
    if (!item.usefulLifeYears || item.usefulLifeYears <= 0) {
      warnings.push('耐用年数候補が未確認のため、算定基礎額を未配賦に残しました。')
    }
    return contribution({
      sourceType: 'equipment',
      sourceId: item.id,
      taxUnitId: item.taxUnitId,
      gross: base,
      businessRatio,
      projectRatio,
      treatment: 'shared',
      warnings,
      forceUnallocated: true,
    })
  }

  let months = monthsInYear(item.businessUseStartedOn, year, warnings)
  if (months === -1) months = monthsInYear(item.acquiredOn, year, warnings)
  const annualCandidate = Math.round((base / item.usefulLifeYears) * (months / 12))

  return contribution({
    sourceType: 'equipment',
    sourceId: item.id,
    taxUnitId: item.taxUnitId,
    gross: annualCandidate,
    businessRatio,
    projectRatio,
    treatment: 'shared',
    warnings,
  })
}

function candidateFor(unit: TaxUnitRecord): string {
  if (unit.unitType === 'improvement-plan') return '資本的支出候補'
  if (unit.unitType === 'sales-production') return '制作原価・仕掛品候補'
  return '新規ソフトウェア取得価額候補'
}

/** Build a conservative cost ledger. All uncertain business amounts remain unallocated. */
export function buildPlanningLedger(snapshot: PlanningSnapshot): PlanningLedger {
  const year = snapshot.profile.taxYear
  const contributions: CostContribution[] = snapshot.equipment.map((item) =>
    equipmentContribution(item, year),
  )

  for (const item of snapshot.homeCosts.filter((cost) => cost.month.startsWith(`${year}-`))) {
    const warnings: string[] = []
    const gross = positiveYen(item.amountJpy, `${item.month} ${item.category}の金額`, warnings)
    const businessRatio = clampRatio(
      item.businessUseRatio,
      `${item.month} ${item.category}の業務利用割合`,
      warnings,
    )
    const projectRatio = clampRatio(
      item.projectAllocationRatio,
      `${item.month} ${item.category}のプロジェクト割合`,
      warnings,
    )
    if (!item.basis.trim() || !item.rationale.trim())
      warnings.push('按分の計算式または採用理由が未登録です。')
    if (!item.evidenceIds.length) warnings.push('請求額または按分根拠の証拠が未登録です。')
    if (!item.taxUnitId && item.treatment !== 'general')
      warnings.push('配賦先の制作物・改良計画が未登録です。')
    if (item.treatment === 'general')
      warnings.push('一般管理費は制作物へ自動配賦せず、未配賦に残しました。')

    contributions.push(
      contribution({
        sourceType: 'home',
        sourceId: item.id,
        taxUnitId: item.taxUnitId,
        gross,
        businessRatio,
        projectRatio,
        treatment: item.treatment,
        warnings,
        forceUnallocated: !item.basis.trim() || !item.rationale.trim(),
      }),
    )
  }

  for (const item of snapshot.directCosts.filter((cost) =>
    cost.incurredOn.startsWith(`${year}-`),
  )) {
    const warnings: string[] = []
    const gross = positiveYen(item.amountJpy, `${item.costType}の金額`, warnings)
    const allocatable =
      item.directlyAttributable && item.treatment === 'direct' && Boolean(item.taxUnitId)
    if (!item.directlyAttributable) warnings.push('特定の制作物へ直接対応するか未確認です。')
    if (!item.taxUnitId) warnings.push('配賦先の制作物・改良計画が未登録です。')
    if (!item.evidenceIds.length) warnings.push('支払または対応関係の証拠が未登録です。')

    contributions.push(
      contribution({
        sourceType: 'direct',
        sourceId: item.id,
        taxUnitId: item.taxUnitId,
        gross,
        businessRatio: 1,
        projectRatio: allocatable ? 1 : 0,
        treatment: item.treatment,
        warnings,
        forceUnallocated: !allocatable,
      }),
    )
  }

  const totals = contributions.reduce<PlanningLedger['totals']>(
    (sum, item) => ({
      grossAmountJpy: sum.grossAmountJpy + item.grossAmountJpy,
      businessAmountJpy: sum.businessAmountJpy + item.businessAmountJpy,
      allocatedAmountJpy: sum.allocatedAmountJpy + item.allocatedAmountJpy,
      privateAmountJpy: sum.privateAmountJpy + item.privateAmountJpy,
      unallocatedAmountJpy: sum.unallocatedAmountJpy + item.unallocatedAmountJpy,
    }),
    {
      grossAmountJpy: 0,
      businessAmountJpy: 0,
      allocatedAmountJpy: 0,
      privateAmountJpy: 0,
      unallocatedAmountJpy: 0,
    },
  )

  const byTaxUnit = snapshot.taxUnits.map((unit) => {
    const related = contributions.filter((item) => item.taxUnitId === unit.id)
    const missingFacts = related.flatMap((item) => item.warnings)
    if (!unit.completionCriteria?.trim() && unit.lifecycleStatus !== 'maintaining') {
      missingFacts.push('完成・正式採用条件')
    }
    if (unit.usageMode === 'undecided') missingFacts.push('利用形態')
    return {
      taxUnitId: unit.id,
      name: unit.name,
      amountJpy: related.reduce((sum, item) => sum + item.allocatedAmountJpy, 0),
      candidate: candidateFor(unit),
      missingFacts: [...new Set(missingFacts)],
    }
  })

  return { year, contributions, totals, byTaxUnit }
}
