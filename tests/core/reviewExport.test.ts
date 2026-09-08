import { describe, expect, it } from 'vitest'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace.js'
import { buildAnnualBalances } from '../../src/core/annualBalances.js'
import { reviewExportJson, reviewExportMarkdown } from '../../src/core/reviewExport.js'

function fixture(): BalanceReview {
  const snapshot = {
    version: 1 as const,
    accounts: [
      {
        id: 'a',
        name: '確認中の資産',
        taxUnitId: 'u',
        kind: 'asset' as const,
        openingYear: 2026,
        opening: { status: 'unknown' as const, amountJpy: null, reasons: ['前年資料を確認中'] },
      },
    ],
    movements: [],
    pendingDecisions: [],
  }
  return {
    schemaVersion: 1,
    engineVersion: 'annual-balances/1',
    id: 'legacy-id',
    createdAt: '2026-01-01T00:00:00Z',
    year: 2026,
    draftRevision: 2,
    correctsReviewId: 'older-id',
    previousReviewId: 'previous-year',
    reason: '記録の訂正理由',
    snapshot,
    projection: buildAnnualBalances(snapshot, 2026),
  }
}
describe('stored review exports', () => {
  it('keeps the entire stored record and unknown amounts without filling legacy gaps', () => {
    const review = fixture()
    expect(JSON.parse(reviewExportJson(review))).toEqual({
      exportVersion: 1,
      kind: 'stored-year-review',
      review,
    })
    const markdown = reviewExportMarkdown(review)
    expect(markdown).toContain('この保存版には原価追跡が未収録です。現在の入力から補完しません。')
    expect(markdown).toContain('期末: 不明（前年資料を確認中）')
    expect(markdown).toContain('訂正元の資料ID: older-id')
    expect(markdown).toContain('前年の資料ID: previous-year')
    expect(markdown).toContain('当時の費用・判断・利用量は含まれません')
    expect(markdown).not.toContain('期末: 0円')
    expect(markdown).toContain(
      'この保存版には照合結果が未収録です。現在の入力から再計算・補完しません。',
    )
    expect(markdown).toContain(reviewExportJson(review).trim())
  })
  it('keeps user text inside escaped prose and a fence longer than any embedded backticks', () => {
    const review = fixture()
    review.reason = '```\n# forged\n<img src=x>\n````'
    const original = structuredClone(review)
    const markdown = reviewExportMarkdown(review)
    expect(markdown).toContain('`````json\n')
    expect(markdown).not.toMatch(/^# forged$/m)
    expect(markdown).not.toMatch(/^<img src=x>$/m)
    const encoded = markdown.split('`````json\n')[1]!.split('\n`````')[0]!
    expect(JSON.parse(encoded).review).toEqual(review)
    expect(review).toEqual(original)
  })
})
