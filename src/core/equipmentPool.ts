import { compareAnnualMethods, validMethodDate } from './annualMethodComparison.js'
import type { EquipmentDepreciationInput } from './equipmentDepreciation.js'

export type EquipmentPoolElection = {
  serviceYear: number | null
  reference: string
  roundingConfirmed: boolean | null
}
export const EQUIPMENT_POOL_RULE = {
  id: 'jp-individual-equipment-pool/1',
  checkedOn: '2026-09-20',
  sources: [
    'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm',
    'https://www.nta.go.jp/law/shitsugi/shotoku/04/04.htm',
  ],
} as const
export type EquipmentPoolResult = {
  engineVersion: typeof EQUIPMENT_POOL_RULE.id
  equipmentId: string
  taxYear: number
  status: 'conditional' | 'missing-facts' | 'unsupported' | 'inconsistent' | 'outside-period'
  reasons: string[]
  taxTreatmentVerified: false
  calculation: null | {
    openingBasisJpy: number
    depreciationJpy: number
    closingBasisJpy: number
    residualJpy: 0
    rounding: 'ceil-yen-final-cap'
    capped: boolean
    explanation: string
  }
}

/** One equipment election, before allocation. Reuses the existing alternative engine;
 * computed historical rows only reconcile an actual closing, never fill missing history. */
