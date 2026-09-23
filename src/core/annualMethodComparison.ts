/** Explicit whole-asset scenarios. They are never adopted tax records or a tax estimate. */
export type AnnualMethodFacts = {
  assetKind: 'software' | 'tangible-equipment' | 'unknown'
  contributionIds: string[]
  scopeBasis: string
  completeCostConfirmed: boolean | null
  businessOnly: boolean | null
  acquiredOn: string | null
  usedOn: string | null
  usefulLifeYears: number | null
  taxpayer: 'individual' | 'corporation' | 'unknown'
  ordinaryConditions: boolean | null
  rentalUse: 'none' | 'primary-business' | 'other' | 'unknown'
  throughYear: number
  eligibleSmallBusiness: boolean | null
  annualSpecialUsedJpy: number | null
  businessMonths: number | null
  statementReady: boolean | null
  roundingConfirmed: boolean | null
  reason: string
}
export type MethodYear = {
  year: number
  openingJpy: number
  additionsJpy: number
  expenseJpy: number
  closingJpy: number
  assumption: true
}
export type MethodScenario = {
  method: 'straight-line' | 'immediate-expense' | 'three-year-pool' | 'blue-special'
  status: 'conditional' | 'missing-facts' | 'not-eligible' | 'unsupported'
  reasons: string[]
  years: MethodYear[] | null
}
export type AnnualMethodComparison = {
  engineVersion: 'annual-method-comparison/1' | 'annual-method-comparison/2'
  ownerFactsId: string
  year: number
  amountJpy: number | null
  basisMeaning: 'whole-asset-before-business-allocation'
  status: 'compared' | 'stale' | 'missing-facts' | 'unsupported'
  reasons: string[]
  scenarios: MethodScenario[]
  sourceUrls: readonly string[]
  automaticPosting: false
  taxTreatmentVerified: false
}
export const ANNUAL_METHOD_RULE = {
  version: '2026-09-19',
  sourceUrls: [
    'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm',
    'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2106.htm',
    'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2107.htm',
  ],
} as const
import { STRAIGHT_LINE_RATES } from './straightLineRates.js'
export function validMethodDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(value + 'T00:00:00Z')
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value
}
const safeYen = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const fields = new Set([
  'assetKind',
  'contributionIds',
  'scopeBasis',
  'completeCostConfirmed',
  'businessOnly',
  'acquiredOn',
  'usedOn',
  'usefulLifeYears',
  'taxpayer',
  'ordinaryConditions',
  'rentalUse',
  'throughYear',
  'eligibleSmallBusiness',
  'annualSpecialUsedJpy',
  'businessMonths',
  'statementReady',
  'roundingConfirmed',
  'reason',
])
export function validateAnnualMethodFacts(value: unknown): asserts value is AnnualMethodFacts {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('方法比較の形式が不正です。')
  const f = value as AnnualMethodFacts
  if (Object.keys(f).some((key) => !fields.has(key)) || Object.keys(f).length !== fields.size)
    throw new Error('方法比較には定義された項目を指定してください。')
  if (
    !['software', 'tangible-equipment', 'unknown'].includes(f.assetKind) ||
    !['individual', 'corporation', 'unknown'].includes(f.taxpayer) ||
    !['none', 'primary-business', 'other', 'unknown'].includes(f.rentalUse)
  )
    throw new Error('方法比較の区分が不正です。')
  if (
    !Array.isArray(f.contributionIds) ||
    !f.contributionIds.length ||
    f.contributionIds.length > 1000 ||
    f.contributionIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 500) ||
    new Set(f.contributionIds).size !== f.contributionIds.length
  )
    throw new Error('資産の原価へ含む最終配分を重複なく指定してください。')
  if (typeof f.scopeBasis !== 'string' || f.scopeBasis.length > 4 * 1024 * 1024)
    throw new Error('方法比較の確認元が不正です。')
  if (typeof f.reason !== 'string' || f.reason.length > 2000)
    throw new Error('方法比較の理由が不正です。')
  for (const key of [
    'completeCostConfirmed',
    'businessOnly',
    'ordinaryConditions',
    'eligibleSmallBusiness',
    'statementReady',
    'roundingConfirmed',
  ] as const)
    if (f[key] !== null && typeof f[key] !== 'boolean')
      throw new Error('方法比較の確認状態が不正です。')
  for (const key of ['acquiredOn', 'usedOn'] as const)
    if (f[key] !== null && !validMethodDate(f[key]))
      throw new Error('方法比較には実在する日付が必要です。')
  if (
    f.usefulLifeYears !== null &&
    (!Number.isInteger(f.usefulLifeYears) || f.usefulLifeYears < 1 || f.usefulLifeYears > 100)
  )
    throw new Error('耐用年数が不正です。')
  if (!Number.isInteger(f.throughYear) || f.throughYear < 2007 || f.throughYear > 2151)
    throw new Error('比較の最終年が不正です。')
  if (f.annualSpecialUsedJpy !== null && !safeYen(f.annualSpecialUsedJpy))
    throw new Error('特例使用済額は安全な整数円で指定してください。')
  if (
    f.businessMonths !== null &&
    (!Number.isInteger(f.businessMonths) || f.businessMonths < 1 || f.businessMonths > 12)
  )
    throw new Error('事業月数が不正です。')
}

