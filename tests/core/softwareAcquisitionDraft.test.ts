import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { DecisionRecord } from '../../src/planning/types.js'
import { buildAnnualBalances } from '../../src/core/annualBalances.js'
import { traceBalanceLots } from '../../src/core/balanceLotTrace.js'
import { checkBalanceCostProvenance } from '../../src/core/balanceCostProvenance.js'
import { draftBalanceUse } from '../../src/core/balanceUseDraft.js'
import { recordExternalOpening } from '../../src/core/externalOpening.js'
import { inspectSoftwareAcquisition, draftSoftwareAcquisition } from '../../src/core/softwareAcquisitionDraft.js'
import { fixture } from './helpers/softwareAcquisitionFixtures.js'

const requestId = 'abcdef12-3456-4789-abcd-123456789012'
function decision(year: number, id: string): DecisionRecord {
  return { id, taxUnitId: 'software', taxYear: year, engineVersion: 'manual-decision/1',
    candidate: 'software-acquisition-cost', selectedCandidate: 'software-acquisition-cost',
    status: 'confirmed', reason: '対象ソフトウェア全体の製作・完成と根拠を確認',
    createdAt: `${year}-01-01T00:00:00Z`, confirmedAt: `${year}-12-01T00:00:00Z` }
}
function prepared() {
  const f = fixture()
  f.planning.decisions = [decision(2025, 'production-2025'), decision(2026, 'production-2026'),
    decision(2026, 'complete'), decision(2027, 'expense-next')]
  const inspect = () => inspectSoftwareAcquisition(f.snapshot, f.planning, f.costs,
    f.constructionAccountId, f.occurredOn, f.openingReviews)
  const input = () => {
    const report = inspect()
    return { requestId, constructionAccountId: 'construction', toAccountId: 'asset',
      occurredOn: f.occurredOn, decisionId: 'complete', reason: '2年度の製作原価をまとめる',
      evidenceIds: ['proof'], completeCostConfirmed: true, expectedAmountJpy: report.amountJpy!,
      expectedSources: report.sources.map((row) => ({ sourceKind: row.sourceKind,
        sourceId: row.sourceId, amountJpy: row.amountJpy! })) }
  }
  return { ...f, inspect, input, original: f }
}

