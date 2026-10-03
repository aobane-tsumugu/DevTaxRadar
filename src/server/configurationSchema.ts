import { providerChargePeriodSchema } from '../planning/chargeRecords.js'
export { chargeUsageScopeSchema } from '../planning/chargeRecords.js'
import { z } from 'zod'
import { validIsoCalendarDate } from '../core/chargePeriods.js'

const contractDateSchema = z.string().refine(validIsoCalendarDate, {
  message: '実在する日付を YYYY-MM-DD で入力してください。',
})

const providerContractSchema = z
  .object({
    startedOn: contractDateSchema.optional(),
    endedOn: contractDateSchema.optional(),
  })
  .strict()
  .refine(
    (contract) =>
      !contract.startedOn || !contract.endedOn || contract.startedOn <= contract.endedOn,
    { message: '契約終了日は開始日以降にしてください。' },
  )

export const configurationSchema = z
  .object({
    charges: z.object({
      claude: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
      codex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    }),
    unknownChargeReasons: z
      .object({
        claude: z.string().trim().min(1).max(2000).optional(),
        codex: z.string().trim().min(1).max(2000).optional(),
      })
      .strict()
      .optional(),
    monthlyCharges: z
      .array(
        z.object({
          provider: z.enum(['claude', 'codex']),
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          amountJpy: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
          unknownAmountReason: z.string().trim().min(1).max(2000).optional(),
        }),
      )
      .max(240)
      .default([]),
    contracts: z
      .object({ claude: providerContractSchema, codex: providerContractSchema })
      .strict()
      .default({ claude: {}, codex: {} }),
    chargePeriods: z.array(providerChargePeriodSchema).max(1000).optional(),
    unobservedRatio: z.number().min(0).max(0.95).nullable(),
  })
  .strict()
  .superRefine((configuration, context) => {
    for (const provider of ['claude', 'codex'] as const) {
      if (
        (configuration.charges[provider] === null) !==
        Boolean(configuration.unknownChargeReasons?.[provider])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['unknownChargeReasons', provider],
          message: '既定月額が不明の場合だけ、その理由を入力してください。',
        })
      }
    }
    const chargeKeys = new Set<string>()
    configuration.monthlyCharges.forEach((charge, index) => {
      if ((charge.amountJpy === null) !== Boolean(charge.unknownAmountReason)) {
        context.addIssue({
          code: 'custom',
          path: ['monthlyCharges', index, 'unknownAmountReason'],
          message: '料金不明の場合だけ、その理由を入力してください。',
        })
      }
      const key = `${charge.provider}:${charge.month}`
      if (chargeKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['monthlyCharges', index],
          message: 'Providerと月の組合せが重複しています。',
        })
      }
      chargeKeys.add(key)
    })
    const periodIds = new Set<string>()
    configuration.chargePeriods?.forEach((period, index) => {
      if (periodIds.has(period.id)) {
        context.addIssue({
          code: 'custom',
          path: ['chargePeriods', index, 'id'],
          message: '請求履歴のIDが重複しています。',
        })
      }
      periodIds.add(period.id)
    })
  })
