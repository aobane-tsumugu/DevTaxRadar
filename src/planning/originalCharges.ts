import { z } from 'zod'
import { validIsoCalendarDate } from '../core/chargePeriods.js'
import { convertedYen } from '../core/sourceAdjustments.js'
import {
  providerChargePeriodSchema,
  equipmentSchema,
  homeCostSchema,
  directCostSchema,
} from './chargeRecords.js'

const id = z.string().trim().min(1).max(120)
const sourceId = z.string().trim().min(1).max(500)
const note = z.string().trim().min(1).max(2000)
const date = z.string().refine(validIsoCalendarDate, '実在する年月日を指定してください。')
const yen = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const decimal = z
  .string()
  .regex(/^(0|[1-9]\d{0,14})(\.\d{1,8})?$/, '小数8桁までの十進数を指定してください。')
const evidenceIds = z
  .array(id)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, '根拠IDが重複しています。')
const conversion = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  foreignAmount: decimal,
  jpyPerUnit: decimal,
  rounding: z.enum(['nearest-yen', 'floor-yen', 'ceiling-yen']),
  convertedOn: date,
  reference: note,
})

export const originalMoneySchema = z
  .strictObject({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    amount: decimal.nullable(),
    unknownAmountReason: note.optional(),
    amountJpy: yen.nullable(),
    unknownJpyReason: note.optional(),
    fx: conversion.optional(),
    conversionEvidenceIds: evidenceIds.optional(),
  })
  .superRefine((money, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if ((money.amount === null) !== Boolean(money.unknownAmountReason))
      issue('原通貨額が不明な場合だけ、その理由を入力してください。')
    if ((money.amountJpy === null) !== Boolean(money.unknownJpyReason))
      issue('採用円額が不明な場合だけ、その理由を入力してください。')
    if (money.currency === null && money.amount !== null)
      issue('原通貨が不明な場合、原通貨額を既知として保存できません。')
    if (money.currency === 'JPY' && money.amount !== null) {
      if (!/^(0|[1-9]\d*)$/.test(money.amount) || Number(money.amount) !== money.amountJpy)
        issue('円建ての原額と採用円額は同じ整数円にしてください。')
    }
    if (money.currency === 'JPY' && money.fx) issue('円建ての原額には外貨換算を設定できません。')
    if (
      money.currency !== 'JPY' &&
      money.currency !== null &&
      money.amount !== null &&
      money.amountJpy !== null &&
      !money.fx
    )
      issue('既知の外貨額を円額として採用するには換算根拠を入力してください。')
    if (money.fx) {
      if (
        money.amount === null ||
        money.amountJpy === null ||
        money.fx.currency !== money.currency ||
        money.fx.foreignAmount !== money.amount
      )
        issue('換算根拠の通貨・外貨額と原請求を一致させてください。')
      try {
        if (convertedYen(money.fx) !== money.amountJpy) issue('換算根拠と採用円額が一致しません。')
      } catch (error) {
        issue(error instanceof Error ? error.message : '換算根拠を確認してください。')
      }
    }
  })

const metadata = {
  original: originalMoneySchema,
  dates: z
    .strictObject({
      billedOn: date.optional(),
      paidOn: date.optional(),
      acquiredOn: date.optional(),
      incurredOn: date.optional(),
    })
    .optional(),
  servicePeriod: z
    .strictObject({ startedOn: date, endedOn: date })
    .refine((period) => period.startedOn <= period.endedOn, '利用期間が逆転しています。')
    .optional(),
  contract: z
    .strictObject({ reference: z.string().trim().min(1).max(160), reason: note.optional() })
    .optional(),
  evidenceIds,
  provenance: z.strictObject({
    kind: z.enum(['manual', 'csv', 'json', 'receipt']),
    sourceKey: z.string().trim().min(1).max(300).optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  correctsId: id.optional(),
  legacySourceId: sourceId.optional(),
  correctionReason: note.optional(),
}
const operationalSchemas = [
  providerChargePeriodSchema,
  equipmentSchema.strict(),
  homeCostSchema.strict(),
  directCostSchema.strict(),
] as const
const candidateBase = z.discriminatedUnion('category', [
  z.strictObject({
    category: z.literal('subscription'),
    record: operationalSchemas[0],
    ...metadata,
  }),
  z.strictObject({ category: z.literal('equipment'), record: operationalSchemas[1], ...metadata }),
  z.strictObject({ category: z.literal('home'), record: operationalSchemas[2], ...metadata }),
  z.strictObject({ category: z.literal('direct'), record: operationalSchemas[3], ...metadata }),
])
export type OriginalChargeCandidate = z.infer<typeof candidateBase>
export type OriginalChargeCategory = OriginalChargeCandidate['category']

/** Canonical data, never raw CSV, JSON, receipt text, paths or filenames. */
export function canonicalOriginalCharge(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalOriginalCharge).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonicalOriginalCharge(v))
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'null'
}