export function calculateEquipmentPool(input: EquipmentDepreciationInput): EquipmentPoolResult {
  const result = (
    status: EquipmentPoolResult['status'],
    reasons: string[],
    calculation: EquipmentPoolResult['calculation'] = null,
  ): EquipmentPoolResult => ({
    engineVersion: EQUIPMENT_POOL_RULE.id,
    equipmentId: input.equipmentId,
    taxYear: input.taxYear,
    status,
    reasons,
    taxTreatmentVerified: false,
    calculation,
  })
  if (
    !Number.isInteger(input.taxYear) ||
    input.taxYear < 2007 ||
    input.taxYear > 2100 ||
    (input.acquisitionCostJpy !== null &&
      (!Number.isSafeInteger(input.acquisitionCostJpy) || input.acquisitionCostJpy < 0)) ||
    (input.acquiredOn !== null && !validMethodDate(input.acquiredOn)) ||
    (input.businessUseStartedOn !== null && !validMethodDate(input.businessUseStartedOn))
  )
    return result('inconsistent', ['対象年・取得価額・取得と供用の日付を確認してください。'])
  if (input.method !== 'three-year-pool')
    return result('inconsistent', ['一括償却の選択を確認してください。'])
  if (
    input.taxpayer === 'corporation' ||
    input.assetKind === 'intangible' ||
    input.convertedFromPrivate === true ||
    input.ordinaryTreatment === 'special-or-adjusted'
  )
    return result('unsupported', [
      '法人・無形資産・私用転用・廃業や特殊調整は、この設備一括償却の通常経路に置き換えません。',
    ])
  const election = input.poolElection
  const missing = [
    ...(input.taxpayer !== 'individual' ? ['個人の納税者区分'] : []),
    ...(input.assetKind !== 'tangible-equipment' ? ['有形設備の区分'] : []),
    ...(input.convertedFromPrivate === null ? ['私用からの転用の有無'] : []),
    ...(input.ordinaryTreatment !== 'confirmed' ? ['廃業・特殊調整等がない通常条件'] : []),
    ...(input.acquisitionCostJpy === null ? ['設備全体の取得価額'] : []),
    ...(!input.acquiredOn || !input.businessUseStartedOn ? ['取得日と実際の供用日'] : []),
    ...(!input.methodReason.trim() ? ['この設備を一括償却とした理由'] : []),
    ...(!election || election.serviceYear === null || !election.reference.trim()
      ? ['供用年に一括償却を選択した記録と出典']
      : []),
    ...(election?.roundingConfirmed !== true
      ? ['設備別の円未満切上げ・最終年残額上限という計算条件']
      : []),
  ]
  if (missing.length) return result('missing-facts', missing)
  const acquiredOn = input.acquiredOn!,
    usedOn = input.businessUseStartedOn!
  const acquiredYear = Number(acquiredOn.slice(0, 4)),
    usedYear = Number(usedOn.slice(0, 4))
  if (usedOn < acquiredOn || election!.serviceYear !== usedYear)
    return result('inconsistent', ['供用年の選択記録と、取得・業務利用開始の日付が一致しません。'])
  if (input.taxYear < usedYear)
    return result('outside-period', [
      'まだ供用していない対象年です。先取りして一括償却額を配分しません。',
    ])
  // Only three formula years are needed, even when the current record is much later.
  if (acquiredYear < 2007 || usedYear + 2 - acquiredYear > 51)
    return result('unsupported', ['既存の方法計算が対応する取得年・供用期間の範囲外です。'])
  const scenarios = compareAnnualMethods(
    input.acquisitionCostJpy,
    {
      assetKind: 'tangible-equipment',
      contributionIds: [input.equipmentId],
      scopeBasis: '',
      completeCostConfirmed: true,
      // This engine receives the whole equipment amount. Actual private/business
      // fractions are applied once by workspaceCosts, not by the alternative formula.
      businessOnly: true,
      acquiredOn,
      usedOn,
      usefulLifeYears: null,
      taxpayer: 'individual',
      ordinaryConditions: true,
      rentalUse: input.rentalUse ?? 'unknown',
      throughYear: usedYear + 2,
      eligibleSmallBusiness: null,
      annualSpecialUsedJpy: null,
      businessMonths: null,
      statementReady: null,
      roundingConfirmed: true,
      reason: input.methodReason,
    },
    { filingType: 'undecided', incomeCategory: 'undecided' },
    input.equipmentId,
    acquiredYear,
  )
  const scenario = scenarios.scenarios.find((row) => row.method === 'three-year-pool')!
  if (scenario.status !== 'conditional' || !scenario.years)
    return result(scenario.status === 'missing-facts' ? 'missing-facts' : 'unsupported', [
      ...scenario.reasons,
    ])
  const year = scenario.years.find((row) => row.year === input.taxYear)
  const expectedOpening = year ? year.openingJpy + year.additionsJpy : 0
  const prior = input.priorClosing
  if (input.taxYear === acquiredYear) {
    if (prior) return result('inconsistent', ['当年取得と前年末残高が併存しています。'])
  } else {
    if (!prior)
      return result('missing-facts', [
        '実際の前年末の一括償却残額と参照先。計算表から実績を作りません。',
      ])
    if (
      prior.taxYear !== input.taxYear - 1 ||
      !Number.isSafeInteger(prior.amountJpy) ||
      prior.amountJpy < 0 ||
      !prior.reference.trim() ||
      prior.amountJpy !== expectedOpening
    )
      return result('inconsistent', [
        '実際の前年残額が、供用年の選択に対応する未費用化額と一致しません。過年度の方法・端数・訂正を確認してください。',
      ])
  }
  const opening = prior?.amountJpy ?? expectedOpening
  const expense = year?.expenseJpy ?? 0
  if (expense > opening)
    return result('inconsistent', ['当年の費用基礎が確認した残額を超えています。'])
  return result(
    'conditional',
    [
      '設備全体の条件付き一括償却額です。法定耐用年数や供用月数では割りません。業務・制作物の実際の割合はこの後の共通配分で一度だけ適用します。',
      '一括償却資産の合計・端数・申告明細との整合は選択資料で確認してください。税務上の必要経費を自動確定するものではありません。',
      ...(input.useThroughYearEnd === 'ended-or-interrupted'
        ? [
            '個々の設備の譲渡・除却だけで一括償却の残額を一時費用化しません。制作に使用していない期間を制作原価へ配分しないでください。',
          ]
        : []),
    ],
    {
      openingBasisJpy: opening,
      depreciationJpy: expense,
      closingBasisJpy: opening - expense,
      residualJpy: 0,
      rounding: 'ceil-yen-final-cap',
      capped:
        input.taxYear === usedYear + 2 &&
        expense < scenario.years.find((row) => row.year === usedYear)!.expenseJpy,
      explanation: `供用年 ${usedYear}年の選択に基づく設備全体取得額 ${input.acquisitionCostJpy}円の3年一括。対象年の確認した基礎 ${opening}円、費用基礎 ${expense}円、未費用化残額 ${opening - expense}円。月割り・耐用年数・残存1円は適用しません。選択資料：${election!.reference}`,
    },
  )
}
