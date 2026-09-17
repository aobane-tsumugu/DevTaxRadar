import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { adjustmentBalanceLinkIssues, type AdjustmentCostContext } from '../../src/core/adjustmentBalanceLinks.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import type { SourceAdjustmentRecord } from '../../src/core/sourceAdjustments.js'

function fixture() {
  const refund: SourceAdjustmentRecord = {
    id: 'refund-a', sourceId: 'direct:a', sourceYear: 2026,
    sourceBasis: { kind: 'direct', originalAmountJpy: 1000 },
    kind: 'refund', amountJpy: -100, occurredOn: '2026-08-01', recordedAt: '2026-08-01T00:00:00Z',
    effect: 'balance-reduction', balanceMovementId: 'reduce', reason: '受領した返金を対応原価から減少', evidenceIds: ['receipt'],
  }
  const balances: BalanceSnapshot = {
    version: 1,
    accounts: [{ id: 'a', taxUnitId: 'u', kind: 'asset', name: '合成資産', openingYear: 2026, opening: { status: 'known', amountJpy: 1000 } }],
    movements: [{ id: 'reduce', accountId: 'a', kind: 'reduction', occurredOn: '2026-08-01', amountJpy: 100, sourceIds: ['direct:a'], decisionId: 'd', reason: '本人確認済みの減少' }],
    pendingDecisions: [],
  }
  const context: AdjustmentCostContext = {
    costs: [{
      year: 2026,
      sources: [{ id: 'direct:a', kind: 'direct', label: 'A', originalAmountJpy: 1000, currency: 'JPY', evidenceIds: ['receipt'], origin: 'entered' }],
      contributions: [{ id: 'cost-a', basisId: 'basis-a', target: { kind: 'tax-unit', taxUnitId: 'u' }, amountJpy: 1000, sourceIds: ['direct:a'], reason: '合成の元原価', evidenceIds: ['receipt'] }],
    }],
    trace: { year: 2026, movements: [{ movementId: 'reduce', amountJpy: 100, lots: [{ costYear: 2026, contributionId: 'cost-a', amountJpy: 100 }], untracedJpy: 0 }] },
  }
  return { refund, balances, context }
}

function issues(f = fixture()) {
  return adjustmentBalanceLinkIssues([f.refund], f.balances, f.context).map((row) => row.message)
}

