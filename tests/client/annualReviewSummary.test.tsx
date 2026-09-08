// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AnnualReviewSummary from '../../src/client/pages/AnnualReviewSummary'
import * as api from '../../src/client/api'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace'
import type { BalanceSnapshot } from '../../src/accounting/types'
import { buildAnnualBalances } from '../../src/core/annualBalances'
vi.mock('../../src/client/api', () => ({ getBalanceReviews: vi.fn(), getBalanceReview: vi.fn() }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
let node: HTMLDivElement, root: Root
beforeEach(() => {
  vi.resetAllMocks()
  node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
})
afterEach(async () => {
  await act(async () => root.unmount())
  node.remove()
})
function fixture(): BalanceReview {
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'a',
        taxUnitId: 'u',
        name: '合成資産',
        kind: 'asset',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 100 },
      },
      {
        id: 'b',
        taxUnitId: 'u',
        name: '未確認原価',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'unknown', amountJpy: null, reasons: ['前年資料を確認中'] },
      },
    ],
    movements: [
      {
        id: 'm',
        kind: 'expense',
        accountId: 'a',
        occurredOn: '2026-01-01',
        amountJpy: 10,
        sourceIds: ['s'],
        decisionId: 'd',
        reason: '合成',
      },
    ],
    pendingDecisions: [],
  }
  return {
    schemaVersion: 1,
    engineVersion: 'annual-balances/1',
    id: 'saved',
    year: 2026,
    createdAt: '2026-09-08T00:00:00Z',
    draftRevision: 1,
    previousReviewId: null,
    correctsReviewId: null,
    reason: '<script>当時の理由',
    snapshot,
    projection: buildAnnualBalances(snapshot, 2026),
  }
}
it('shows the adopted year, unknown balances and correction alert, with a route to the records', async () => {
  vi.mocked(api.getBalanceReviews).mockResolvedValue({
    reviews: [
      { id: 'other', year: 2025, active: true, previousYearChanged: false },
      { id: 'saved', year: 2026, active: true, previousYearChanged: true },
    ],
  })
  vi.mocked(api.getBalanceReview).mockResolvedValue({ review: fixture() })
  const open = vi.fn()
  await act(async () =>
    root.render(<AnnualReviewSummary year={2026} local onOpenBalances={open} />),
  )
  expect(api.getBalanceReview).toHaveBeenCalledWith('saved')
  expect(node.textContent).toContain('￥10')
  expect(node.textContent).toContain('￥90')
  expect(node.textContent).toContain('1件（既知額に含めない）')
  expect(node.textContent).toContain('前年資料が訂正されています')
  expect(node.querySelector('script')).toBeNull()
  await act(async () =>
    [...node.querySelectorAll('button')].find((b) => b.textContent?.includes('差分'))!.click(),
  )
  expect(open).toHaveBeenCalledOnce()
})
it('keeps no record, failed reads and demo mode distinct from zero amounts', async () => {
  vi.mocked(api.getBalanceReviews).mockResolvedValue({ reviews: [] })
  await act(async () =>
    root.render(<AnnualReviewSummary year={2026} local onOpenBalances={() => {}} />),
  )
  expect(node.textContent).toContain('採用済み年度資料はありません')
  expect(node.textContent).not.toContain('￥0')
  vi.mocked(api.getBalanceReviews).mockRejectedValue(new Error('接続失敗'))
  await act(async () => node.querySelector('button')!.click())
  expect(node.textContent).toContain('資料を取得できませんでした')
  expect(node.textContent).not.toContain('採用済み年度資料はありません')
  vi.mocked(api.getBalanceReviews).mockClear()
  await act(async () =>
    root.render(<AnnualReviewSummary year={2027} local={false} onOpenBalances={() => {}} />),
  )
  expect(node.textContent).toBe('')
  expect(api.getBalanceReviews).not.toHaveBeenCalled()
})
it('discards late results for a previous year and rejects a mismatched fetched record', async () => {
  let resolve!: (value: { review: BalanceReview }) => void
  vi.mocked(api.getBalanceReviews)
    .mockResolvedValueOnce({
      reviews: [{ id: 'saved', year: 2026, active: true, previousYearChanged: false }],
    })
    .mockResolvedValue({ reviews: [] })
  vi.mocked(api.getBalanceReview).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  await act(async () =>
    root.render(<AnnualReviewSummary year={2026} local onOpenBalances={() => {}} />),
  )
  await act(async () =>
    root.render(<AnnualReviewSummary year={2027} local onOpenBalances={() => {}} />),
  )
  await act(async () => resolve({ review: fixture() }))
  expect(node.textContent).not.toContain('合成資産')
  expect(node.textContent).toContain('2027年')
  vi.mocked(api.getBalanceReviews).mockResolvedValue({
    reviews: [{ id: 'saved', year: 2027, active: true, previousYearChanged: false }],
  })
  vi.mocked(api.getBalanceReview).mockResolvedValue({ review: fixture() })
  await act(async () => node.querySelector('button')!.click())
  expect(node.textContent).toContain('対象年と取得した資料が一致しません')
})
