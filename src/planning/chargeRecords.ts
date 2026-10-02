import { z } from 'zod'
import { validIsoCalendarDate } from '../core/chargePeriods.js'
import { allocationTargetsSchema } from './allocationTargets.js'

// Shared operational DTOs: intake keeps every category-specific allocation and method field.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const identifier = z.string().trim().min(1).max(120)
const ratio = z.number().min(0).max(1)
const evidenceIds = z.array(identifier).max(100)
const contractDateSchema = z.string().refine(validIsoCalendarDate, {
  message: '実在する日付を YYYY-MM-DD で入力してください。',
})

export const equipmentSchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1).max(160),
    equipmentType: z.enum(['pc', 'gpu', 'dgx', 'server', 'desk', 'peripheral', 'other']),
    acquisitionCostJpy: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    unknownAmountReason: z.string().trim().min(1).max(2_000).optional(),
    orderedOn: date.optional(),
    deliveredOn: date.optional(),
    acquiredOn: date,
    businessUseStartedOn: date.optional(),
    convertedFromPrivate: z.boolean(),
    openingUnamortizedBalanceJpy: z.number().int().nonnegative().optional(),
    businessUseRatio: ratio,
    usefulLifeYears: z.number().int().positive().max(100).optional(),
    role: z.string().trim().min(1).max(1_000),
    taxUnitId: identifier.optional(),
    projectAllocationRatio: ratio,
    evidenceIds,
  })
  .refine((item) => (item.acquisitionCostJpy === null) === Boolean(item.unknownAmountReason), {
    message: '設備の購入額が不明なときだけ、その理由を入力してください。',
    path: ['unknownAmountReason'],
  })

export const homeCostSchema = z
  .object({
    id: identifier,
    month,
    category: z.enum(['rent', 'electricity', 'internet']),
    amountJpy: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    unknownAmountReason: z.string().trim().min(1).max(2_000).optional(),
    method: z.enum(['area', 'area-time', 'meter', 'watt-hour', 'usage-time', 'fixed-ratio']),
    businessUseRatio: ratio,
    basis: z.string().trim().min(1).max(2_000),
    rationale: z.string().trim().min(1).max(2_000),
    taxUnitId: identifier.optional(),
    projectAllocationRatio: ratio,
    targets: allocationTargetsSchema.optional(),
    treatment: z.enum(['direct', 'shared', 'general']),
    evidenceIds,
  })
  .refine((item) => (item.amountJpy === null) === Boolean(item.unknownAmountReason), {
    message: '自宅費用の金額が不明なときだけ、その理由を入力してください。',
    path: ['unknownAmountReason'],
  })

export const directCostSchema = z
  .object({
    id: identifier,
    targets: allocationTargetsSchema.optional(),
    taxUnitId: identifier.optional(),
    incurredOn: date,
    costType: z.enum([
      'outsource',
      'material',
      'cloud',
      'domain',
      'license',
      'old-version-balance',
      'other',
    ]),
    amountJpy: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    unknownAmountReason: z.string().trim().min(1).max(2_000).optional(),
    directlyAttributable: z.boolean(),
    treatment: z.enum(['direct', 'shared', 'general']),
    note: z.string().trim().max(2_000).optional(),
    evidenceIds,
  })
  .refine((item) => (item.amountJpy === null) === Boolean(item.unknownAmountReason), {
    message: '直接費の金額が不明なときだけ、その理由を入力してください。',
    path: ['unknownAmountReason'],
  })

const chargeUsageSelectorSchema = z
  .object({
    sourceId: identifier,
    projectKey: identifier.optional(),
    sessionKey: identifier.optional(),
    startedOn: contractDateSchema.optional(),
    endedOn: contractDateSchema.optional(),
  })
  .strict()
  .refine((row) => !row.startedOn || !row.endedOn || row.startedOn <= row.endedOn, {
    message: '履歴範囲の終了日は開始日以降にしてください。',
  })

export const chargeUsageScopeSchema = z
  .object({
    kind: z.enum(['all', 'selected']),
    selectors: z.array(chargeUsageSelectorSchema).max(1000),
    unobservedRatio: z.number().min(0).max(0.95).nullable(),
    reason: z.string().trim().max(2000),
    independentSourceIds: z.array(identifier).max(100).optional(),
  })
  .strict()

const providerChargePeriodBaseSchema = z
  .object({
    id: identifier,
    provider: z.enum(['claude', 'codex']),
    planName: z.string().trim().max(160),
    serviceStartedOn: contractDateSchema,
    serviceEndedOn: contractDateSchema,
    billedOn: contractDateSchema.optional(),
    amountJpy: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    unknownAmountReason: z.string().trim().min(1).max(2000).optional(),
    note: z.string().trim().max(1000).optional(),
    evidenceIds: z
      .array(identifier)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, '根拠の重複を除いてください。')
      .optional(),
  })
  .strict()
  .refine((period) => period.serviceStartedOn <= period.serviceEndedOn, {
    message: '利用終了日は開始日以降にしてください。',
  })
  .refine((period) => (period.amountJpy === null) === Boolean(period.unknownAmountReason), {
    message: '請求額が不明なときだけ、その理由を入力してください。',
    path: ['unknownAmountReason'],
  })

export const providerChargePeriodSchema = providerChargePeriodBaseSchema.safeExtend({
  contractConfirmation: z
    .object({
      reference: z.string().trim().max(160),
      reason: z.string().trim().max(2000),
      confirmedAt: z.string().datetime().optional(),
      basis: providerChargePeriodBaseSchema,
      usageScope: chargeUsageScopeSchema.optional(),
    })
    .strict()
    .refine((record) => !record.confirmedAt || Boolean(record.reference && record.reason), {
      message: '契約との対応を確認するには、契約の呼び名と理由を入力してください。',
    })
    .optional(),
})
