import { z } from 'zod'
export const allocationTargetsSchema = z
  .array(
    z
      .object({
        taxUnitId: z.string().trim().min(1).max(120),
        shareBps: z.number().int().min(0).max(10000).nullable(),
      })
      .strict(),
  )
  .max(100)
  .superRefine((rows, ctx) => {
    if (new Set(rows.map((row) => row.taxUnitId)).size !== rows.length)
      ctx.addIssue({ code: 'custom', message: '同じ制作物への配分を重複登録できません。' })
    if (rows.reduce((sum, row) => sum + (row.shareBps ?? 0), 0) > 10000)
      ctx.addIssue({
        code: 'custom',
        message: '制作物への配分割合の合計は100%以内にしてください。',
      })
  })
export type AllocationTarget = z.infer<typeof allocationTargetsSchema>[number]