describe('cross-year acquisition through the actual existing flow and lot engines', () => {
  it('transfers 60000 plus 60000 once, with both year-scoped lots and no new expense', () => {
    const f = prepared(), before = structuredClone(f.snapshot)
    assert.equal(f.inspect().amountJpy, 120000)
    const next = draftSoftwareAcquisition(f.snapshot, f.planning, f.costs, f.input())
    assert.equal(next.movements.length, 3)
    const transfer = next.movements.at(-1)!
    assert.equal(transfer.kind, 'transfer')
    assert.equal(transfer.amountJpy, 120000)
    assert.deepEqual(transfer.balanceAllocations!.flatMap((link) => link.costAllocations!), [
      { costYear: 2025, contributionId: 'part', amountJpy: 60000 },
      { costYear: 2026, contributionId: 'part', amountJpy: 60000 },
    ])
    const balances = buildAnnualBalances(next, 2026)
    assert.equal(balances.accounts.find((row) => row.accountId === 'construction')!.closing.amountJpy, 0)
    assert.equal(balances.accounts.find((row) => row.accountId === 'asset')!.closing.amountJpy, 120000)
    assert.equal(balances.totals.expensesJpy, 0)
    assert.equal(balances.totals.transfersInJpy, 120000)
    assert.equal(balances.totals.transfersOutJpy, 120000)
    assert.equal(traceBalanceLots(next, f.costs, 2026).status, 'consistent')
    assert.ok(checkBalanceCostProvenance(next, f.costs, 2026).contributions.every((row) => row.claimedJpy === 60000))
    assert.deepEqual(f.snapshot, before)
  })
  it('retains the asset opening and original year lots for a later explicit expense', () => {
    const f = prepared()
    const transferred = draftSoftwareAcquisition(f.snapshot, f.planning, f.costs, f.input())
    const next = draftBalanceUse(transferred, f.planning, f.costs, {
      requestId: 'bbbcdef1-3456-4789-abcd-123456789012', sourceKind: 'movement',
      sourceId: 'balance-use:' + requestId, kind: 'expense', occurredOn: '2027-12-31',
      amountJpy: 24000, decisionId: 'expense-next', reason: '合成の確認済み費用化額',
      costAllocations: [{ costYear: 2025, contributionId: 'part', amountJpy: 12000 },
        { costYear: 2026, contributionId: 'part', amountJpy: 12000 }],
    })
    const balances = buildAnnualBalances(next, 2027)
    const asset = balances.accounts.find((row) => row.accountId === 'asset')!
    assert.equal(asset.opening.amountJpy, 120000)
    assert.equal(asset.expensesJpy, 24000)
    assert.equal(asset.closing.amountJpy, 96000)
    assert.equal(traceBalanceLots(next, f.costs, 2027).status, 'consistent')
    // 24000 is explicit synthetic input to the existing use operation, not a selected-method result.
  })
  it('replays the same ordinary movement without altering downstream uses', () => {
    const f = prepared(), input = f.input()
    const next = draftSoftwareAcquisition(f.snapshot, f.planning, f.costs, input)
    assert.deepEqual(draftSoftwareAcquisition(next, f.planning, f.costs, input), next)
    assert.throws(() => draftSoftwareAcquisition(next, f.planning, f.costs,
      { ...input, expectedAmountJpy: 60000 }), /同じ/)
    assert.throws(() => draftSoftwareAcquisition(next, f.planning, f.costs,
      { ...input, requestId: 'bbbcdef1-3456-4789-abcd-123456789012' }))
  })
  it('does not book amounts reserved by a future use a second time', () => {
    const f = prepared()
    f.snapshot.movements.push({ id: 'future-use', kind: 'expense', accountId: 'construction',
      occurredOn: '2027-01-01', amountJpy: 10000, decisionId: 'expense-next', reason: '既存の後年度使用',
      sourceIds: ['direct:2025'], balanceAllocations: [{ sourceKind: 'movement', sourceId: 'addition-2025',
        amountJpy: 10000, costAllocations: [{ costYear: 2025, contributionId: 'part', amountJpy: 10000 }] }] })
    assert.equal(f.inspect().knownSubtotalJpy, 110000)
    assert.equal(f.inspect().amountJpy, null)
    assert.equal(f.inspect().status, 'needs-review')
    assert.ok(f.inspect().unresolved.some((message) => message.includes('後日付')))
    assert.throws(() => draftSoftwareAcquisition(f.snapshot, f.planning, f.costs,
      { ...f.input(), expectedAmountJpy: 110000 }))
  })
  it('blocks double claimed source costs through the actual provenance engine', () => {
    const f = prepared()
    f.snapshot.movements.push({ ...f.snapshot.movements[0]!, id: 'duplicate-addition' })
    assert.throws(() => f.inspect(), /不整合/)
  })
  it('does not label untraced or unknown stock as a complete software cost', () => {
    const f = prepared()
    const addition = f.snapshot.movements[0]!
    if (addition.kind === 'addition') delete addition.costAllocations
    assert.equal(f.inspect().status, 'needs-review')
    assert.equal(f.inspect().amountJpy, null)
  })
  it('refuses a changed balance after the expected amount was inspected', () => {
    const f = prepared(), input = f.input()
    f.snapshot.movements[0]!.amountJpy = 50000
    if (f.snapshot.movements[0]!.kind === 'addition') f.snapshot.movements[0].costAllocations![0]!.amountJpy = 50000
    assert.throws(() => draftSoftwareAcquisition(f.snapshot, f.planning, f.costs, input), /変わって/)
  })
  for (const kind of ['unconfirmed', 'wrong-year', 'wrong-unit', 'wrong-kind', 'populated', 'incomplete-scope']) {
    it(`refuses ${kind} without modifying the original`, () => {
      const f = prepared(), input = f.input()
      if (kind === 'unconfirmed') f.planning.decisions.find((row) => row.id === 'complete')!.status = 'pending'
      if (kind === 'wrong-year') f.planning.decisions.find((row) => row.id === 'complete')!.taxYear = 2025
      if (kind === 'wrong-unit') f.snapshot.accounts[1]!.taxUnitId = 'different'
      if (kind === 'wrong-kind') f.snapshot.accounts[1]!.kind = 'prepaid'
      if (kind === 'populated') f.snapshot.accounts[1]!.opening = { status: 'known', amountJpy: 1 }
      if (kind === 'incomplete-scope') input.completeCostConfirmed = false
      const before = structuredClone(f.snapshot)
      assert.throws(() => draftSoftwareAcquisition(f.snapshot, f.planning, f.costs, input))
      assert.deepEqual(f.snapshot, before)
    })
  }
  it('uses the existing external-opening confirmation once instead of replaying old costs', () => {
    const f = prepared()
    f.snapshot.accounts[0]!.openingYear = 2026
    f.snapshot.accounts[0]!.opening = { status: 'known', amountJpy: 60000 }
    f.snapshot.movements.shift()
    f.original.snapshot = recordExternalOpening(f.snapshot, f.planning, {
      accountId: 'construction', requestId: 'cbabcdef-3456-4789-abcd-123456789012',
      reference: '導入前の2025年の未費用化製作費', evidenceIds: ['proof'], decisionId: 'complete',
      recordedAt: '2026-12-31T00:00:00Z',
    })
    const basis = f.inspect()
    assert.equal(basis.amountJpy, 120000)
    assert.equal(basis.openingReferences.length, 1)
    const next = draftSoftwareAcquisition(f.original.snapshot, f.planning, f.costs, f.input())
    assert.equal(next.movements.at(-1)!.amountJpy, 120000)
    assert.equal(next.movements.at(-1)!.balanceAllocations!.filter((row) => row.sourceKind === 'opening').length, 1)
    // The external opening retains its external provenance; no invented old-year lot appears.
    const trace = traceBalanceLots(next, f.costs, 2026)
    assert.equal(trace.status, 'incomplete')
    assert.equal(trace.movements.find((row) => row.movementId === 'balance-use:' + requestId)!.untracedJpy, 60000)
  })
  it('rejects an external opening whose amount changed after confirmation', () => {
    const f = prepared()
    f.snapshot.accounts[0]!.openingYear = 2026
    f.snapshot.accounts[0]!.opening = { status: 'known', amountJpy: 60000 }
    f.snapshot.movements.shift()
    f.original.snapshot = recordExternalOpening(f.snapshot, f.planning, {
      accountId: 'construction', requestId: 'cbabcdef-3456-4789-abcd-123456789012',
      reference: '導入前の製作費', evidenceIds: ['proof'], decisionId: 'complete',
      recordedAt: '2026-12-31T00:00:00Z',
    })
    f.original.snapshot.accounts[0]!.opening = { status: 'known', amountJpy: 50000 }
    assert.equal(f.inspect().amountJpy, null)
    assert.equal(f.inspect().status, 'needs-review')
  })
  it('does not omit another construction account for the same software', () => {
    const f = prepared()
    f.snapshot.accounts.push({ ...f.snapshot.accounts[0]!, id: 'another-construction' })
    const addition = f.snapshot.movements[0]!
    if (addition.kind === 'addition') addition.accountId = 'another-construction'
    assert.equal(f.inspect().knownSubtotalJpy, 60000)
    assert.equal(f.inspect().amountJpy, null)
    assert.ok(f.inspect().unresolved.some((message) => message.includes('別の制作中')))
  })
  it('does not bind costs extending beyond the actual completion date', () => {
    const f = prepared()
    f.costs[1]!.bases[0]!.period.endedOn = '2027-01-01'
    assert.equal(f.inspect().amountJpy, null)
    assert.ok(f.inspect().unresolved.some((message) => message.includes('原価期間')))
  })
  it('keeps missing evidence visible without replacing it with a user confirmation', () => {
    const f = prepared()
    f.planning.evidence = []
    assert.equal(f.inspect().knownSubtotalJpy, 120000)
    assert.equal(f.inspect().amountJpy, null)
    assert.ok(f.inspect().unresolved.some((message) => message.includes('証拠参照')))
  })
  it('allows a zero or unrelated construction account without inventing a shared asset', () => {
    const f = prepared()
    f.snapshot.accounts.push({ ...f.snapshot.accounts[0]!, id: 'empty-extra' })
    f.snapshot.accounts.push({ ...f.snapshot.accounts[0]!, id: 'unrelated', taxUnitId: 'different',
      opening: { status: 'known', amountJpy: 50000 } })
    assert.equal(f.inspect().amountJpy, 120000)
  })

})
