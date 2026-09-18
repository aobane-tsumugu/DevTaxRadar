import { z } from 'zod'
import { validateTreatmentDecisionBinding, type TreatmentDecisionBinding } from '../core/treatmentDecisionBinding.js'
export const treatmentDecisionBindingSchema: z.ZodType<TreatmentDecisionBinding> = z.unknown().transform((value, context) => {
  try { validateTreatmentDecisionBinding(value); return structuredClone(value) }
  catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '候補元を確認してください。' }); return z.NEVER }
})
