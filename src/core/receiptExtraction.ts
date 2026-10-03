import { z } from 'zod'
import { validIsoCalendarDate } from './chargePeriods.js'
import { utf8Bytes } from '../planning/workspaceLimits.js'

export const RECEIPT_TEXT_BYTE_LIMIT = 512 * 1024
export const RECEIPT_TEXT_LINE_LIMIT = 10_000
export const RECEIPT_TEXT_LINE_LENGTH_LIMIT = 2048
export const RECEIPT_CANDIDATE_LIMIT = 20
export const RECEIPT_CANDIDATE_LENGTH_LIMIT = 160

/** Controlled messages only: never include source text, file names, paths or parser errors. */
export const RECEIPT_EXTRACTION_WARNINGS = {
  unconfirmed: '抽出結果は未確認候補です。原本と照合してから採用してください。',
  missing: '請求元・請求日・通貨・総額の一部を抽出できませんでした。',
  none: '対応するラベル付き項目を抽出できませんでした。手入力で確認してください。',
  invalid: '形式を確認できない項目は候補から除外しました。',
  multiple: '複数の候補があります。請求書単位で原本を確認してください。',
  amount: '金額の表記・符号または総額の意味が曖昧です。原本を確認してください。',
  currency: '通貨記号だけでは通貨を特定していません。原本で通貨を確認してください。',
  tax: '税込・税抜の区分は自動確定していません。総額を原本で確認してください。',
  subtotal: '小計・税抜額・税額は総額に採用していません。',
  period: '利用期間は未確認候補であり、事業の開始日や費用計上日を意味しません。',
  periodOrder: '利用期間の開始日と終了日の順序を確認してください。',
  candidateLimit: '候補数が上限に達しました。請求書を分けて原本を確認してください。',
  pages: '複数ページの候補が含まれます。別の請求書が混在していないか確認してください。',
  noOcr: '画像からの文字認識（OCR）は行っていません。読み取れない項目は手入力してください。',
} as const

const fields = [
  'issuer',
  'billedOn',
  'paidOn',
  'currency',
  'total',
  'startedOn',
  'endedOn',
  'invoiceNumber',
] as const

type CandidateField = (typeof fields)[number]
type Warning = (typeof RECEIPT_EXTRACTION_WARNINGS)[keyof typeof RECEIPT_EXTRACTION_WARNINGS]
const warningValues = Object.values(RECEIPT_EXTRACTION_WARNINGS)
const candidate = z.string().min(1).max(RECEIPT_CANDIDATE_LENGTH_LIMIT)
const candidates = z
  .array(candidate)
  .max(RECEIPT_CANDIDATE_LIMIT)
  .refine((values) => new Set(values).size === values.length)

/** The extraction boundary permits only unconfirmed, bounded candidate values and fixed warnings. */
export const receiptExtractionSchema = z.strictObject({
  issuer: candidates,
  billedOn: candidates,
  paidOn: candidates,
  currency: candidates,
  total: candidates,
  startedOn: candidates,
  endedOn: candidates,
  invoiceNumber: candidates,
  warnings: z
    .array(z.enum(warningValues))
    .max(warningValues.length)
    .refine(
      (values) =>
        values.includes(RECEIPT_EXTRACTION_WARNINGS.unconfirmed) &&
        new Set(values).size === values.length,
    ),
})
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>

const inputError = '領収書テキストは512 KiB以下・10,000行以下・1行2,048文字以下にしてください。'
const jsonError = '領収書JSONはversion: 1と対応する文字列項目だけを指定してください。'

function boundedText(text: string): string[] {
  if (typeof text !== 'string' || text.length > RECEIPT_TEXT_BYTE_LIMIT) throw new Error(inputError)
  if (utf8Bytes(text) > RECEIPT_TEXT_BYTE_LIMIT) throw new Error(inputError)
  const lines = text.replaceAll('\f', '\n\n').split(/\r\n?|\n|\u2028|\u2029/)
  if (
    lines.length > RECEIPT_TEXT_LINE_LIMIT ||
    lines.some((line) => line.length > RECEIPT_TEXT_LINE_LENGTH_LIMIT)
  )
    throw new Error(inputError)
  return lines
}