/** Compare alternatives, not their sum. The caller supplies the verified, complete asset amount. */
export function compareAnnualMethods(
  amountJpy: number | null,
  facts: AnnualMethodFacts,
  profile: { filingType: string; incomeCategory: string },
  ownerFactsId: string,
  costYear: number,
  priorClosing?: { taxYear: number; amountJpy: number; reference: string },
): AnnualMethodComparison {
  validateAnnualMethodFacts(facts)
  if (
    !Number.isInteger(costYear) ||
    costYear < 2007 ||
    costYear > 2100 ||
    facts.throughYear < costYear ||
    facts.throughYear - costYear > 51
  )
    throw new Error('比較範囲は原価年から連続52年以内です。年を省略して計算しません。')
  if (amountJpy !== null && !safeYen(amountJpy))
    throw new Error('資産全体額は安全な整数円である必要があります。')
  const methods = ['straight-line', 'immediate-expense', 'three-year-pool', 'blue-special'] as const
  const result: AnnualMethodComparison = {
    engineVersion: 'annual-method-comparison/2',
    ownerFactsId,
    year: costYear,
    amountJpy,
    basisMeaning: 'whole-asset-before-business-allocation',
    status: 'compared',
    reasons: [],
    scenarios: [],
    sourceUrls: ANNUAL_METHOD_RULE.sourceUrls,
    automaticPosting: false,
    taxTreatmentVerified: false,
  }
  const stop = (status: AnnualMethodComparison['status'], reason: string) => ({
    ...result,
    status,
    reasons: [reason],
    scenarios: methods.map((method) => ({
      method,
      status: status === 'unsupported' ? ('unsupported' as const) : ('missing-facts' as const),
      reasons: [reason],
      years: null,
    })),
  })
  if (facts.taxpayer === 'corporation' || facts.ordinaryConditions === false)
    return stop(
      'unsupported',
      '法人・私用転用・方法変更・特殊調整・中断を普通計算へ置き換えません。',
    )
  if (facts.businessOnly === false)
    return stop(
      'unsupported',
      '私用を含む資産の比較はこの業務専用経路の対象外です。未入力として再確認を求めません。',
    )
  if (
    facts.taxpayer !== 'individual' ||
    facts.assetKind === 'unknown' ||
    facts.completeCostConfirmed !== true ||
    facts.businessOnly !== true ||
    facts.ordinaryConditions !== true ||
    amountJpy === null ||
    !facts.reason.trim() ||
    !facts.acquiredOn ||
    !facts.usedOn
  )
    return stop(
      'missing-facts',
      '個人・資産全体原価・業務専用・通常条件・取得と供用日・比較理由を確認してください。',
    )
  if (facts.acquiredOn < '2007-04-01')
    return stop('unsupported', '旧償却方法の取得期間はこの比較の対象外です。')
  if (facts.usedOn < facts.acquiredOn)
    return stop('missing-facts', '取得・製作日と供用日の順序を確認してください。')
  const priorAsset = Number(facts.acquiredOn.slice(0, 4)) < costYear
  if (
    priorAsset &&
    (!priorClosing ||
      priorClosing.taxYear !== costYear - 1 ||
      !safeYen(priorClosing.amountJpy) ||
      priorClosing.amountJpy > amountJpy ||
      !priorClosing.reference.trim())
  )
    return stop(
      'missing-facts',
      '既存資産は前年の資産全体残高と出典が必要です。過去の償却実績を再構成しません。',
    )
  if (priorAsset && priorClosing!.amountJpy < (facts.assetKind === 'tangible-equipment' ? 1 : 0))
    return stop('missing-facts', '前年残高が残存額を下回ります。除却等の別処理を確認してください。')
  const acquiredYear = Number(facts.acquiredOn.slice(0, 4)),
    usedYear = Number(facts.usedOn.slice(0, 4))
  if (usedYear > facts.throughYear || acquiredYear > facts.throughYear)
    return stop('missing-facts', '供用年まで含む比較期間を指定してください。')
  const cost = BigInt(amountJpy)
  const build = (method: MethodScenario['method']): MethodYear[] => {
    let closing = priorAsset ? BigInt(priorClosing!.amountJpy) : 0n
    const years: MethodYear[] = []
    const residual =
      method === 'straight-line' && facts.assetKind === 'tangible-equipment' ? 1n : 0n
    for (let year = costYear; year <= facts.throughYear; year++) {
      const opening = closing,
        additions = year === acquiredYear ? cost : 0n
      closing += additions
      let expense = 0n
      if (year >= usedYear && closing > residual) {
        if (method === 'straight-line') {
          const rate = BigInt(STRAIGHT_LINE_RATES[facts.usefulLifeYears! - 2]!)
          const months = year === usedYear ? 13 - Number(facts.usedOn!.slice(5, 7)) : 12
          expense = (cost * rate * BigInt(months) + 11999n) / 12000n
        } else if (method === 'three-year-pool') {
          // Independent alternative; no monthly prorating. Last year is capped to the unexpensed total.
          expense = year < usedYear + 3 ? (cost + 2n) / 3n : 0n
        } else expense = year === usedYear ? closing : 0n
        if (expense > closing - residual) expense = closing - residual
      }
      closing -= expense
      if (opening + additions - expense !== closing || closing < 0n)
        throw new Error('方法比較の年次保存則が成立しません。')
      years.push({
        year,
        openingJpy: Number(opening),
        additionsJpy: Number(additions),
        expenseJpy: Number(expense),
        closingJpy: Number(closing),
        assumption: true,
      })
    }
    return years
  }
  for (const method of methods) {
    let status: MethodScenario['status'] = 'conditional'
    const reasons: string[] = []
    const reject = (s: MethodScenario['status'], r: string) => {
      if (status === 'conditional') status = s
      reasons.push(r)
    }
    if (amountJpy < 1) reject('not-eligible', '取得額0円を償却資産へ変えません。')
    if (method === 'straight-line') {
      // Income tax No.2100 notes 1/4: ordinary small assets are expensed on use;
      // post-2022 non-primary rental is the explicit exception, never inferred.
      if (amountJpy < 100000) {
        if (facts.acquiredOn >= '2022-04-01' && facts.rentalUse === 'unknown')
          reject(
            'missing-facts',
            '10万円未満の資産は原則として供用年の全額費用です。貸付例外の有無を確認してください。',
          )
        else if (facts.acquiredOn < '2022-04-01' || facts.rentalUse !== 'other')
          reject(
            'not-eligible',
            '10万円未満の通常の資産は供用年の全額費用とし、通常償却を選択肢にしません。',
          )
      }
      if (facts.usefulLifeYears === null)
        reject('missing-facts', '法定耐用年数とその根拠を確認してください。')
      else if (facts.assetKind === 'software' && ![3, 5].includes(facts.usefulLifeYears))
        reject('unsupported', 'ソフトウエアの区分と3年・5年の耐用年数を確認してください。')
      else if (facts.usefulLifeYears < 2 || facts.usefulLifeYears > 50)
        reject('unsupported', '既存の検証済み償却率表の範囲外です。')
    } else {
      if (priorAsset)
        reject('not-eligible', '既存資産の過去の方法を少額・一括・特例へ遡って変更しません。')
      if (facts.acquiredOn >= '2022-04-01' && facts.rentalUse === 'unknown')
        reject('missing-facts', '貸付用途と主要業務該当性を確認してください。')
      if (facts.acquiredOn >= '2022-04-01' && facts.rentalUse === 'other')
        reject('not-eligible', '主要な業務以外の貸付用資産は少額・一括・特例の対象外です。')
      if (method === 'immediate-expense' && amountJpy >= 100000)
        reject('not-eligible', '資産全体の取得価額が10万円未満ではありません。')
      if (method === 'three-year-pool' && (amountJpy < 100000 || amountJpy >= 200000))
        reject('not-eligible', 'この比較の一括償却対象は資産全体で10万円以上20万円未満です。')
      if (method === 'blue-special') {
        const limit = facts.acquiredOn < '2026-04-01' ? 300000 : 400000
        if (facts.acquiredOn > '2029-03-31' || facts.usedOn > '2029-03-31')
          reject('unsupported', '確認済み特例の制度期間外です。将来の延長を推測しません。')
        if (amountJpy < 100000 || amountJpy >= limit)
          reject('not-eligible', '取得時期に対応する特例の金額範囲外です。')
        if (profile.filingType === 'undecided' || profile.incomeCategory === 'undecided')
          reject('missing-facts', '所得区分と青色申告の条件を確認してください。')
        else if (
          profile.filingType !== 'blue' ||
          !['business', 'real-estate', 'forestry'].includes(profile.incomeCategory)
        )
          reject('not-eligible', 'この所得区分・申告条件では青色特例を適用しません。')
        if (facts.eligibleSmallBusiness === false)
          reject('not-eligible', '特例の事業者要件を満たしていません。')
        else if (facts.eligibleSmallBusiness === null)
          reject('missing-facts', '取得時期の事業者要件を確認してください。')
        if (
          facts.businessMonths === null ||
          facts.annualSpecialUsedJpy === null ||
          facts.statementReady !== true
        )
          reject(
            'missing-facts',
            '供用年の事業月数・他資産の特例使用額・明細の準備を確認してください。',
          )
        else if (
          BigInt(facts.annualSpecialUsedJpy) + cost >
          (3000000n * BigInt(facts.businessMonths)) / 12n
        )
          reject('not-eligible', '供用年の他資産分を含めた特例上限を超えています。')
      }
    }
    if (
      status === 'conditional' &&
      ['straight-line', 'three-year-pool'].includes(method) &&
      facts.roundingConfirmed !== true
    )
      reject(
        'missing-facts',
        'この方法の円未満切上げ・最終年残額上限という比較上の端数条件を確認してください。',
      )
    if (status === 'conditional')
      reasons.push(
        '登録した取得原価・適用条件を仮定する独立した比較です。制度適用・方法選択の確定や記帳は行いません。',
      )
    result.scenarios.push({
      method,
      status,
      reasons,
      years: status === 'conditional' ? build(method) : null,
    })
  }
  result.reasons.push(
    '各方法は代替案です。方法間の金額を合算しません。将来年は継続使用等を仮定し、過去の採用資料を置換しません。',
  )
  return result
}
