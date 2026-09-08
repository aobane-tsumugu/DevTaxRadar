// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import {
  readReviewAttempts,
  writeReviewAttempt,
  removeReviewAttempt,
  type ReviewAttempt,
} from '../../src/client/reviewRecovery'
afterEach(() => localStorage.clear())
it('isolates datasets and request IDs and retains unknown formats', () => {
  const record: ReviewAttempt = {
    version: 1,
    datasetId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    request: {
      year: 2026,
      expectedDraftRevision: 1,
      projectionHash: 'a'.repeat(64),
      idempotencyKey: crypto.randomUUID(),
      reason: '確認済み',
    },
  }
  writeReviewAttempt(localStorage, record)
  writeReviewAttempt(localStorage, record)
  const another = { ...record, request: { ...record.request, idempotencyKey: crypto.randomUUID() } }
  writeReviewAttempt(localStorage, another)
  expect(() =>
    writeReviewAttempt(localStorage, {
      ...record,
      request: { ...record.request, reason: '別内容' },
    }),
  ).toThrow()
  const unknown = `devtax:review-attempt:v1:${record.datasetId}:unknown`
  localStorage.setItem(unknown, '{"version":2}')
  expect(readReviewAttempts(localStorage, crypto.randomUUID()).records).toEqual([])
  removeReviewAttempt(localStorage, record)
  expect(readReviewAttempts(localStorage, record.datasetId)).toEqual({
    records: [another],
    unreadable: 1,
  })
  expect(localStorage.getItem(unknown)).toBe('{"version":2}')
})
