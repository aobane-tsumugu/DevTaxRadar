import { describe, expect, it } from 'vitest'
import type { BalancePreview, BalanceReview } from '../../src/accounting/balanceWorkspace.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { buildAnnualBalances } from '../../src/core/annualBalances.js'
import { compareReview } from '../../src/core/reviewComparison.js'

function fixture() {
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'a',
        name: '制作中',
        taxUnitId: 'u',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'unknown', amountJpy: null, reasons: ['資料確認待ち'] },
      },
      {
        id: 'b',
        name: '前払',
        taxUnitId: 'u',
        kind: 'prepaid',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    movements: [],
    pendingDecisions: [],
  }
  const projection = buildAnnualBalances(snapshot, 2026)
  const stored: BalanceReview = {
    schemaVersion: 1,
    engineVersion: 'annual-balances/1',
    id: 'r',
    year: 2026,
    createdAt: '2026-01-01T00:00:00Z',
    draftRevision: 1,
    correctsReviewId: null,
    previousReviewId: null,
    reason: '確認',
    snapshot: structuredClone(snapshot),
    projection: structuredClone(projection),
  }
  const current: BalancePreview = {
    draftRevision: 2,
    currentReviewId: 'r',
    previousReviewId: null,
    projectionHash: 'current',
    projection,
  }
  return { snapshot, stored, current }
}
describe('stored and current review comparison', () => {
  it('ignores record order and revision-only changes while keeping missing materials explicit', () => {
    const { snapshot, stored, current } = fixture()
    snapshot.accounts.reverse()
    current.projection.accounts.reverse()
    expect(compareReview(stored, current, snapshot)).toMatchObject({
      changes: [],
      materialCoverage: 'neither',
      currentDraftRevision: 2,
    })
  })
  it('reports reasons and unknown-to-zero transitions without treating absence as zero', () => {
    const { snapshot, stored, current } = fixture()
    snapshot.accounts[0]!.opening = { status: 'known', amountJpy: 0 }
    snapshot.accounts.splice(1, 1)
    current.projection = buildAnnualBalances(snapshot, 2026)
    const result = compareReview(stored, current, snapshot)
    expect(result.balanceImpact.find((row) => row.accountId === 'a')!.closing.deltaJpy).toBeNull()
    expect(result.balanceImpact.find((row) => row.accountId === 'b')!.closing.after).toBeNull()
    expect(result.changes).toContainEqual({
      path: ['balanceInputs', 'accounts', 'a', 'opening', 'amountJpy'],
      operation: 'changed',
      before: null,
      after: 0,
    })
    expect(result.changes).toContainEqual({
      path: ['balanceInputs', 'accounts', 'a', 'opening', 'reasons'],
      operation: 'removed',
      before: ['資料確認待ち'],
    })
    expect(result.changes).toContainEqual({
      path: ['balanceInputs', 'accounts', 'b'],
      operation: 'removed',
      before: stored.snapshot.accounts[1],
    })
    expect(stored.snapshot.accounts).toHaveLength(2)
  })
  it('reports changed predecessor separately and rejects comparing different years', () => {
    const { snapshot, stored, current } = fixture()
    current.previousReviewId = 'corrected-prior'
    expect(compareReview(stored, current, snapshot).previousReviewChanged).toBe(true)
    current.projection = buildAnnualBalances(snapshot, 2027)
    expect(() => compareReview(stored, current, snapshot)).toThrow(/同じ対象年/)
  })
})
