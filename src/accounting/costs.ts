import { z } from 'zod'
import { sourceAdjustmentsSchema } from '../planning/sourceAdjustmentSchema.js'

export type ExpenseSourceKind = 'subscription' | 'equipment' | 'home' | 'direct' | 'opening-balance'
import { validIsoCalendarDate } from '../core/chargePeriods.js'

const id = z.string().trim().min(1).max(500)
const note = z.string().min(1).max(10_000)
const yen = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const date = z.string().refine(validIsoCalendarDate, '実在する日付を指定してください。')
export const costPeriodSchema = z
  .object({ startedOn: date, endedOn: date })
  .strict()
  .refine((value) => value.startedOn <= value.endedOn, '対象期間が逆転しています。')
const amount = z.discriminatedUnion('status', [
  z.object({ status: z.literal('known'), amountJpy: yen }).strict(),
  z
    .object({ status: z.literal('unknown'), amountJpy: z.null(), reasons: z.array(note).min(1) })
    .strict(),
])

/** No native paths, transcript IDs, prompt bodies or codes belong in this DTO. */
export const expenseSourceSchema = z
  .object({
    id,
    kind: z.enum(['subscription', 'equipment', 'home', 'direct', 'opening-balance']),
    label: note,
    originalAmountJpy: yen.nullable(),
    unknownOriginalAmountReasons: z.array(z.string().trim().min(1).max(10_000)).min(1).optional(),
    currency: z.literal('JPY'),
    servicePeriod: costPeriodSchema.optional(),
    billedOn: date.optional(),
    acquiredOn: date.optional(),
    incurredOn: date.optional(),
    adjustments: sourceAdjustmentsSchema.optional(),
    paidOn: date.optional(),
    contractId: id.optional(),
    evidenceIds: z.array(id),
    origin: z.enum(['entered', 'legacy-monthly', 'legacy-planning']),
  })
  .strict()
  .superRefine((source, context) => {
    for (const [index, record] of (source.adjustments ?? []).entries())
      if (record.sourceId !== source.id)
        context.addIssue({
          code: 'custom',
          path: ['adjustments', index, 'sourceId'],
          message: '返金・訂正の元費用が一致しません。',
        })
    if ((source.originalAmountJpy === null) !== Boolean(source.unknownOriginalAmountReasons))
      context.addIssue({
        code: 'custom',
        path: ['unknownOriginalAmountReasons'],
        message: '原額が不明なときだけ、その理由を指定してください。確認した0円と不明は別です。',
      })
  })

export const costBasisSchema = z
  .object({
    id,
    // Exactly one root source or a set of fully consumed parent contributions.
    sourceId: id.optional(),
    parentContributionIds: z.array(id),
    affectedTaxUnitIds: z.array(id),
    period: costPeriodSchema,
    amount,
    method: z.object({ id, version: id, explanation: note }).strict(),
    warnings: z.array(note),
  })
  .strict()

export const costTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tax-unit'), taxUnitId: id }).strict(),
  z
    .object({ kind: z.enum(['general', 'private', 'unallocated', 'unobserved', 'rounding']) })
    .strict(),
])

export const costContributionSchema = z
  .object({
    id,
    basisId: id,
    target: costTargetSchema,
    amountJpy: yen,
    reason: note,
    evidenceIds: z.array(id),
  })
  .strict()

export const costSnapshotSchema = z
  .object({
    version: z.literal(1),
    taxUnits: z.array(z.object({ id, name: note }).strict()),
    sources: z.array(expenseSourceSchema),
    bases: z.array(costBasisSchema),
    contributions: z.array(costContributionSchema),
  })
  .strict()

export type CostPeriod = z.infer<typeof costPeriodSchema>
export type ExpenseSource = z.infer<typeof expenseSourceSchema>
export type CostBasis = z.infer<typeof costBasisSchema>
export type CostTarget = z.infer<typeof costTargetSchema>
export type CostContribution = z.infer<typeof costContributionSchema>
export type CostSnapshot = z.infer<typeof costSnapshotSchema>

/** These are cost bases and their destinations, not adopted expenses or asset balances. */
export type AnnualCostProjection = {
  /** Absent in legacy/no-fact years. Reading a stored version never synthesizes it. */
  treatments?: import('../core/costTreatments.js').CostTreatmentProjection
  version: 1
  engineVersion: 'cost-projection/1'
  year: number
  sources: ExpenseSource[]
  bases: CostBasis[]
  contributions: Array<CostContribution & { sourceIds: string[]; consumedByBasisId?: string }>
  totals: {
    knownBasisJpy: number
    taxUnitJpy: number
    generalJpy: number
    privateJpy: number
    unallocatedJpy: number
    unobservedJpy: number
    roundingJpy: number
    unknownBasisIds: string[]
  }
  byTaxUnit: Array<{
    taxUnitId: string
    name: string
    amountJpy: number
    contributionIds: string[]
    unknownBasisIds: string[]
  }>
  invariantSatisfied: true
}
