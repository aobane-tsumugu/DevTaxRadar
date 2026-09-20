import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace.js'
import { softwareMethodMarkdown } from '../../src/core/softwareMethodExport.js'
function saved(): BalanceReview {
  return { year: 2026, snapshot: { accounts: [{ id: 'asset', name: '合成ソフト', softwareMethod: {
    method: 'straight-line', engineVersion: 'annual-method-comparison/2', acquisitionMovementId: 'acquired',
    usedOn: '2026-07-01', usefulLifeYears: 5, reason: '保存時の選択', evidenceIds: ['proof'],
  } }], movements: [{ id: 'acquired', kind: 'transfer', amountJpy: 120000 },
    { id: 'expense', kind: 'expense', accountId: 'asset', amountJpy: 12000, decisionId: 'confirmed-2026',
      softwareExpense: { year: 2026 }, balanceAllocations: [{ costAllocations: [
        { costYear: 2025, contributionId: 'part-2025', amountJpy: 6000 },
        { costYear: 2026, contributionId: 'part-2026', amountJpy: 6000 } ] }] }],
  } } as unknown as BalanceReview
}
describe('C03 saved-method rendering without live inputs', () => {
  it('renders stored acquisition, actual expense and both cost years without recalculation', () => {
    const review = saved(), before = structuredClone(review), result = softwareMethodMarkdown(review)
    for (const token of ['120,000円', '12,000円', '2025年 / part-2025 / 使用額 6,000円', '2026年 / part-2026 / 使用額 6,000円', 'confirmed-2026']) assert.ok(result.includes(token), token)
    assert.deepEqual(review, before)
  })
  it('renders the frozen blue-special election conditions without a live recalculation', () => {
    const review = saved(), method = review.snapshot.accounts[0]!.softwareMethod!
    method.method = 'blue-special'; method.usefulLifeYears = null; method.roundingConfirmed = false
    method.blueSpecial = { version: 1, ruleVersion: '2026-09-19', filingType: 'blue', incomeCategory: 'business',
      eligibleSmallBusiness: true, annualSpecialUsedJpy: 400000, businessMonths: 12, statementReady: true }
    const result = softwareMethodMarkdown(review)
    assert.ok(result.includes('青色申告の少額資産特例'))
    assert.ok(result.includes('他資産使用済額 400,000円'))
    assert.ok(result.includes('事業月数 12'))
  })
  it('adds nothing to an old record without method metadata', () => {
    const review = saved(); delete review.snapshot.accounts[0]!.softwareMethod
    assert.equal(softwareMethodMarkdown(review), '')
  })
  it('does not infer a zero or an unrecorded annual posting', () => {
    const review = saved(); review.snapshot.movements = review.snapshot.movements.filter((row) => row.kind !== 'expense')
    const result = softwareMethodMarkdown(review)
    assert.ok(result.includes('費用化は未収録')); assert.ok(!result.includes('記録した年額:'))
  })
  it('omits later actual postings from an earlier selected year', () => {
    const review = saved(), future = structuredClone(review.snapshot.movements[1]!)
    future.id = 'future'; future.softwareExpense!.year = 2027; future.amountJpy = 24000; review.snapshot.movements.push(future)
    assert.ok(!softwareMethodMarkdown(review).includes('2027年'))
  })
  it('renders termination separately from unchanged old amounts', () => {
    const review = saved(), method = review.snapshot.accounts[0]!.softwareMethod!
    method.ordinaryThroughYear = 2026; method.terminationReason = '別処理へ'
    const result = softwareMethodMarkdown(review)
    assert.ok(result.includes('通常計算の最終年: 2026')); assert.ok(result.includes('12,000円'))
  })
  it('escapes arbitrary notes and preserves missing acquisition origin as missing', () => {
    const review = saved(); review.snapshot.accounts[0]!.name = '<script>bad</script>'
    review.snapshot.accounts[0]!.softwareMethod!.reason = '[untrusted](example)\n# text'
    review.snapshot.movements = review.snapshot.movements.filter((row) => row.id !== 'acquired')
    const result = softwareMethodMarkdown(review)
    assert.ok(result.includes('対応元未収録')); assert.ok(!result.includes('<script>'))
    assert.ok(result.includes('\\[untrusted\\]')); assert.ok(!result.includes('\n# text'))
  })
})