/** Synchronous SHA-256 over UTF-8 keeps browser preview and persistence verification identical. */
export function originalChargeDigest(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const size = Math.ceil((bytes.length + 9) / 64) * 64
  const data = new Uint8Array(size)
  data.set(bytes)
  data[bytes.length] = 0x80
  const view = new DataView(data.buffer)
  view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(size - 4, (bytes.length * 8) >>> 0)
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const rotate = (n: number, shift: number) => (n >>> shift) | (n << (32 - shift))
  const words = new Uint32Array(64)
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15],
        b = words[i - 2]
      words[i] =
        (words[i - 16] +
          (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
          words[i - 7] +
          (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>>
        0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          k[i] +
          words[i]) >>>
        0
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    for (const [i, value] of [a, b, c, d, e, f, g, hh].entries()) h[i] = (h[i] + value) >>> 0
  }
  return h.map((n) => n.toString(16).padStart(8, '0')).join('')
}

export function originalChargeContentHash(candidate: OriginalChargeCandidate): string {
  const { category, record, original, dates, servicePeriod, contract, evidenceIds } = candidate
  return originalChargeDigest(
    canonicalOriginalCharge({
      category,
      record,
      original,
      dates,
      servicePeriod,
      contract,
      evidenceIds,
    }),
  )
}
export function originalChargeSourceId(
  candidate: Pick<OriginalChargeCandidate, 'category' | 'record'>,
): string {
  return `${candidate.category === 'subscription' ? 'ai:charge' : candidate.category}:${candidate.record.id}`
}
function validateCandidate(candidate: OriginalChargeCandidate, ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (
    Boolean(candidate.correctsId || candidate.legacySourceId) !==
      Boolean(candidate.correctionReason) ||
    (candidate.correctsId && candidate.legacySourceId)
  )
    issue('訂正元（既存記録または事実ID）と訂正理由を一組で指定してください。')
  if (candidate.legacySourceId && candidate.legacySourceId !== originalChargeSourceId(candidate))
    issue('既存記録の費用IDと訂正対象が一致しません。')
  if (candidate.provenance.kind === 'manual') {
    if (candidate.provenance.sourceKey || candidate.provenance.contentHash)
      issue('手動入力に取込識別子は設定できません。')
  } else if (!candidate.provenance.sourceKey || !candidate.provenance.contentHash)
    issue('取込には安定した元請求キーと内容hashが必要です。')
  else if (candidate.provenance.contentHash !== originalChargeContentHash(candidate))
    issue('取込の内容hashが原請求と一致しません。')
  const recordAmount =
    candidate.category === 'equipment'
      ? candidate.record.acquisitionCostJpy
      : candidate.record.amountJpy
  if (
    recordAmount !== candidate.original.amountJpy ||
    candidate.record.unknownAmountReason !== candidate.original.unknownJpyReason
  )
    issue('分類先の金額・不明理由と採用円額が一致しません。')
  if (
    canonicalOriginalCharge([...(candidate.record.evidenceIds ?? [])].sort()) !==
    canonicalOriginalCharge([...candidate.evidenceIds].sort())
  )
    issue('分類先と原請求の証拠参照を一致させてください。')
  if (candidate.category === 'subscription') {
    if (
      candidate.servicePeriod &&
      (candidate.servicePeriod.startedOn !== candidate.record.serviceStartedOn ||
        candidate.servicePeriod.endedOn !== candidate.record.serviceEndedOn)
    )
      issue('分類先と原請求の利用期間が一致しません。')
    if (candidate.dates?.billedOn && candidate.dates.billedOn !== candidate.record.billedOn)
      issue('分類先と原請求の請求日が一致しません。')
    if (
      candidate.contract &&
      candidate.record.contractConfirmation &&
      candidate.contract.reference !== candidate.record.contractConfirmation.reference
    )
      issue('原請求と確認済み契約の参照が一致しません。')
  }
  if (
    candidate.category === 'equipment' &&
    candidate.dates?.acquiredOn &&
    candidate.dates.acquiredOn !== candidate.record.acquiredOn
  )
    issue('分類先と原請求の取得日が一致しません。')
  if (
    candidate.category === 'direct' &&
    candidate.dates?.incurredOn &&
    candidate.dates.incurredOn !== candidate.record.incurredOn
  )
    issue('分類先と原請求の発生日が一致しません。')
  const record = candidate.record as Record<string, unknown>
  for (const name of [
    'acquiredOn',
    'incurredOn',
    'orderedOn',
    'deliveredOn',
    'businessUseStartedOn',
  ])
    if (
      record[name] !== undefined &&
      (typeof record[name] !== 'string' || !validIsoCalendarDate(record[name]))
    )
      issue('分類先の実在する日付を指定してください。')
}
export const originalChargeCandidateSchema = candidateBase.superRefine(validateCandidate)
const factMetadata = {
  id,
  recordedAt: z
    .string()
    .max(40)
    .datetime({ offset: true })
    .refine(
      (value) => validIsoCalendarDate(value.slice(0, 10)),
      '実在する記録日を指定してください。',
    ),
  sourceId,
  legacyPreviousRecord: z.union(operationalSchemas).optional(),
}
const factBase = z.discriminatedUnion('category', [
  candidateBase.options[0].extend(factMetadata),
  candidateBase.options[1].extend(factMetadata),
  candidateBase.options[2].extend(factMetadata),
  candidateBase.options[3].extend(factMetadata),
])
export const originalChargeFactSchema = factBase.superRefine((fact, ctx) => {
  validateCandidate(fact as OriginalChargeCandidate, ctx)
  if (fact.sourceId !== originalChargeSourceId(fact as OriginalChargeCandidate))
    ctx.addIssue({ code: 'custom', message: '費用IDを分類先から変更できません。' })
  if (Boolean(fact.legacySourceId) !== Boolean(fact.legacyPreviousRecord))
    ctx.addIssue({ code: 'custom', message: '既存記録の訂正には変更前の記録を保持してください。' })
  const previousSchema =
    fact.category === 'subscription'
      ? operationalSchemas[0]
      : fact.category === 'equipment'
        ? operationalSchemas[1]
        : fact.category === 'home'
          ? operationalSchemas[2]
          : operationalSchemas[3]
  if (fact.legacyPreviousRecord && !previousSchema.safeParse(fact.legacyPreviousRecord).success)
    ctx.addIssue({ code: 'custom', message: '既存記録の訂正前後で分類を変更できません。' })
  if (fact.legacyPreviousRecord && fact.legacyPreviousRecord.id !== fact.record.id)
    ctx.addIssue({ code: 'custom', message: '既存記録の訂正前後でIDを変更できません。' })
})
export type OriginalChargeFact = z.infer<typeof originalChargeFactSchema>
export const originalChargesSchema = z
  .strictObject({ version: z.literal(1), facts: z.array(originalChargeFactSchema).max(5000) })
  .superRefine((ledger, ctx) => {
    const seen = new Map<string, OriginalChargeFact>()
    const heads = new Map<string, OriginalChargeFact>()
    const keys = new Map<string, string>()
    for (const fact of ledger.facts) {
      const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['facts'], message })
      if (seen.has(fact.id)) issue('原請求の事実IDが重複しています。')
      const previous = heads.get(fact.sourceId)
      if (fact.correctsId) {
        if (
          !previous ||
          previous.id !== fact.correctsId ||
          previous.category !== fact.category ||
          Date.parse(previous.recordedAt) > Date.parse(fact.recordedAt)
        )
          issue('訂正元は同じ費用の未訂正の事実を指定してください。')
      } else if (previous) issue('同じ費用を再登録するには訂正元と理由が必要です。')
      const key = fact.provenance.sourceKey
      if (key && keys.has(key) && keys.get(key) !== fact.sourceId)
        issue('同じ取込元キーを別の費用に再利用できません。')
      if (key) keys.set(key, fact.sourceId)
      seen.set(fact.id, fact)
      heads.set(fact.sourceId, fact)
    }
  })
export type OriginalCharges = z.infer<typeof originalChargesSchema>
export const emptyOriginalCharges = (): OriginalCharges => ({ version: 1, facts: [] })
export function activeOriginalCharges(ledger: OriginalCharges | undefined): OriginalChargeFact[] {
  const corrected = new Set(
    ledger?.facts.flatMap((fact) => (fact.correctsId ? [fact.correctsId] : [])) ?? [],
  )
  return (ledger?.facts ?? []).filter((fact) => !corrected.has(fact.id))
}
