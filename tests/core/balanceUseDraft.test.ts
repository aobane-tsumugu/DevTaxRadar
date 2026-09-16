import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { AnnualCostProjection } from '../../src/accounting/costs.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import { balanceUseSources, draftBalanceUse, type BalanceUseInput } from '../../src/core/balanceUseDraft.js'
import { buildAnnualBalances } from '../../src/core/annualBalances.js'
import { traceBalanceLots } from '../../src/core/balanceLotTrace.js'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixture(single = false) {
  const planning: PlanningSnapshot = {
    version: 1,
    profile: { taxYear: 2026, journeyMode: 'retrospective', incomeCategory: 'undecided', filingType: 'undecided', monetizationStatus: 'planned', hasBookkeeping: true },
    taxUnits: [
      { id: 'old', name: '稼働版', unitType: 'new-software', usageMode: 'internal', revenueModel: 'efficiency', lifecycleStatus: 'in-use' },
      { id: 'new', name: '改良版', predecessorId: 'old', unitType: 'improvement-plan', usageMode: 'internal', revenueModel: 'efficiency', lifecycleStatus: 'developing' },
      { id: 'unrelated', name: '別制作物', unitType: 'new-software', usageMode: 'external', revenueModel: 'other', lifecycleStatus: 'developing' },
    ],
    projectRules: [], lifecycleEvents: [], equipment: [], homeCosts: [], directCosts: [],
    evidence: [{ id: 'receipt', evidenceType: 'receipt', strength: 'external', recordedAt: '2026-01-01T00:00:00Z', note: '合成の根拠資料' }],
    decisions: ['old', 'new', 'unrelated'].flatMap((taxUnitId) => [2026, 2027].map((taxYear) => ({
      id: `${taxUnitId}-${taxYear}`, taxUnitId, taxYear, engineVersion: 'manual-decision/1',
      candidate: '本人の選んだ方法', selectedCandidate: '本人の選んだ方法', status: 'confirmed' as const,
      reason: '合成の確認根拠', createdAt: '2026-01-01T00:00:00Z', confirmedAt: '2026-01-02T00:00:00Z',
    }))),
  }
  const costs: AnnualCostProjection[] = [{
    version: 1, engineVersion: 'cost-projection/1', year: 2026,
    sources: [{ id: 'direct:invoice', kind: 'direct', label: '合成費用', originalAmountJpy: 100, currency: 'JPY', evidenceIds: ['receipt'], origin: 'entered' }],
    bases: [{ id: 'basis', sourceId: 'direct:invoice', parentContributionIds: [], affectedTaxUnitIds: ['old'], period: { startedOn: '2026-01-01', endedOn: '2026-01-01' }, amount: { status: 'known', amountJpy: 100 }, method: { id: 'synthetic', version: '1', explanation: '合成入力' }, warnings: [] }],
    contributions: (single ? [['a', 100] as const] : [['a', 80] as const, ['b', 20] as const]).map(([id, amountJpy]) => ({ id, basisId: 'basis', target: { kind: 'tax-unit' as const, taxUnitId: 'old' }, amountJpy, reason: '合成', evidenceIds: ['receipt'], sourceIds: ['direct:invoice'] })),
    totals: { knownBasisJpy: 100, taxUnitJpy: 100, generalJpy: 0, privateJpy: 0, unallocatedJpy: 0, unobservedJpy: 0, roundingJpy: 0, unknownBasisIds: [] },
    byTaxUnit: [], invariantSatisfied: true,
  }]
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      { id: 'old-account', taxUnitId: 'old', name: '稼働版の残高', kind: 'construction', openingYear: 2026, opening: { status: 'known', amountJpy: 0 } },
      { id: 'old-asset', taxUnitId: 'old', name: '稼働版の資産', kind: 'asset', openingYear: 2026, opening: { status: 'known', amountJpy: 0 } },
      { id: 'new-account', taxUnitId: 'new', name: '改良の残高', kind: 'construction', openingYear: 2026, opening: { status: 'known', amountJpy: 0 } },
      { id: 'other-account', taxUnitId: 'unrelated', name: '別の残高', kind: 'asset', openingYear: 2026, opening: { status: 'known', amountJpy: 0 } },
    ],
    movements: [{ id: 'purchase', kind: 'addition', accountId: 'old-account', occurredOn: '2026-01-01', amountJpy: 100, sourceIds: ['direct:invoice'], decisionId: 'old-2026', reason: '原費用から組入れ', costAllocations: costs[0]!.contributions.map((row) => ({ costYear: 2026, contributionId: row.id, amountJpy: row.amountJpy })) }],
    pendingDecisions: [],
  }
  const input: BalanceUseInput = { requestId: uuid(1), sourceKind: 'movement', sourceId: 'purchase', kind: 'expense', occurredOn: '2026-09-16', decisionId: 'old-2026', reason: '確認した方法による費用化' }
  return { planning, costs, snapshot, input }
}

