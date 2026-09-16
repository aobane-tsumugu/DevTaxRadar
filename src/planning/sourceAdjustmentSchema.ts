import { z } from 'zod'
import { validateSourceAdjustments, type SourceAdjustmentRecord } from '../core/sourceAdjustments.js'

/** One adapter for the same manual/import/database validation, without silent field stripping. */
export const sourceAdjustmentsSchema: z.ZodType<SourceAdjustmentRecord[]> = z.unknown().transform((value, context) => {
  try {
    validateSourceAdjustments(value)
    return structuredClone(value)
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '返金・訂正の入力形式を確認してください。' })
    return z.NEVER
  }
})
