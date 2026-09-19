import { z } from 'zod'
import { equipmentDepreciationInputSchema } from '../core/equipmentDepreciation.js'
export {
  allocationTargetsSchema as equipmentTargetsSchema,
  type AllocationTarget as EquipmentTarget,
} from './allocationTargets.js'
import { allocationTargetsSchema as equipmentTargetsSchema } from './allocationTargets.js'
export const equipmentMethodSchema = equipmentDepreciationInputSchema
  .pick({
    equipmentId: true,
    taxYear: true,
    taxpayer: true,
    assetKind: true,
    method: true,
    rentalUse: true,
    methodReason: true,
    usefulLifeYears: true,
    useThroughYearEnd: true,
    ordinaryTreatment: true,
    priorClosing: true,
  })
  .extend({
    id: z.string().trim().min(1).max(120),
    recordedAt: z.string().datetime({ offset: true }),
    priorReviewId: z.string().uuid().optional(),
    allocation: z
      .object({
        businessUseRatio: z.number().min(0).max(1).nullable(),
        projectAllocationRatio: z.number().min(0).max(1).nullable(),
        taxUnitId: z.string().trim().min(1).max(120).nullable().optional(),
        targets: equipmentTargetsSchema.optional(),
        reason: z.string().max(2000),
      })
      .strict()
      .optional(),
  })
  .strict()
export const equipmentMethodsSchema = z
  .array(equipmentMethodSchema)
  .max(1000)
  .superRefine((rows, ctx) => {
    const ids = new Set<string>(),
      keys = new Set<string>()
    rows.forEach((row, index) => {
      const key = `${row.taxYear}:${row.equipmentId}`
      if (ids.has(row.id) || keys.has(key))
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: '設備の同年度の計算条件またはIDが重複しています。',
        })
      ids.add(row.id)
      keys.add(key)
    })
  })
export type EquipmentAnnualMethod = z.infer<typeof equipmentMethodSchema>