function emptyResult(): ReceiptExtraction {
  return {
    issuer: [],
    billedOn: [],
    paidOn: [],
    currency: [],
    total: [],
    startedOn: [],
    endedOn: [],
    invoiceNumber: [],
    warnings: [RECEIPT_EXTRACTION_WARNINGS.unconfirmed, RECEIPT_EXTRACTION_WARNINGS.noOcr],
  }
}
function warn(result: ReceiptExtraction, message: Warning): void {
  if (!result.warnings.includes(message)) result.warnings.push(message)
}
function add(result: ReceiptExtraction, field: CandidateField, value: string): void {
  if (result[field].includes(value)) return
  if (result[field].length === RECEIPT_CANDIDATE_LIMIT) {
    warn(result, RECEIPT_EXTRACTION_WARNINGS.candidateLimit)
    return
  }
  result[field].push(value)
}
function finish(result: ReceiptExtraction): ReceiptExtraction {
  if (fields.every((field) => result[field].length === 0))
    warn(result, RECEIPT_EXTRACTION_WARNINGS.none)
  if (
    ['issuer', 'billedOn', 'currency', 'total'].some(
      (field) => !result[field as CandidateField].length,
    )
  )
    warn(result, RECEIPT_EXTRACTION_WARNINGS.missing)
  if (fields.some((field) => result[field].length > 1))
    warn(result, RECEIPT_EXTRACTION_WARNINGS.multiple)
  if (result.total.length) warn(result, RECEIPT_EXTRACTION_WARNINGS.tax)
  if (result.startedOn.length || result.endedOn.length)
    warn(result, RECEIPT_EXTRACTION_WARNINGS.period)
  if (
    result.startedOn.length === 1 &&
    result.endedOn.length === 1 &&
    result.startedOn[0] > result.endedOn[0]
  )
    warn(result, RECEIPT_EXTRACTION_WARNINGS.periodOrder)
  return receiptExtractionSchema.parse(result)
}