describe('refund reduction uses the actual original cost', () => {
  it('accepts the exactly traced original source without changing inputs', () => {
    const f = fixture(), before = structuredClone(f)
    assert.deepEqual(issues(f), [])
    assert.deepEqual(f, before)
  })
  it('rejects a different source even when the movement labels itself with the refund source ID', () => {
    const f = fixture()
    f.context.costs[0]!.contributions[0]!.sourceIds = ['direct:b']
    assert.match(issues(f).join(' '), /原価が返金元の費用と異なります/)
  })
  it('does not treat a mixed-source lot as entirely belonging to every source', () => {
    const f = fixture()
    f.context.costs[0]!.contributions[0]!.sourceIds = ['direct:a', 'direct:b']
    assert.match(issues(f).join(' '), /費用別金額まで特定できません/)
  })
  it('does not treat an untraced opening as verified by its evidence label', () => {
    const f = fixture()
    f.context.trace.movements[0]!.lots = []
    f.context.trace.movements[0]!.untracedJpy = 100
    assert.match(issues(f).join(' '), /原価の内訳が未確定/)
  })
  it('rejects a missing trace instead of claiming the source was verified', () => {
    const f = fixture(); f.context.trace.movements = []
    assert.match(issues(f).join(' '), /原価の内訳が未確定/)
  })
  it('rejects a trace from a different movement amount', () => {
    const f = fixture(); f.context.trace.movements[0]!.amountJpy = 99
    assert.match(issues(f).join(' '), /原価の内訳が未確定/)
  })
  for (const amount of [0, 99, 101]) it(`requires exact traced reduction, not ${amount} yen`, () => {
    const f = fixture(); f.context.trace.movements[0]!.lots[0]!.amountJpy = amount
    assert.match(issues(f).join(' '), /使用額と残高減少額が一致しません/)
  })
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) it(`does not accept malformed trace amount ${amount}`, () => {
    const f = fixture(); f.context.trace.movements[0]!.lots[0]!.amountJpy = amount
    assert.match(issues(f).join(' '), /費用別金額まで特定できません/)
  })
  it('rejects repeated references inside the traced reduction', () => {
    const f = fixture(); f.context.trace.movements[0]!.lots.push({ ...f.context.trace.movements[0]!.lots[0]! })
    assert.match(issues(f).join(' '), /費用別金額まで特定できません/)
  })
  it('accepts two known lots of the same receipt across cost years', () => {
    const f = fixture()
    f.context.costs = [...f.context.costs, { ...structuredClone(f.context.costs[0]!), year: 2025 }]
    f.context.trace.movements[0]!.lots = [
      { costYear: 2025, contributionId: 'cost-a', amountJpy: 40 },
      { costYear: 2026, contributionId: 'cost-a', amountJpy: 60 },
    ]
    assert.deepEqual(issues(f), [])
  })
  it('uses year and contribution ID together; a matching ID in another year is not sufficient', () => {
    const f = fixture(); f.context.trace.movements[0]!.lots[0]!.costYear = 2025
    assert.match(issues(f).join(' '), /費用別金額まで特定できません/)
  })
  it('rejects changed original receipt amounts', () => {
    const f = fixture(); f.context.costs[0]!.sources[0]!.originalAmountJpy = 999
    assert.match(issues(f).join(' '), /原額・期間・契約が現在の元費用と異なります/)
  })
  it('rejects changed service periods', () => {
    const f = fixture()
    f.refund.sourceBasis.servicePeriod = { startedOn: '2026-01-01', endedOn: '2026-01-31' }
    assert.match(issues(f).join(' '), /原額・期間・契約が現在の元費用と異なります/)
  })
  it('rejects a source missing from the referenced year', () => {
    const f = fixture(); f.refund.sourceYear = 2025
    assert.match(issues(f).join(' '), /参照年の資料で確認できません/)
  })
  it('does not stop an earlier year for a future refund', () => {
    const f = fixture(); f.refund.occurredOn = '2027-01-01'; f.balances.movements = []
    assert.deepEqual(issues(f), [])
  })
  it('does not demand a reduction for an undetermined refund', () => {
    const f = fixture(); f.refund.effect = 'undetermined'; delete f.refund.balanceMovementId
    f.balances.movements = []; f.context.trace.movements = []
    assert.deepEqual(issues(f), [])
  })
  it('does not double-deduct a refund already selected as original-cost correction', () => {
    const f = fixture(); f.refund.effect = 'restate-original-cost'; delete f.refund.balanceMovementId
    f.balances.movements = []; f.context.trace.movements = []
    assert.deepEqual(issues(f), [])
  })
  it('preserves draft metadata-only checks when no lot calculation was supplied', () => {
    const f = fixture()
    assert.deepEqual(adjustmentBalanceLinkIssues([f.refund], f.balances), [])
    f.balances.movements[0]!.amountJpy = 99
    assert.match(adjustmentBalanceLinkIssues([f.refund], f.balances).map((row) => row.message).join(' '), /残高減少額が一致しません/)
  })
  it('still rejects two refunds tied to one reduction', () => {
    const f = fixture()
    const result = adjustmentBalanceLinkIssues([f.refund, { ...f.refund, id: 'refund-b' }], f.balances, f.context)
    assert.equal(result.filter((row) => row.message.includes('重複して対応')).length, 2)
  })
  it('does not stop this refund for an unrelated untraced movement', () => {
    const f = fixture()
    f.context.trace.movements.push({ movementId: 'unrelated', amountJpy: 999, lots: [], untracedJpy: 999 })
    assert.deepEqual(issues(f), [])
  })
})
