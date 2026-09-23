import { z } from 'zod'
import { calculateEquipmentPool, type EquipmentPoolResult } from './equipmentPool.js'
import {
  calculateEquipmentImmediateExpense,
  smallEquipmentStraightLineRestriction,
  type EquipmentImmediateExpenseResult,
} from './equipmentImmediateExpense.js'
import { validIsoCalendarDate } from './chargePeriods.js'

/** Published rate table; never replace this with acquisitionCost / usefulLifeYears. */
import { STRAIGHT_LINE_RATES as rates } from './straightLineRates.js'
export const EQUIPMENT_STRAIGHT_LINE_RULE = {
  id: 'jp-individual-tangible-straight-line/1',
  verifiedOn: '2026-09-08',
  acquiredFrom: '2007-04-01',
  rateTablePublicationYear: 2025,
  sources: [
    'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2106.htm',
    'https://www.nta.go.jp/taxes/shiraberu/shinkoku/tebiki/2025/pdf/019.pdf',
    'https://www.keisan.nta.go.jp/r7yokuaru_sp/aoiroshinkoku/hitsuyokeihi/genkashokyakuhi/scid1736.html',
  ],
} as const
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const date = z.string().refine(validIsoCalendarDate, '実在する年月日が必要です。')
export const equipmentDepreciationInputSchema = z
  .object({
    equipmentId: z.string().trim().min(1),
    taxYear: z.number().int().min(2007).max(2100),
    taxpayer: z.enum(['individual', 'corporation', 'unknown']),
    assetKind: z.enum(['tangible-equipment', 'intangible', 'unknown']),
    method: z.enum(['straight-line', 'immediate-expense', 'three-year-pool', 'other', 'unknown']),
    rentalUse: z.enum(['none', 'primary-business', 'other', 'unknown']).optional(),
    methodReason: z.string().max(2000),
    poolElection: z
      .object({
        serviceYear: z.number().int().min(2007).max(2100).nullable(),
        reference: z.string().max(2000),
        roundingConfirmed: z.boolean().nullable(),
      })
      .strict()
      .optional(),
    acquisitionCostJpy: money.nullable(),
    acquiredOn: date.nullable(),
    businessUseStartedOn: date.nullable(),
    usefulLifeYears: z.number().int().positive().nullable(),
    convertedFromPrivate: z.boolean().nullable(),
    /** Does not infer continuous use from an absent retirement record. */
    useThroughYearEnd: z.enum(['confirmed', 'ended-or-interrupted', 'unknown']),
    /** Ordinary calculation only; changes and special treatments require another rule. */
    ordinaryTreatment: z.enum(['confirmed', 'special-or-adjusted', 'unknown']),
    priorClosing: z
      .object({ taxYear: z.number().int(), amountJpy: money, reference: z.string().trim().min(1) })
      .strict()
      .nullable(),
  })
  .strict()
export type EquipmentDepreciationInput = z.infer<typeof equipmentDepreciationInputSchema>
export type EquipmentDepreciationResult =
  EquipmentImmediateExpenseResult | EquipmentStraightLineResult | EquipmentPoolResult
export type EquipmentStraightLineResult = {
  engineVersion: typeof EQUIPMENT_STRAIGHT_LINE_RULE.id
  equipmentId: string
  taxYear: number
  status: 'conditional' | 'missing-facts' | 'unsupported' | 'inconsistent' | 'outside-period'
  reasons: string[]
  taxTreatmentVerified: false
  calculation: null | {
    rateNumerator: number
    rateDenominator: 1000
    months: number
    openingBasisJpy: number
    depreciationJpy: number
    closingBasisJpy: number
    residualJpy: 1
    rounding: 'ceil-yen'
    capped: boolean
    explanation: string
  }
}