function safeValue(raw: string): string | undefined {
  const value = raw.normalize('NFKC').trim()
  if (
    !value ||
    value.length > RECEIPT_CANDIDATE_LENGTH_LIMIT ||
    /[\p{Cc}\p{Cf}\p{Cs}<>`{}[\]\\]/u.test(value) ||
    /^(?:[=@+]|\/|~|[A-Za-z]:)/.test(value) ||
    /(?:https?:|file:|data:|javascript:|www\.|\.\.[/\\])/i.test(value)
  )
    return undefined
  return value
}

const months: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}
function dateCandidate(value: string): string | undefined {
  let year: string, month: string, day: string
  const numeric = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/.exec(value)
  const japanese = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/.exec(value)
  const monthFirst = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(value)
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(value)
  if (numeric) [, year, , month, day] = numeric
  else if (japanese) [, year, month, day] = japanese
  else if (monthFirst && months[monthFirst[1].toLowerCase()]) {
    year = monthFirst[3]
    month = String(months[monthFirst[1].toLowerCase()])
    day = monthFirst[2]
  } else if (dayFirst && months[dayFirst[2].toLowerCase()]) {
    year = dayFirst[3]
    month = String(months[dayFirst[2].toLowerCase()])
    day = dayFirst[1]
  } else return undefined
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return validIsoCalendarDate(date) ? date : undefined
}

function currencyCandidate(value: string): string | undefined {
  if (/^[A-Za-z]{3}$/.test(value)) return value.toUpperCase()
  const named: Record<string, string> = {
    円: 'JPY',
    日本円: 'JPY',
    'japanese yen': 'JPY',
    米ドル: 'USD',
    'us dollar': 'USD',
    'us dollars': 'USD',
    ユーロ: 'EUR',
    euro: 'EUR',
    euros: 'EUR',
    英ポンド: 'GBP',
  }
  return Object.hasOwn(named, value.toLowerCase()) ? named[value.toLowerCase()] : undefined
}

/** Dots are decimal separators; commas are accepted only in complete three-digit groups. */
function amountCandidate(value: string): string | undefined {
  if (!/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(value)) return undefined
  const normalized = value.replaceAll(',', '').replace(/^0+(?=\d)/, '')
  return /^(0|[1-9]\d{0,14})(\.\d{1,8})?$/.test(normalized) ? normalized : undefined
}

const moneyMarker = '(?:[A-Za-z]{3}|US\\$|JP[¥￥]|[¥￥$€£]|円)'
const moneyPattern = new RegExp(`^(${moneyMarker})?\\s*([0-9.,]+)\\s*(${moneyMarker})?$`, 'i')
const excludingTax = /(?:税抜|税別|小計|subtotal|(?:excl(?:uding)?\.?|without)\s*(?:tax|vat))/i
const includedTax =
  /(?:\s*\((?:税込|税込み|税を含む|(?:incl(?:uding)?\.?|with)\s*(?:tax|vat)|tax\s*included)\)\s*)/gi

function totalCandidate(result: ReceiptExtraction, value: string): void {
  if (excludingTax.test(value)) {
    warn(result, RECEIPT_EXTRACTION_WARNINGS.subtotal)
    warn(result, RECEIPT_EXTRACTION_WARNINGS.amount)
    return
  }
  const match = moneyPattern.exec(value.replace(includedTax, '').trim())
  const amount = match ? amountCandidate(match[2]) : undefined
  if (!match || amount === undefined) {
    warn(result, RECEIPT_EXTRACTION_WARNINGS.amount)
    return
  }
  add(result, 'total', amount)
  for (const marker of [match[1], match[3]].filter(Boolean)) {
    const code = /^US\$$/i.test(marker)
      ? 'USD'
      : /^JP[¥￥]$/i.test(marker)
        ? 'JPY'
        : currencyCandidate(marker)
    if (code) add(result, 'currency', code)
    else warn(result, RECEIPT_EXTRACTION_WARNINGS.currency)
  }
}

function extractField(result: ReceiptExtraction, field: CandidateField, raw: string): void {
  const value = safeValue(raw)
  if (!value) {
    warn(result, RECEIPT_EXTRACTION_WARNINGS.invalid)
    return
  }
  if (field === 'total') {
    totalCandidate(result, value)
    return
  }
  let parsed: string | undefined
  if (field === 'issuer') {
    // A compact name only: no emails, paths, HTML, formulas or neighbouring labelled fields.
    if (
      /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'’&()・ー‐–—-]*$/u.test(value) &&
      value.split(/\s+/).length <= 16 &&
      !/\.(?:pdf|png|jpe?g|webp|txt|json|csv|html?)$/i.test(value)
    )
      parsed = value
  } else if (field === 'invoiceNumber') {
    if (
      /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value) &&
      !value.includes('..') &&
      !/\.(?:pdf|png|jpe?g|webp|txt|json|csv|html?)$/i.test(value)
    )
      parsed = value
  } else if (field === 'currency') {
    parsed = currencyCandidate(value)
    if (!parsed) warn(result, RECEIPT_EXTRACTION_WARNINGS.currency)
  } else parsed = dateCandidate(value)
  if (parsed) add(result, field, parsed)
  else warn(result, RECEIPT_EXTRACTION_WARNINGS.invalid)
}

const labels: [CandidateField | 'period' | 'subtotal', string][] = [
  [
    'issuer',
    'issuer|seller|merchant|supplier|billed by|発行元|発行者|請求元|販売元|店舗名|事業者名',
  ],
  [
    'billedOn',
    'invoice date|billing date|billed on|issued on|issue date|請求日|請求年月日|発行日|発行年月日',
  ],
  ['paidOn', 'payment date|paid on|paid date|支払日|支払年月日|支払い日|決済日|領収日|入金日'],
  ['currency', 'currency|通貨|請求通貨'],
  [
    'invoiceNumber',
    'invoice number|invoice no\\.?|invoice #|receipt number|receipt no\\.?|請求書番号|請求番号|領収書番号',
  ],
  [
    'startedOn',
    'service period start|period start|period started on|利用期間開始日|対象期間開始日',
  ],
  ['endedOn', 'service period end|period end|period ended on|利用期間終了日|対象期間終了日'],
  ['period', 'service period|billing period|利用期間|対象期間|請求対象期間'],
  [
    'subtotal',
    'sub[ -]?total|tax amount|tax total|vat amount|小計|税抜合計|税抜金額|税別金額|消費税額|消費税|税額',
  ],
  [
    'total',
    'grand total|invoice total|total amount|total paid|amount paid|amount due|total|税込合計|税込金額|合計金額|請求金額|請求総額|お支払い金額|お支払金額|お支払合計|支払金額|総額|合計',
  ],
]
const labelPatterns = labels.map(([field, pattern]) => ({
  field,
  pattern: new RegExp(
    `^(?:${pattern})(\\s*\\((?:税込|税込み|税抜|税別|(?:incl(?:uding)?|excl(?:uding)?)\\.?\\s*(?:tax|vat))\\))?(?:\\s*[:：]\\s*|[ \\t]+)(.*)$`,
    'i',
  ),
}))

function extractPeriod(result: ReceiptExtraction, raw: string): void {
  const value = safeValue(raw)
  const parts = value?.split(/\s+(?:to|through|-)\s+|\s*[~〜～]\s*|\s*から\s*/i)
  if (!parts || parts.length !== 2) {
    warn(result, RECEIPT_EXTRACTION_WARNINGS.invalid)
    return
  }
  const startedOn = dateCandidate(parts[0].trim()),
    endedOn = dateCandidate(parts[1].trim())
  if (!startedOn || !endedOn) {
    warn(result, RECEIPT_EXTRACTION_WARNINGS.invalid)
    return
  }
  add(result, 'startedOn', startedOn)
  add(result, 'endedOn', endedOn)
}

/** Local, deterministic text extraction. Unlabelled guesses and OCR correction are intentionally absent. */
export function extractReceiptText(text: string): ReceiptExtraction {
  const lines = boundedText(text)
  const result = emptyResult()
  if (text.includes('\f')) warn(result, RECEIPT_EXTRACTION_WARNINGS.pages)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].normalize('NFKC').trim()
    for (const { field, pattern } of labelPatterns) {
      const match = pattern.exec(line)
      if (!match) continue
      let value = match[2].trim()
      // PDF text layers sometimes place a value directly below its label. Never cross a blank/page.
      if (!value && index + 1 < lines.length && lines[index + 1].trim())
        value = lines[++index].trim()
      if (field === 'subtotal' || (field === 'total' && excludingTax.test(match[1] ?? ''))) {
        warn(result, RECEIPT_EXTRACTION_WARNINGS.subtotal)
      } else if (field === 'period') extractPeriod(result, value)
      else extractField(result, field, value)
      break
    }
  }
  return finish(result)
}

/**
 * Version 1 import schema: { version: 1, issuer?, billedOn?, paidOn?, currency?, total?,
 * startedOn?, endedOn?, invoiceNumber? }. Every optional property is one string (max 160).
 * Unknown properties, duplicate properties, arrays, nested values and numeric amounts are rejected.
 * Date/amount normalization and source-review requirements are identical to text extraction.
 */
const receiptJsonSchema = z.strictObject({
  version: z.literal(1),
  issuer: candidate.optional(),
  billedOn: candidate.optional(),
  paidOn: candidate.optional(),
  currency: candidate.optional(),
  total: candidate.optional(),
  startedOn: candidate.optional(),
  endedOn: candidate.optional(),
  invoiceNumber: candidate.optional(),
})

function hasDuplicateKeys(text: string): boolean {
  const keys = new Set<string>()
  let depth = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '{') depth++
    else if (text[index] === '}') depth--
    else if (text[index] === '"') {
      const start = index++
      while (index < text.length) {
        if (text[index] === '\\') index += 2
        else if (text[index] === '"') break
        else index++
      }
      let after = index + 1
      while (/\s/.test(text[after] ?? '') && after < text.length) after++
      if (depth === 1 && text[after] === ':') {
        const key = JSON.parse(text.slice(start, index + 1)) as string
        if (keys.has(key)) return true
        keys.add(key)
      }
    }
  }
  return false
}

export function extractReceiptJson(text: string): ReceiptExtraction {
  boundedText(text)
  let input: z.infer<typeof receiptJsonSchema>
  try {
    const parsed: unknown = JSON.parse(text)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).some(
        (key) => key !== 'version' && !fields.includes(key as CandidateField),
      )
    )
      throw new Error(jsonError)
    input = receiptJsonSchema.parse(parsed)
    if (hasDuplicateKeys(text)) throw new Error(jsonError)
  } catch {
    throw new Error(jsonError)
  }
  const result = emptyResult()
  for (const field of fields)
    if (input[field] !== undefined) extractField(result, field, input[field])
  return finish(result)
}