describe('balance use draft, connected to the existing flow and lot engines', () => {
  it('uses all remaining lots in one posting without changing the source, original data, or decision', () => {
    const f = fixture(), original = structuredClone(f)
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, f.input)
    assert.deepEqual(f, original)
    const movement = next.movements.at(-1)!
    assert.equal(movement.amountJpy, 100)
    assert.deepEqual(movement.balanceAllocations?.[0]?.costAllocations, f.snapshot.movements[0]!.kind === 'addition' ? f.snapshot.movements[0]!.costAllocations : [])
    assert.deepEqual(movement.sourceIds, ['direct:invoice'])
    assert.equal(buildAnnualBalances(next, 2026).totals.expensesJpy, 100)
    assert.equal(buildAnnualBalances(next, 2027).totals.knownOpeningJpy, 0)
    assert.equal(traceBalanceLots(next, f.costs, 2027).status, 'consistent')
  })
  it('allows a partial use only when its one cost lot determines the composition', () => {
    const f = fixture(true)
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, amountJpy: 40 })
    assert.equal(next.movements.at(-1)!.balanceAllocations![0]!.costAllocations![0]!.amountJpy, 40)
    assert.equal(balanceUseSources(next, f.costs, '2026-12-31')[0]!.amountJpy, 60)
  })
  it('never selects FIFO or proportional composition for a mixed partial use', () => {
    const f = fixture()
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, amountJpy: 50 }), /内訳/)
  })
  it('uses explicitly selected mixed lots and leaves their exact remainder', () => {
    const f = fixture()
    const first = draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, amountJpy: 50, costAllocations: [{ costYear: 2026, contributionId: 'a', amountJpy: 40 }, { costYear: 2026, contributionId: 'b', amountJpy: 10 }] })
    const source = balanceUseSources(first, f.costs, '2026-12-31')[0]!
    assert.deepEqual(source.lots.map((row) => row.remainingJpy), [40, 10])
    const next = draftBalanceUse(first, f.planning, f.costs, { ...f.input, requestId: uuid(2) })
    assert.equal(buildAnnualBalances(next, 2026).totals.knownClosingJpy, 0)
    assert.equal(next.movements.at(-1)!.amountJpy, 50)
  })
  it('posts a refund-related reduction without changing the original invoice or increasing expenses', () => {
    const f = fixture(true), original = structuredClone(f.costs)
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, kind: 'reduction', amountJpy: 25, reason: '返金について確認した残高減少', evidenceIds: ['receipt'] })
    assert.deepEqual(f.costs, original)
    const result = buildAnnualBalances(next, 2026)
    assert.equal(result.totals.reductionsJpy, 25)
    assert.equal(result.totals.expensesJpy, 0)
    assert.equal(result.totals.knownClosingJpy, 75)
    assert.deepEqual(next.movements.at(-1)!.sourceIds, ['direct:invoice', 'receipt'])
  })
  it('posts one atomic successor transfer and preserves the running predecessor', () => {
    const f = fixture(), oldPlanning = structuredClone(f.planning)
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, kind: 'transfer', toAccountId: 'new-account', decisionId: 'new-2026' })
    assert.equal(next.movements.length, 2)
    const result = buildAnnualBalances(next, 2026)
    assert.equal(result.totals.transfersInJpy, 100)
    assert.equal(result.totals.transfersOutJpy, 100)
    assert.equal(result.totals.knownClosingJpy, 100)
    assert.deepEqual(f.planning, oldPlanning)
    assert.equal(f.planning.taxUnits[0]!.lifecycleStatus, 'in-use')
  })
  it('preserves multi-stage source lots through a transfer and later expense', () => {
    const f = fixture()
    const transferred = draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, kind: 'transfer', toAccountId: 'new-account', decisionId: 'new-2026' })
    const used = draftBalanceUse(transferred, f.planning, f.costs, { ...f.input, requestId: uuid(2), sourceId: transferred.movements.at(-1)!.id, decisionId: 'new-2027', occurredOn: '2027-01-02' })
    assert.equal(used.movements.filter((row) => row.kind === 'addition').length, 1)
    assert.equal(buildAnnualBalances(used, 2027).totals.expensesJpy, 100)
    assert.equal(traceBalanceLots(used, f.costs, 2027).status, 'consistent')
    assert.equal(buildAnnualBalances(used, 2026).totals.knownClosingJpy, 100)
  })
  it('moves between kinds within one unit without needing a fabricated successor', () => {
    const f = fixture()
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, kind: 'transfer', toAccountId: 'old-asset' })
    assert.equal(buildAnnualBalances(next, 2026).accounts.find((row) => row.accountId === 'old-asset')!.closing.amountJpy, 100)
  })
  it('reserves future-year uses before proposing the available amount', () => {
    const f = fixture(true)
    f.snapshot.movements.push({ id: 'future', kind: 'expense', accountId: 'old-account', occurredOn: '2027-02-01', amountJpy: 60, sourceIds: ['direct:invoice'], decisionId: 'old-2027', reason: '入力済みの後年度使用', balanceAllocations: [{ sourceKind: 'movement', sourceId: 'purchase', amountJpy: 60 }] })
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, amountJpy: 50 }), /残額/)
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, f.input)
    assert.equal(next.movements.at(-1)!.amountJpy, 40)
    assert.equal(buildAnnualBalances(next, 2027).totals.knownClosingJpy, 0)
  })
  it('does not make a future source available on an earlier date', () => {
    const f = fixture()
    assert.deepEqual(balanceUseSources(f.snapshot, f.costs, '2025-12-31'), [])
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, occurredOn: '2025-12-31' }), /対応元/)
  })
  it('retains an unknown opening without inventing a usable amount', () => {
    const f = fixture()
    f.snapshot.accounts.push({ id: 'unknown', taxUnitId: 'old', name: '未確認期首', kind: 'asset', openingYear: 2026, opening: { status: 'unknown', amountJpy: null, reasons: ['確認中'] } })
    assert.equal(balanceUseSources(f.snapshot, f.costs, f.input.occurredOn).find((row) => row.sourceId === 'unknown')!.amountJpy, null)
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, sourceKind: 'opening', sourceId: 'unknown', amountJpy: 1, evidenceIds: ['receipt'] }), /不明/)
  })
  it('requires an evidence choice for a known but unlinked external opening', () => {
    const f = fixture()
    f.snapshot.accounts.push({ id: 'external', taxUnitId: 'old', name: '外部期首', kind: 'asset', openingYear: 2026, opening: { status: 'known', amountJpy: 30 }, openingRevisionId: 'prior-review' })
    const input = { ...f.input, sourceKind: 'opening' as const, sourceId: 'external' }
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, input), /根拠/)
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, { ...input, evidenceIds: ['receipt'] })
    assert.equal(next.movements.at(-1)!.amountJpy, 30)
    assert.equal(next.accounts.at(-1)!.openingRevisionId, 'prior-review')
    assert.equal(next.movements.at(-1)!.balanceAllocations![0]!.costAllocations, undefined)
    assert.equal(traceBalanceLots(next, f.costs, 2026).status, 'incomplete')
  })
  it('reuses existing external-opening evidence without generating another addition', () => {
    const f = fixture()
    f.snapshot.accounts.push({ id: 'external', taxUnitId: 'old', name: '外部期首', kind: 'asset', openingYear: 2026, opening: { status: 'known', amountJpy: 30 } })
    f.snapshot.pendingDecisions.push({ id: 'external-opening:external', taxUnitId: 'old', taxYear: 2026, amount: { status: 'known', amountJpy: 30 }, accountIds: ['external'], sourceIds: ['receipt'], reasons: ['外部資料との対応'] })
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, sourceKind: 'opening', sourceId: 'external' })
    assert.deepEqual(next.movements.at(-1)!.sourceIds, ['receipt'])
    assert.equal(next.movements.filter((row) => row.kind === 'addition').length, 1)
  })
  it('does not erase a downstream transfer to check a repeated request', () => {
    const f = fixture()
    const input = { ...f.input, kind: 'transfer' as const, toAccountId: 'new-account', decisionId: 'new-2026' }
    const first = draftBalanceUse(f.snapshot, f.planning, f.costs, input)
    const next = draftBalanceUse(first, f.planning, f.costs, { ...f.input, requestId: uuid(2), sourceId: first.movements.at(-1)!.id, decisionId: 'new-2027', occurredOn: '2027-01-02' })
    assert.deepEqual(draftBalanceUse(next, f.planning, f.costs, input), next)
  })
  it('does not duplicate the same request even after all of its source was used', () => {
    const f = fixture(), first = draftBalanceUse(f.snapshot, f.planning, f.costs, f.input)
    assert.deepEqual(draftBalanceUse(first, f.planning, f.costs, f.input), first)
    assert.throws(() => draftBalanceUse(first, f.planning, f.costs, { ...f.input, requestId: uuid(2) }), /対応元/)
  })
  for (const patch of [
    { reason: '別の理由' }, { amountJpy: 90 }, { occurredOn: '2026-09-17' }, { kind: 'reduction' as const },
    { decisionId: 'new-2026' }, { sourceId: 'other' }, { sourceKind: 'opening' as const },
    { evidenceIds: ['receipt'] }, { costAllocations: [{ costYear: 2026, contributionId: 'a', amountJpy: 100 }] },
  ]) it(`rejects a changed repeated request: ${Object.keys(patch)[0]}`, () => {
    const f = fixture(), first = draftBalanceUse(f.snapshot, f.planning, f.costs, f.input)
    assert.throws(() => draftBalanceUse(first, f.planning, f.costs, { ...f.input, ...patch }), /同じ入力要求/)
  })
  for (const amountJpy of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 101]) it(`rejects invalid/excessive amounts: ${amountJpy}`, () => {
    const f = fixture(true), original = structuredClone(f)
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, amountJpy }))
    assert.deepEqual(f, original)
  })
  for (const occurredOn of ['', '2026-02-30', '2026-13-01', '2026-1-1', '1899-12-31', '2026-01-01T00:00:00Z']) it(`rejects invalid movement dates: ${occurredOn}`, () => {
    const f = fixture()
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, occurredOn }))
  })
  for (const kind of ['same', 'unrelated', 'reverse', 'future', 'missing'] as const) it(`rejects an invalid transfer destination: ${kind}`, () => {
    const f = fixture()
    let toAccountId = 'old-account', decisionId = 'old-2026'
    if (kind === 'unrelated') { toAccountId = 'other-account'; decisionId = 'unrelated-2026' }
    if (kind === 'missing') toAccountId = 'missing'
    if (kind === 'future') { toAccountId = 'old-asset'; f.snapshot.accounts.find((row) => row.id === toAccountId)!.openingYear = 2027 }
    if (kind === 'reverse') { toAccountId = 'new-account'; decisionId = 'new-2026'; f.planning.taxUnits[1]!.predecessorId = undefined; f.planning.taxUnits[0]!.predecessorId = 'new' }
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, kind: 'transfer', toAccountId, decisionId }))
  })
  for (const problem of ['pending', 'year', 'unit', 'reason', 'selected', 'time'] as const) it(`requires the relevant confirmed decision: ${problem}`, () => {
    const f = fixture(), d = f.planning.decisions.find((row) => row.id === 'old-2026')!
    if (problem === 'pending') d.status = 'pending'
    if (problem === 'year') d.taxYear = 2027
    if (problem === 'unit') d.taxUnitId = 'new'
    if (problem === 'reason') d.reason = ' '
    if (problem === 'selected') d.selectedCandidate = undefined
    if (problem === 'time') d.confirmedAt = '2025-01-01T00:00:00Z'
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, f.input), /判断/)
  })
  for (const lots of [
    [{ costYear: 2026, contributionId: 'a', amountJpy: 81 }],
    [{ costYear: 2026, contributionId: 'missing', amountJpy: 50 }],
    [{ costYear: 2027, contributionId: 'a', amountJpy: 50 }],
    [{ costYear: 2026, contributionId: 'a', amountJpy: 20 }, { costYear: 2026, contributionId: 'a', amountJpy: 30 }],
    [{ costYear: 2026, contributionId: 'a', amountJpy: -50 }],
    [{ costYear: 2026, contributionId: 'a', amountJpy: 49 }], [],
  ]) it(`rejects invalid explicit lot selection: ${JSON.stringify(lots)}`, () => {
    const f = fixture()
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, amountJpy: 50, costAllocations: lots }))
  })
  it('refuses additional use of an ambiguously consumed pool', () => {
    const f = fixture()
    f.snapshot.movements.push({ id: 'ambiguous', kind: 'expense', accountId: 'old-account', occurredOn: '2026-08-01', amountJpy: 10, sourceIds: ['direct:invoice'], decisionId: 'old-2026', reason: '未確定の内訳', balanceAllocations: [{ sourceKind: 'movement', sourceId: 'purchase', amountJpy: 10 }] })
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, f.input), /原価未確認/)
  })
  it('refuses a cost amount that became smaller after a correction without hiding the overuse', () => {
    const f = fixture()
    f.costs[0]!.contributions[0]!.amountJpy = 70
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, f.input), /不整合/)
  })
  it('requires the selected period cost projections rather than trusting a supplied total', () => {
    const f = fixture()
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, [], f.input), /不整合/)
  })
  it('rejects an unknown evidence reference', () => {
    const f = fixture()
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, evidenceIds: ['missing'] }), /根拠資料/)
  })
  for (const reason of [' ', 'x'.repeat(2001)]) it(`requires a bounded reason (${reason.length})`, () => {
    const f = fixture()
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, { ...f.input, reason }), /判断理由/)
  })
  it('does not infer which source an older unlinked expense consumed', () => {
    const f = fixture(true)
    f.snapshot.accounts[0]!.opening = { status: 'known', amountJpy: 100 }
    f.snapshot.movements.push({ id: 'unlinked', kind: 'expense', accountId: 'old-account', occurredOn: '2026-02-01', amountJpy: 50, sourceIds: ['receipt'], decisionId: 'old-2026', reason: '原価内訳が未対応' })
    assert.equal(balanceUseSources(f.snapshot, f.costs, f.input.occurredOn).find((row) => row.sourceId === 'purchase')!.amountJpy, null)
    assert.throws(() => draftBalanceUse(f.snapshot, f.planning, f.costs, f.input), /不明/)
  })
  it('does not block an unrelated account because another account has unlinked uses', () => {
    const f = fixture(true)
    f.snapshot.accounts[3]!.opening = { status: 'known', amountJpy: 100 }
    f.snapshot.movements.push({ id: 'unlinked-other', kind: 'expense', accountId: 'other-account', occurredOn: '2026-02-01', amountJpy: 50, sourceIds: ['receipt'], decisionId: 'unrelated-2026', reason: '別の残高で未対応' })
    const next = draftBalanceUse(f.snapshot, f.planning, f.costs, f.input)
    assert.equal(next.movements.at(-1)!.amountJpy, 100)
  })
  it('conserves the original amount across one hundred one-yen uses', () => {
    const f = fixture(true)
    let next = f.snapshot
    for (let n = 1; n <= 100; n++) next = draftBalanceUse(next, f.planning, f.costs, { ...f.input, requestId: uuid(n), amountJpy: 1 })
    const result = buildAnnualBalances(next, 2026)
    assert.equal(result.totals.expensesJpy, 100)
    assert.equal(result.totals.knownClosingJpy, 0)
    assert.equal(traceBalanceLots(next, f.costs, 2026).status, 'consistent')
  })
})
