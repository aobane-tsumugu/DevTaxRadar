import type { ExpenseSource, ExpenseSourceKind } from '../accounting/costs.js'

export type CurrencyConversion = {
  currency: string
  foreignAmount: string
  jpyPerUnit: string
  rounding: 'nearest-yen' | 'floor-yen' | 'ceiling-yen'
  convertedOn: string
  reference: string
}

/** The original receipt and the chosen correction remain separate records. */
export type SourceAdjustmentRecord = {
  id: string
  sourceId: string
  /** Read pointer for the source, not an inferred tax-treatment year. */
  sourceYear: number
  sourceBasis: {
    kind: ExpenseSourceKind
    originalAmountJpy: number | null
    servicePeriod?: { startedOn: string; endedOn: string }
    acquiredOn?: string
    incurredOn?: string
    contractId?: string
  }
  kind: 'refund' | 'correction'
  /** Refunds are negative. A correction may increase or decrease the original. */
  amountJpy: number
  occurredOn: string
  recordedAt: string
  effect: 'restate-original-cost' | 'balance-reduction' | 'undetermined'
  balanceMovementId?: string
  reason: string
  evidenceIds: string[]
  conversion?: CurrencyConversion
}

export type SourceAdjustmentEvaluation = {
  sourceId: string
  originalAmountJpy: number | null
  costAmountJpy: number | null
  /** Receipt amounts, not a tax deduction or a posted balance reduction. */
  refundAmountJpy: number
  rows: Array<{
    id: string
    amountJpy: number
    effect: SourceAdjustmentRecord['effect']
    status: 'applied-to-cost' | 'balance-link' | 'pending' | 'stale'
    reasons: string[]
  }>
  reasons: string[]
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function keys(value: unknown, allowed: string[], label: string): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`${label}の入力形式を確認してください。`)
}
function text(value: unknown, max: number, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label}は1文字以上${max}文字以内で指定してください。`)
}
function day(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('実在する年月日を指定してください。')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ||
      Number(value.slice(0, 4)) < 1900)
    throw new Error('実在する1900年以降の年月日を指定してください。')
}
function decimal(value: unknown, label: string): [bigint, bigint] {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,14})(\.\d{1,8})?$/.test(value))
    throw new Error(`${label}は小数8桁までの非負の十進数で指定してください。`)
  const [whole, fraction = ''] = value.split('.')
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)]
}

/** Exact decimal arithmetic; the selected rule is recorded, not silently inferred. */
export function convertedYen(input: CurrencyConversion): number {
  keys(input, ['currency', 'foreignAmount', 'jpyPerUnit', 'rounding', 'convertedOn', 'reference'], '換算根拠')
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency) || input.currency === 'JPY')
    throw new Error('円以外の通貨を3文字の通貨コードで指定してください。')
  day(input.convertedOn)
  text(input.reference, 2000, '換算の確認先')
  const [amount, amountScale] = decimal(input.foreignAmount, '外貨額')
  const [rate, rateScale] = decimal(input.jpyPerUnit, '換算率')
  if (rate === 0n) throw new Error('換算率は0より大きくしてください。')
  const numerator = amount * rate
  const denominator = amountScale * rateScale
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  let result: bigint
  if (input.rounding === 'floor-yen') result = quotient
  else if (input.rounding === 'ceiling-yen') result = quotient + (remainder ? 1n : 0n)
  else if (input.rounding === 'nearest-yen') result = quotient + (remainder * 2n >= denominator ? 1n : 0n)
  else throw new Error('円未満の処理方法を選択してください。')
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('換算額が扱える整数円を超えています。')
  return Number(result)
}

/** Shared by manual entry, imported records and persistence; no tax treatment is approved here. */
export function validateSourceAdjustments(value: unknown): asserts value is SourceAdjustmentRecord[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('返金・訂正の記録は1000件までです。')
  const ids = new Set<string>()
  const years = new Set<number>()
  for (const item of value) {
    keys(item, ['id', 'sourceId', 'sourceYear', 'sourceBasis', 'kind', 'amountJpy', 'occurredOn', 'recordedAt', 'effect', 'balanceMovementId', 'reason', 'evidenceIds', 'conversion'], '返金・訂正')
    text(item.id, 120, '記録ID')
    if (ids.has(item.id)) throw new Error('返金・訂正の記録IDが重複しています。')
    ids.add(item.id)
    text(item.sourceId, 500, '元の費用ID')
    if (typeof item.sourceYear !== 'number' || !Number.isInteger(item.sourceYear) || item.sourceYear < 1900 || item.sourceYear > 9999)
      throw new Error('元費用を確認する年を指定してください。')
    years.add(item.sourceYear)
    if (years.size > 200) throw new Error('返金・訂正から参照する年度は200年分までです。')
    if (typeof item.kind !== 'string' || !['refund', 'correction'].includes(item.kind)) throw new Error('返金と訂正を区別してください。')
    if (typeof item.amountJpy !== 'number' || !Number.isSafeInteger(item.amountJpy) || item.amountJpy === 0 ||
        (item.kind === 'refund' && item.amountJpy > 0)) throw new Error('返金は負の整数円、訂正は0以外の整数円で指定してください。')
    day(item.occurredOn)
    if (typeof item.recordedAt !== 'string' || item.recordedAt.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item.recordedAt) ||
        !Number.isFinite(Date.parse(item.recordedAt))) throw new Error('記録日時と時間帯を指定してください。')
    day(item.recordedAt.slice(0, 10))
    if (typeof item.effect !== 'string' || !['restate-original-cost', 'balance-reduction', 'undetermined'].includes(item.effect))
      throw new Error('元費用の訂正・残高減少・保留を区別してください。')
    if (item.effect === 'balance-reduction') {
      if (item.amountJpy > 0) throw new Error('増額訂正を残高減少として扱うことはできません。')
      text(item.balanceMovementId, 200, '対応する残高減少ID')
    } else if (item.balanceMovementId !== undefined) throw new Error('残高減少以外には移動IDを指定できません。')
    text(item.reason, 2000, '対象期間と扱いの理由')
    if (!Array.isArray(item.evidenceIds) || item.evidenceIds.length === 0 || item.evidenceIds.length > 100 ||
        new Set(item.evidenceIds).size !== item.evidenceIds.length) throw new Error('重複しない証拠参照を1件以上100件以内で指定してください。')
    item.evidenceIds.forEach((id) => text(id, 120, '証拠ID'))
    keys(item.sourceBasis, ['kind', 'originalAmountJpy', 'servicePeriod', 'acquiredOn', 'incurredOn', 'contractId'], '元費用の確認内容')
    const basis = item.sourceBasis
    if (typeof basis.kind !== 'string' || !['subscription', 'equipment', 'home', 'direct', 'opening-balance'].includes(basis.kind))
      throw new Error('元費用の種類を確認してください。')
    if (basis.originalAmountJpy !== null &&
        (typeof basis.originalAmountJpy !== 'number' || !Number.isSafeInteger(basis.originalAmountJpy) || basis.originalAmountJpy < 0))
      throw new Error('元費用の原額は非負の整数円、または不明としてください。')
    if (basis.servicePeriod !== undefined) {
      keys(basis.servicePeriod, ['startedOn', 'endedOn'], '元費用の対象期間')
      day(basis.servicePeriod.startedOn); day(basis.servicePeriod.endedOn)
      if (basis.servicePeriod.startedOn > basis.servicePeriod.endedOn) throw new Error('対象期間が逆転しています。')
    }
    if (basis.acquiredOn !== undefined) day(basis.acquiredOn)
    if (basis.incurredOn !== undefined) day(basis.incurredOn)
    if (basis.contractId !== undefined) text(basis.contractId, 500, '契約ID')
    if (item.conversion !== undefined && convertedYen(item.conversion as CurrencyConversion) !== Math.abs(item.amountJpy))
      throw new Error('記録した換算根拠と円額が一致しません。決済手数料等は別の費用として記録してください。')
  }
}

export function sourceAdjustmentBasis(source: Pick<ExpenseSource, 'kind' | 'originalAmountJpy' | 'servicePeriod' | 'acquiredOn' | 'incurredOn' | 'contractId'>): SourceAdjustmentRecord['sourceBasis'] {
  return {
    kind: source.kind,
    originalAmountJpy: source.originalAmountJpy,
    ...(source.servicePeriod ? { servicePeriod: { startedOn: source.servicePeriod.startedOn, endedOn: source.servicePeriod.endedOn } } : {}),
    ...(source.acquiredOn ? { acquiredOn: source.acquiredOn } : {}),
    ...(source.incurredOn ? { incurredOn: source.incurredOn } : {}),
    ...(source.contractId ? { contractId: source.contractId } : {}),
  }
}

export function evaluateSourceAdjustments(
  source: ExpenseSource,
  records: readonly SourceAdjustmentRecord[],
  evidenceIds?: ReadonlySet<string>,
): SourceAdjustmentEvaluation {
  validateSourceAdjustments(records)
  const basis = JSON.stringify(sourceAdjustmentBasis(source))
  const selected = records.filter((record) => record.sourceId === source.id).sort((a, b) => compare(a.id, b.id))
  let change = 0n
  let refunds = 0n
  let blocked = false
  const reasons: string[] = []
  const rows: SourceAdjustmentEvaluation['rows'] = []
  for (const record of selected) {
    const messages: string[] = []
    if (JSON.stringify(sourceAdjustmentBasis(record.sourceBasis)) !== basis)
      messages.push('記録時の原額・対象期間・発生日・契約と現在の元費用が異なります。確認内容を黙って更新しません。')
    if (evidenceIds && record.evidenceIds.some((id) => !evidenceIds.has(id)))
      messages.push('返金・訂正の証拠参照が現在の記録にありません。')
    if (record.kind === 'refund') refunds += -BigInt(record.amountJpy)
    if (messages.length) {
      rows.push({ id: record.id, amountJpy: record.amountJpy, effect: record.effect, status: 'stale', reasons: messages })
      if (record.effect === 'restate-original-cost') blocked = true
      reasons.push(...messages)
      continue
    }
    if (record.effect === 'restate-original-cost') {
      if (source.kind === 'equipment' || source.kind === 'opening-balance' || source.originalAmountJpy === null) {
        const reason = source.originalAmountJpy === null
          ? '元の原額が不明なため、訂正後の費用基礎は未算定です。'
          : '設備値引き・旧版残高は単純な原額減算を適用しません。取得価額・未償却残額・対象年の方法を確認してください。'
        blocked = true; reasons.push(reason)
        rows.push({ id: record.id, amountJpy: record.amountJpy, effect: record.effect, status: 'pending', reasons: [reason] })
      } else {
        change += BigInt(record.amountJpy)
        rows.push({ id: record.id, amountJpy: record.amountJpy, effect: record.effect, status: 'applied-to-cost', reasons: ['指定した元費用の対象期間を作業中の計算で訂正します。受領年の税務処理や過去の採用版を自動変更しません。'] })
      }
    } else {
      rows.push({ id: record.id, amountJpy: record.amountJpy, effect: record.effect,
        status: record.effect === 'balance-reduction' ? 'balance-link' : 'pending',
        reasons: [record.effect === 'balance-reduction'
          ? '元費用の原額は保持し、指定した残高減少との金額・原価対応を年度資料で照合します。'
          : '返金・訂正の事実だけを保持します。当年費用や残高への影響は未判断です。'] })
    }
  }
  let costAmountJpy = source.originalAmountJpy
  if (costAmountJpy !== null) {
    const net = BigInt(costAmountJpy) + change
    if (net < 0n || net > BigInt(Number.MAX_SAFE_INTEGER)) {
      blocked = true
      reasons.push('訂正後の原額が負数または扱える整数円の範囲外です。訂正を取り消さず、費用基礎を保留します。')
    } else costAmountJpy = Number(net)
  }
  if (refunds > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('返金の合計が扱える整数円を超えています。')
  return { sourceId: source.id, originalAmountJpy: source.originalAmountJpy,
    costAmountJpy: blocked ? null : costAmountJpy,
    refundAmountJpy: Number(refunds), rows, reasons: [...new Set(reasons)] }
}
