import { z } from 'zod'

const requestSchema = z
  .object({
    year: z.number().int().min(1900).max(9999),
    expectedDraftRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    projectionHash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()
const recordSchema = z
  .object({
    version: z.literal(1),
    datasetId: z.string().uuid(),
    createdAt: z.string().datetime(),
    request: requestSchema,
  })
  .strict()
export type ReviewAttempt = z.infer<typeof recordSchema>
const prefix = (datasetId: string) => `devtax:review-attempt:v1:${datasetId}:`
const key = (record: ReviewAttempt) => prefix(record.datasetId) + record.request.idempotencyKey

export function writeReviewAttempt(storage: Storage, record: ReviewAttempt) {
  const encoded = JSON.stringify(recordSchema.parse(record))
  const previous = storage.getItem(key(record))
  if (previous !== null && previous !== encoded)
    throw new Error('同じ保存要求の控えが異なるため送信を中止しました。')
  storage.setItem(key(record), encoded)
}

export function readReviewAttempts(storage: Storage, datasetId: string) {
  const records: ReviewAttempt[] = []
  let unreadable = 0
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index)
    if (!name?.startsWith(prefix(datasetId))) continue
    try {
      const record = recordSchema.parse(JSON.parse(storage.getItem(name)!))
      if (record.datasetId !== datasetId || key(record) !== name) throw new Error('invalid key')
      records.push(record)
    } catch {
      unreadable++
    }
  }
  return { records: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), unreadable }
}

export function removeReviewAttempt(storage: Storage, record: ReviewAttempt) {
  const raw = storage.getItem(key(record))
  if (raw === null) return
  if (raw !== JSON.stringify(recordSchema.parse(record)))
    throw new Error('控えの内容が変わっているため削除しませんでした。')
  storage.removeItem(key(record))
}
