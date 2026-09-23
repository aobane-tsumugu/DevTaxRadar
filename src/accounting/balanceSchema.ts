import { z } from 'zod'
import type { BalanceSnapshot } from './types.js'
import {
  validateSoftwareMethod,
  validateSoftwareExpense,
  type SoftwareMethod,
  type SoftwareExpense,
} from '../core/softwareMethod.js'

const softwareMethodSchema = z.custom<SoftwareMethod>(
  (value) => {
    try {
      validateSoftwareMethod(value)
      return true
    } catch {
      return false
    }
  },
  { message: 'ソフトウェアの方法・取得原価・根拠の形式を確認してください。' },
)
const softwareExpenseSchema = z.custom<SoftwareExpense>(
  (value) => {
    try {
      validateSoftwareExpense(value)
      return true
    } catch {
      return false
    }
  },
  { message: 'ソフトウェアの年額確認記録を確認してください。' },
)

const id = z.string().trim().min(1).max(200)
const note = z.string().trim().min(1).max(2000)
const yen = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const balanceYearSchema = z.number().int().min(1900).max(9999)
const consultationAnswersSchema = z
  .array(
    z
      .object({
        id,
        taxYear: balanceYearSchema,
        receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        kind: z.enum(['fact', 'method']),
        answer: note,
        source: note,
      })
      .strict(),
  )
  .max(100)
  .optional()
const amount = z.discriminatedUnion('status', [
  z.object({ status: z.literal('known'), amountJpy: yen }).strict(),
  z
    .object({
      status: z.literal('unknown'),
      amountJpy: z.null(),
      reasons: z.array(note).min(1).max(100),
    })
    .strict(),
])
const movement = {
  id,
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountJpy: yen,
  sourceIds: z.array(id).min(1).max(100),
  decisionId: id,
  reason: note,
  softwareExpense: softwareExpenseSchema.optional(),
  balanceAllocations: z
    .array(
      z
        .object({
          sourceKind: z.enum(['opening', 'movement']),
          sourceId: id,
          amountJpy: yen,
          costAllocations: z
            .array(
              z
                .object({ costYear: balanceYearSchema, contributionId: id, amountJpy: yen })
                .strict(),
            )
            .max(100)
            .optional(),
        })
        .strict(),
    )
    .max(100)
    .optional(),
}
export const balanceSnapshotSchema: z.ZodType<BalanceSnapshot> = z
  .object({
    version: z.literal(1),
    accounts: z
      .array(
        z
          .object({
            id,
            taxUnitId: id,
            name: note,
            kind: z.enum(['construction', 'asset', 'prepaid']),
            openingYear: balanceYearSchema,
            opening: amount,
            openingRevisionId: id.optional(),
            softwareMethod: softwareMethodSchema.nullable().optional(),
          })
          .strict(),
      )
      .max(2000),
    movements: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              ...movement,
              kind: z.literal('addition'),
              accountId: id,
              costAllocations: z
                .array(
                  z
                    .object({
                      costYear: balanceYearSchema,
                      contributionId: z.string().trim().min(1).max(500),
                      amountJpy: yen,
                    })
                    .strict(),
                )
                .max(100)
                .optional(),
            })
            .strict(),
          z.object({ ...movement, kind: z.literal('expense'), accountId: id }).strict(),
          z.object({ ...movement, kind: z.literal('reduction'), accountId: id }).strict(),
          z
            .object({
              ...movement,
              kind: z.literal('transfer'),
              fromAccountId: id,
              toAccountId: id,
            })
            .strict(),
        ]),
      )
      .max(10000),
    pendingDecisions: z
      .array(
        z
          .object({
            id,
            taxUnitId: id,
            taxYear: balanceYearSchema,
            amount,
            accountIds: z.array(id).max(100),
            answers: consultationAnswersSchema,
            resolution: z
              .object({
                taxYear: balanceYearSchema,
                decisionId: id,
                reason: note,
                answerBasis: consultationAnswersSchema,
                questionBasis: z
                  .object({
                    pendingId: id,
                    taxUnitId: id,
                    taxYear: balanceYearSchema,
                    amount,
                    accountIds: z.array(id).max(100),
                    reasons: z.array(note).min(1).max(100),
                    sourceIds: z.array(id).min(1).max(100),
                    resolutionYear: balanceYearSchema,
                    decisionId: id,
                    resolutionReason: note,
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .optional(),
            reasons: z.array(note).min(1).max(100),
            sourceIds: z.array(id).min(1).max(100),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict()
export const balanceDraftSaveSchema = z
  .object({
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    requestId: z.string().uuid().optional(),
    snapshot: balanceSnapshotSchema,
  })
  .strict()
