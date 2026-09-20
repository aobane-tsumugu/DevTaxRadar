import { z } from 'zod'
import { validateCostTreatmentFacts, type CostTreatmentFacts } from '../core/costTreatmentFacts.js'

export const costTreatmentFactsSchema: z.ZodType<CostTreatmentFacts[]> = z.unknown().transform((value, context) => {
  try {
    validateCostTreatmentFacts(value)
    return structuredClone(value)
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '処理条件の入力形式を確認してください。' })
    return z.NEVER
  }
})
