import { z } from 'zod'
import type { PlanningSnapshot } from './types.js'

export const costPresenceSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    taxYear: z.number().int().min(2000).max(2100),
    category: z.enum(['equipment', 'home', 'direct']),
    status: z.enum(['not-applicable', 'deferred']),
    reason: z.string().trim().min(1).max(2000),
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const costPresenceRecordsSchema = z
  .array(costPresenceSchema)
  .max(1000)
  .superRefine((records, context) => {
    const ids = new Set<string>()
    const categories = new Set<string>()
    records.forEach((record, index) => {
      const category = `${record.taxYear}:${record.category}`
      if (ids.has(record.id) || categories.has(category))
        context.addIssue({
          code: 'custom',
          path: [index],
          message: '同じ年度・費用項目の確認、または確認IDが重複しています。',
        })
      ids.add(record.id)
      categories.add(category)
    })
  })

export type CostPresenceRecord = z.infer<typeof costPresenceSchema>
export type CostPresenceStatus = {
  category: CostPresenceRecord['category']
  label: string
  taxYear: number
  status: 'unreviewed' | 'has-records' | 'not-applicable' | 'deferred' | 'conflict'
  recordIds: string[]
  declaration?: CostPresenceRecord
  explanation: string
}

/** A person's annual declaration never deletes expenses, implies a zero amount, or proves tax eligibility. */
export function assessCostPresence(
  planning: PlanningSnapshot,
  input: CostPresenceRecord[],
  taxYear = planning.profile.taxYear,
): CostPresenceStatus[] {
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100)
    throw new Error('対象年を確認してください。')
  const records = costPresenceRecordsSchema.parse(input)
  const end = `${taxYear}-12-31`
  const prefix = `${taxYear}-`
  const categories = [
    {
      category: 'equipment' as const,
      label: '設備',
      recordIds: planning.equipment.filter((item) => item.acquiredOn <= end).map((item) => item.id),
    },
    {
      category: 'home' as const,
      label: '自宅費用',
      recordIds: planning.homeCosts
        .filter((item) => item.month.startsWith(prefix))
        .map((item) => item.id),
    },
    {
      category: 'direct' as const,
      label: '直接費',
      recordIds: planning.directCosts
        .filter((item) => item.incurredOn.startsWith(prefix))
        .map((item) => item.id),
    },
  ]
  return categories.map((category) => {
    const declaration = records.find(
      (record) => record.taxYear === taxYear && record.category === category.category,
    )
    const common = { ...category, taxYear, ...(declaration ? { declaration } : {}) }
    if (declaration?.status === 'not-applicable' && category.recordIds.length)
      return {
        ...common,
        status: 'conflict',
        explanation:
          '該当なしの確認と費用・設備の記録が一致しません。記録を削除せず、対象年の利用状況と確認内容を見直してください。',
      }
    if (declaration?.status === 'deferred')
      return {
        ...common,
        status: 'deferred',
        explanation:
          '確認を保留しています。登録済みの費用は保持し、該当なしや確認完了へ置き換えません。',
      }
    if (declaration?.status === 'not-applicable')
      return {
        ...common,
        status: 'not-applicable',
        explanation:
          'この年度について本人が該当なしと記録しています。税務上の適用条件を検証したものではなく、翌年度には引き継ぎません。',
      }
    if (category.recordIds.length)
      return {
        ...common,
        status: 'has-records',
        explanation:
          '対象となりうる記録があります。登録は、内容の確認完了や金額の確定を意味しません。',
      }
    return {
      ...common,
      status: 'unreviewed',
      explanation: '対象年の記録も、該当なし・保留の確認もありません。該当なしとは判断しません。',
    }
  })
}
