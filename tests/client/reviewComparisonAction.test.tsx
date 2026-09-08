// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import ReviewComparisonAction from '../../src/client/pages/ReviewComparisonAction'
import { getReviewComparison } from '../../src/client/api'
import type { ReviewComparison } from '../../src/core/reviewComparison'
vi.mock('../../src/client/api', () => ({ getReviewComparison: vi.fn() }))
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
const fixture = (): ReviewComparison => ({
  engineVersion: 'review-comparison/1',
  reviewId: 'old',
  year: 2026,
  beforeDraftRevision: 1,
  currentDraftRevision: 2,
  currentWorkspaceRevision: 3,
  currentPreviewHash: 'hash',
  currentReviewId: 'old',
  previousReviewChanged: false,
  materialCoverage: 'both',
  changes: [
    {
      path: ['balanceInputs', 'movements', 'm', 'reason'],
      operation: 'changed',
      before: '元の根拠',
      after: '変更後の根拠',
    },
  ],
  balanceImpact: [],
})
it('compares only on request and reports a non-monetary change rather than claiming identical contents', async () => {
  vi.mocked(getReviewComparison).mockResolvedValue(fixture())
  await act(async () => root.render(<ReviewComparisonAction reviewId="old" year={2026} />))
  expect(getReviewComparison).not.toHaveBeenCalled()
  await act(async () => node.querySelector('button')!.click())
  expect(getReviewComparison).toHaveBeenCalledWith('old')
  expect(node.textContent).toContain('理由・根拠')
  expect(node.textContent).toContain('変更後の根拠')
  expect(node.textContent).toContain('未保存入力は含みません')
  expect(node.textContent).not.toContain('内容の差はありません')
  vi.mocked(getReviewComparison).mockRejectedValue(new Error('接続失敗'))
  await act(async () => node.querySelector('button')!.click())
  expect(node.textContent).toContain('差がないと確認した状態ではありません')
  expect(node.textContent).not.toContain('変更後の根拠')
})
it('drops old in-flight results when the selected record changes and rejects wrong result identities', async () => {
  let resolve!: (value: ReviewComparison) => void
  vi.mocked(getReviewComparison).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  await act(async () => root.render(<ReviewComparisonAction reviewId="old" year={2026} />))
  await act(async () => node.querySelector('button')!.click())
  await act(async () => root.render(<ReviewComparisonAction reviewId="new" year={2027} />))
  await act(async () => resolve(fixture()))
  expect(node.textContent).not.toContain('変更後の根拠')
  vi.mocked(getReviewComparison).mockResolvedValue(fixture())
  await act(async () => node.querySelector('button')!.click())
  expect(node.textContent).toContain('対象の保存版と比較結果が一致しません')
  expect(node.querySelector('button')!.disabled).toBe(false)
})
