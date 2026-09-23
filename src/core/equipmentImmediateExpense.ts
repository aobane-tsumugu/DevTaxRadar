/** Ordinary individual small-equipment treatment. Whole acquisition value, before allocation. */
export type EquipmentExpenseFacts = {
  equipmentId: string
  taxYear: number
  taxpayer: 'individual' | 'corporation' | 'unknown'
  assetKind: 'tangible-equipment' | 'intangible' | 'unknown'
  methodReason: string
  acquisitionCostJpy: number | null
  acquiredOn: string | null
  businessUseStartedOn: string | null
  convertedFromPrivate: boolean | null
  ordinaryTreatment: 'confirmed' | 'special-or-adjusted' | 'unknown'
  rentalUse?: 'none' | 'primary-business' | 'other' | 'unknown'
  priorClosing: { taxYear: number; amountJpy: number; reference: string } | null
}
export type EquipmentImmediateExpenseResult = {
  engineVersion: 'jp-individual-small-equipment/1'
  equipmentId: string
  taxYear: number
  status: 'conditional' | 'missing-facts' | 'unsupported' | 'inconsistent' | 'outside-period'
  reasons: string[]
  taxTreatmentVerified: false
  calculation: null | {
    amountKind: 'immediate-expense'
    rateNumerator: null
    rateDenominator: null
    months: null
    openingBasisJpy: number
    /** Existing consumers use this annual amount before business/project allocation. */
    depreciationJpy: number
    closingBasisJpy: 0
    residualJpy: 0
    rounding: 'none'
    capped: false
    explanation: string
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** The public equipment entrance first runs its existing Zod schema; no separate save path. */
export function calculateEquipmentImmediateExpense(
  input: EquipmentExpenseFacts,
): EquipmentImmediateExpenseResult {
  const result = (
    status: EquipmentImmediateExpenseResult['status'],
    reasons: string[],
    calculation: EquipmentImmediateExpenseResult['calculation'] = null,
  ): EquipmentImmediateExpenseResult => ({
    engineVersion: 'jp-individual-small-equipment/1',
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
      (!Number.isSafeInteger(input.acquisitionCostJpy) || input.acquisitionCostJpy < 0))
  )
    return result('inconsistent', ['対象年と資産全体の取得価額を確認してください。'])
  if (
    [input.acquiredOn, input.businessUseStartedOn].some((date) => date !== null && !validDate(date))
  )
    return result('inconsistent', ['取得日と業務利用開始日は実在する年月日で指定してください。'])
  if (
    input.acquiredOn &&
    input.businessUseStartedOn &&
    input.businessUseStartedOn < input.acquiredOn
  )
    return result('inconsistent', ['業務利用開始が取得日より前です。'])
  if (
    input.taxpayer === 'corporation' ||
    input.assetKind === 'intangible' ||
    input.convertedFromPrivate === true ||
    input.ordinaryTreatment === 'special-or-adjusted'
  )
    return result('unsupported', [
      '法人・無形資産・私用からの転用・特殊調整は、この少額設備の処理へ置き換えません。',
    ])
  if (input.acquisitionCostJpy !== null && input.acquisitionCostJpy >= 100000)
    return result('unsupported', [
      '設備全体の取得価額が10万円未満ではありません。業務割合を掛けた後の金額では判定しません。',
    ])
  const missing: string[] = []
  if (input.taxpayer !== 'individual') missing.push('個人の区分')
  if (input.assetKind !== 'tangible-equipment') missing.push('有形設備の区分')
  if (input.acquisitionCostJpy === null) missing.push('設備全体の取得価額')
  if (!input.acquiredOn) missing.push('取得日')
  if (!input.businessUseStartedOn) missing.push('業務利用開始日')
  if (input.convertedFromPrivate === null) missing.push('私用からの転用の有無')
  if (input.ordinaryTreatment !== 'confirmed') missing.push('特殊調整の有無')
  if (!input.methodReason.trim()) missing.push('少額設備として扱う根拠')
  if (input.acquiredOn && input.acquiredOn >= '2022-04-01') {
    if (!input.rentalUse || input.rentalUse === 'unknown') missing.push('貸付用途と主要業務該当性')
    else if (input.rentalUse === 'other')
      return result('unsupported', [
        '2022年4月以後取得の主要業務以外の貸付資産は、この少額処理の対象外です。',
      ])
  }
  if (missing.length) return result('missing-facts', missing)
  const cost = input.acquisitionCostJpy!
  const usedYear = Number(input.businessUseStartedOn!.slice(0, 4))
  if (usedYear > input.taxYear)
    return result('outside-period', [
      'この年には業務利用を開始していません。取得年に繰り上げて費用化しません。',
    ])
  const inServiceYear = usedYear === input.taxYear
  if (input.priorClosing) {
    const prior = input.priorClosing
    const acquiredThisYear = input.acquiredOn!.startsWith(`${input.taxYear}-`)
    if (
      prior.taxYear !== input.taxYear - 1 ||
      !Number.isSafeInteger(prior.amountJpy) ||
      prior.amountJpy < 0 ||
      !prior.reference.trim() ||
      acquiredThisYear ||
      prior.amountJpy !== (inServiceYear ? cost : 0)
    )
      return result('inconsistent', [
        '前年残高と取得・供用時点が整合しません。過去の普通償却残高を少額処理で消しません。',
      ])
  }
  const annual = inServiceYear ? cost : 0
  return result(
    'conditional',
    [
      '登録した取得価額・供用・適用条件に基づく設備全体の費用基礎です。業務・制作物割合は既存の配分処理で一度だけ適用します。',
      ...(inServiceYear
        ? []
        : [
            '供用年以後の再計上は行いません。過去の採用資料の扱いは変更せず、必要な訂正は別途確認してください。',
          ]),
    ],
    {
      amountKind: 'immediate-expense',
      rateNumerator: null,
      rateDenominator: null,
      months: null,
      openingBasisJpy: annual,
      depreciationJpy: annual,
      closingBasisJpy: 0,
      residualJpy: 0,
      rounding: 'none',
      capped: false,
      explanation: inServiceYear
        ? `設備全体の取得価額 ${cost}円を、業務利用開始年 ${usedYear}年の費用基礎とします。月割り・耐用年数による計算は行いません。配分前の額です。`
        : `${usedYear}年供用の少額設備です。${input.taxYear}年に再計上する費用基礎は0円です。`,
    },
  )
}

/** Do not allow the ordinary depreciation entrance to bypass the small-asset eligibility rule. */
export function smallEquipmentStraightLineRestriction(input: EquipmentExpenseFacts): string | null {
  if (
    input.taxpayer !== 'individual' ||
    input.assetKind !== 'tangible-equipment' ||
    input.acquisitionCostJpy === null ||
    input.acquisitionCostJpy >= 100000 ||
    !input.acquiredOn
  )
    return null
  if (input.acquiredOn >= '2022-04-01') {
    if (!input.rentalUse || input.rentalUse === 'unknown')
      return '貸付用途を確認してください。10万円未満の設備に普通償却を仮定しません。'
    if (input.rentalUse === 'other') return null
  }
  return '通常の個人の10万円未満の設備は、少額設備の供用年費用化で確認してください。普通定額法の代替案にはしません。'
}