/** Scenario arithmetic for the whole asset, before business/project allocation. No adopted balance is written. */
export function calculateEquipmentDepreciation(
  value: EquipmentDepreciationInput,
): EquipmentDepreciationResult {
  const input = equipmentDepreciationInputSchema.parse(value)
  if (input.method === 'immediate-expense') return calculateEquipmentImmediateExpense(input)
  if (input.method === 'three-year-pool') return calculateEquipmentPool(input)
  const result = (
    status: EquipmentDepreciationResult['status'],
    reasons: string[],
    calculation: EquipmentStraightLineResult['calculation'] = null,
  ): EquipmentStraightLineResult => ({
    engineVersion: EQUIPMENT_STRAIGHT_LINE_RULE.id,
    equipmentId: input.equipmentId,
    taxYear: input.taxYear,
    status,
    reasons,
    taxTreatmentVerified: false,
    calculation,
  })
  const inconsistent: string[] = []
  if (
    input.acquiredOn &&
    input.businessUseStartedOn &&
    input.businessUseStartedOn < input.acquiredOn
  )
    inconsistent.push('業務利用開始が取得日より前です。')
  if (input.priorClosing && input.priorClosing.taxYear !== input.taxYear - 1)
    inconsistent.push('前年末残高の対象年が一致しません。')
  if (
    input.priorClosing &&
    input.acquisitionCostJpy !== null &&
    input.priorClosing.amountJpy > input.acquisitionCostJpy
  )
    inconsistent.push('前年末残高が取得額を超えています。')
  if (input.priorClosing?.amountJpy === 0)
    inconsistent.push('有形設備の残高1円を下回っています。除却等の別処理を確認してください。')
  if (input.priorClosing && input.acquiredOn?.startsWith(`${input.taxYear}-`))
    inconsistent.push('当年取得と前年末残高が併存しています。')
  if (inconsistent.length) return result('inconsistent', inconsistent)
  const unsupported: string[] = []
  if (input.taxpayer === 'corporation') unsupported.push('法人の償却計算はこの方法の対象外です。')
  if (input.assetKind === 'intangible')
    unsupported.push('無形資産の残存額・方法は別の規則が必要です。')
  if (input.method === 'other')
    unsupported.push('選択した償却方法は未対応です。定額法へ置き換えません。')
  if (input.acquiredOn && input.acquiredOn < EQUIPMENT_STRAIGHT_LINE_RULE.acquiredFrom)
    unsupported.push('2007年3月以前の取得には旧方法の確認が必要です。')
  if (input.convertedFromPrivate)
    unsupported.push('私用からの転用には転用前の減価と転用時残高の確認が必要です。')
  if (input.useThroughYearEnd === 'ended-or-interrupted')
    unsupported.push('年途中の終了・中断は期間と残高の別処理が必要です。')
  if (input.ordinaryTreatment === 'special-or-adjusted')
    unsupported.push('特別償却・方法変更・資本的支出等を含む計算は未対応です。')
  if (input.usefulLifeYears !== null && (input.usefulLifeYears < 2 || input.usefulLifeYears > 50))
    unsupported.push('検証済み償却率表の範囲外です。率を推定しません。')
  if (unsupported.length) return result('unsupported', unsupported)
  // A 0-yen cost is an inconsistent fact (checked below), not a small asset awaiting rental facts.
  const smallRestriction =
    input.method === 'straight-line' && input.acquisitionCostJpy !== 0
      ? smallEquipmentStraightLineRestriction(input)
      : null
  if (smallRestriction)
    return result(
      input.acquiredOn! >= '2022-04-01' && (!input.rentalUse || input.rentalUse === 'unknown')
        ? 'missing-facts'
        : 'unsupported',
      [smallRestriction],
    )
  const missing: string[] = []
  if (input.taxpayer === 'unknown') missing.push('納税者区分')
  if (input.assetKind === 'unknown') missing.push('有形設備の区分')
  if (input.method === 'unknown' || !input.methodReason.trim()) missing.push('償却方法と選んだ理由')
  if (input.acquisitionCostJpy === null) missing.push('取得価額')
  if (!input.acquiredOn) missing.push('取得日')
  if (!input.businessUseStartedOn) missing.push('業務利用開始日')
  if (input.usefulLifeYears === null) missing.push('確認した耐用年数')
  if (input.convertedFromPrivate === null) missing.push('私用からの転用の有無')
  if (input.useThroughYearEnd === 'unknown') missing.push('年末までの継続利用')
  if (input.ordinaryTreatment === 'unknown') missing.push('通常償却以外の調整の有無')
  if (missing.length) return result('missing-facts', missing)
  const end = `${input.taxYear}-12-31`
  if (input.acquiredOn! > end || input.businessUseStartedOn! > end)
    return result('outside-period', ['対象年には業務利用を開始していません。'])
  if (input.acquisitionCostJpy! < 1)
    return result('inconsistent', ['取得価額が有形設備の残存額1円を下回ります。'])
  const firstYear = input.acquiredOn!.startsWith(`${input.taxYear}-`)
  if (!firstYear && !input.priorClosing)
    return result('missing-facts', ['前年末の設備全体の未償却残高と参照先'])
  const opening = firstYear ? input.acquisitionCostJpy! : input.priorClosing!.amountJpy
  const months = input.businessUseStartedOn!.startsWith(`${input.taxYear}-`)
    ? 13 - Number(input.businessUseStartedOn!.slice(5, 7))
    : 12
  const rate = rates[input.usefulLifeYears! - 2]!
  const numerator = BigInt(input.acquisitionCostJpy!) * BigInt(rate) * BigInt(months)
  const rounded = (numerator + 11999n) / 12000n
  const maximum = BigInt(opening - 1)
  const depreciation = Number(rounded > maximum ? maximum : rounded)
  return result(
    'conditional',
    [
      '方法・耐用年数・取得価額等の入力を前提にした計算です。適用条件と根拠の内容は未検証です。私用按分・制作物配分前の設備全体額であり、当年必要経費の採用額ではありません。',
    ],
    {
      rateNumerator: rate,
      rateDenominator: 1000,
      months,
      openingBasisJpy: opening,
      depreciationJpy: depreciation,
      closingBasisJpy: opening - depreciation,
      residualJpy: 1,
      rounding: 'ceil-yen',
      capped: rounded > maximum,
      explanation: `取得価額 ${input.acquisitionCostJpy}円 × 償却率 ${rate}/1000 × ${months}/12 を円未満切上げ。期首または当年取得基礎 ${opening}円から1円を残す上限と比較し、普通償却額 ${depreciation}円、償却後残高 ${opening - depreciation}円。`,
    },
  )
}
