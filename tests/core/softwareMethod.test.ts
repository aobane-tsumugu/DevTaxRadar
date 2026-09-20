import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { buildAnnualBalances, validateBalanceSnapshot } from '../../src/core/annualBalances.js'
import { traceBalanceLots } from '../../src/core/balanceLotTrace.js'
import { chooseSoftwareMethod, draftSoftwareYearExpense, allocateSoftwareExpense } from '../../src/core/softwareMethodDraft.js'
import { canonicalSoftwareValue, softwareMethodAdoptionIssues, softwareMethodSchedule, validateSoftwareMethod, validateSoftwareExpense } from '../../src/core/softwareMethod.js'
import { methodFixture, expenseInput } from './helpers/softwareMethodFixture.js'

const asset = (snapshot: ReturnType<typeof methodFixture>['snapshot']) => snapshot.accounts.find((a) => a.id === 'asset')!
const closing = (snapshot: ReturnType<typeof methodFixture>['snapshot'], year: number) => buildAnnualBalances(snapshot, year).accounts.find((a) => a.accountId === 'asset')!

describe('C01 original cost through the selected method and actual stock expense', () => {
  it('uses 120000 across 2025 and 2026, calculates first-year months and keeps every lot year', () => {
    const f = methodFixture(), before = JSON.stringify(f.snapshot)
    assert.equal(softwareMethodSchedule(f.snapshot, 'asset', asset(f.snapshot).softwareMethod!, 2027)[0]!.expenseJpy, 12000)
    const first = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    assert.equal(closing(first, 2026).expensesJpy, 12000)
    assert.equal(closing(first, 2026).closing.amountJpy, 108000)
    assert.equal(closing(first, 2027).opening.amountJpy, 108000)
    const second = draftSoftwareYearExpense(first, f.planning, f.costs, expenseInput(2027))
    assert.equal(closing(second, 2027).expensesJpy, 24000)
    assert.equal(closing(second, 2027).closing.amountJpy, 84000)
    assert.equal(traceBalanceLots(second, f.costs, 2027).status, 'consistent')
    const remaining = traceBalanceLots(second, f.costs, 2027).remaining.find((s) => s.sourceId === f.acquisitionId)!
    assert.deepEqual(remaining.lots.map((l) => [l.costYear, l.remainingJpy]), [[2025, 42000], [2026, 42000]])
    assert.equal(JSON.stringify(f.snapshot), before)
  })
  it('takes three-year pool amounts from the same engine and never monthly prorates the pool', () => {
    const f = methodFixture('three-year-pool', 180001)
    for (const [year, expected] of [[2026, 60001], [2027, 60001], [2028, 59999]] as const) {
      f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(year))
      assert.equal(closing(f.snapshot, year).expensesJpy, expected)
    }
    assert.equal(closing(f.snapshot, 2028).closing.amountJpy, 0)
  })
  it('expenses a normal 80000 software once and does not invent future depreciation', () => {
    const f = methodFixture('immediate-expense', 80000)
    const first = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    assert.equal(closing(first, 2026).expensesJpy, 80000)
    assert.deepEqual(draftSoftwareYearExpense(first, f.planning, f.costs, expenseInput(2027)), first)
    assert.throws(() => methodFixture('straight-line', 80000), /10万円/)
  })
  it('posts a 350000 blue-special asset once from the same whole-cost engine and preserves the election', () => {
    const f = methodFixture('blue-special', 350000)
    const first = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    assert.equal(closing(first, 2026).expensesJpy, 350000)
    assert.equal(closing(first, 2026).closing.amountJpy, 0)
    assert.deepEqual(draftSoftwareYearExpense(first, f.planning, f.costs, expenseInput(2027)), first)
    assert.equal(asset(first).softwareMethod!.blueSpecial?.annualSpecialUsedJpy, 0)
    const changed = structuredClone(f.planning); changed.profile.filingType = 'white'
    assert.throws(() => draftSoftwareYearExpense(f.snapshot, changed, f.costs, expenseInput(2026)), /青色申告/)
    assert.equal(JSON.stringify(f.snapshot), JSON.stringify(methodFixture('blue-special', 350000).snapshot))
  })
  it('does not reopen a prior blue-special election when a later zero-expense year has a different filing profile', () => {
    const f = methodFixture('blue-special', 350000)
    const first = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    const changed = structuredClone(f.planning)
    changed.profile.taxYear = 2027
    changed.profile.filingType = 'white'
    changed.decisions = changed.decisions.filter((row) => row.taxYear !== 2027)
    assert.deepEqual(draftSoftwareYearExpense(first, changed, f.costs,
      { ...expenseInput(2027), decisionId: '', ordinaryYearConfirmed: false }), first)
    assert.deepEqual(softwareMethodAdoptionIssues(first, 2027, changed), [])
    assert.ok(softwareMethodAdoptionIssues(first, 2026, changed).some((row) => row.message.includes('青色申告')))
  })
  it('requires no extra zero-value judgment once the fully expensed asset has no annual charge', () => {
    const f = methodFixture('immediate-expense', 80000)
    const first = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    f.planning.decisions = f.planning.decisions.filter((d) => d.taxYear !== 2027)
    assert.deepEqual(draftSoftwareYearExpense(first, f.planning, f.costs,
      { ...expenseInput(2027), decisionId: '', ordinaryYearConfirmed: false }), first)
  })
  it('rejects a different lot split even when the annual amount and remaining total are unchanged', () => {
    const f = methodFixture(), next = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    const lots = next.movements.at(-1)!.balanceAllocations![0]!.costAllocations!
    lots[0]!.amountJpy++; lots[1]!.amountJpy--
    assert.throws(() => validateBalanceSnapshot(next), /原価内訳/)
  })
  it('caps the final year and retains zero without adding zero-value postings', () => {
    const f = methodFixture()
    for (let year = 2026; year <= 2031; year++) f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(year))
    assert.equal(closing(f.snapshot, 2031).expensesJpy, 12000)
    assert.equal(closing(f.snapshot, 2031).closing.amountJpy, 0)
    assert.deepEqual(draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2032)), f.snapshot)
  })
  it('makes exact replay idempotent, rejects a second request for the same year', () => {
    const f = methodFixture(), first = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    assert.deepEqual(draftSoftwareYearExpense(first, f.planning, f.costs, expenseInput(2026)), first)
    assert.throws(() => draftSoftwareYearExpense(first, f.planning, f.costs,
      { ...expenseInput(2026), requestId: '33333333-3333-4333-8333-333333333333' }), /既に/)
  })
  it('does not reconstruct a missing previous-year posting from a trial schedule', () => {
    const f = methodFixture(), before = JSON.stringify(f.snapshot)
    assert.throws(() => draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2027)), /2026年/)
    assert.equal(JSON.stringify(f.snapshot), before)
  })
  it('does not overwrite saved selections by changing a display horizon', () => {
    const f = methodFixture(), choice = asset(f.snapshot).softwareMethod!, before = JSON.stringify(choice)
    softwareMethodSchedule(f.snapshot, 'asset', choice, 2027)
    softwareMethodSchedule(f.snapshot, 'asset', choice, 2030)
    assert.equal(JSON.stringify(choice), before)
    assert.ok(!('throughYear' in choice))
  })
  it('does not convert a confirmed acquisition decision into annual expense authority', () => {
    const f = methodFixture()
    assert.throws(() => draftSoftwareYearExpense(f.snapshot, f.planning, f.costs,
      { ...expenseInput(2026), decisionId: 'decision:2026' }), /年額費用/)
  })
  it('rejects unconfirmed annual conditions and changed or missing evidence', () => {
    const f = methodFixture()
    assert.throws(() => draftSoftwareYearExpense(f.snapshot, f.planning, f.costs,
      { ...expenseInput(2026), ordinaryYearConfirmed: false }), /対象年/)
    f.planning.evidence = []
    assert.throws(() => draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026)), /根拠/)
  })
  it('holds retirement and additional asset movements outside ordinary automatic expense', () => {
    const f = methodFixture()
    f.planning.lifecycleEvents.push({ id: 'retired', taxUnitId: 'software', eventType: 'retired', occurredOn: '2026-10-01', recordedAt: '2026-10-01T00:00:00Z', evidenceIds: ['proof'] })
    assert.throws(() => draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026)), /終了/)
  })
})

describe('ordinary server-side balance validation retains method provenance', () => {
  it('rejects editing an annual amount even if the remaining balance is still positive', () => {
    const f = methodFixture(); f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    f.snapshot.movements.at(-1)!.amountJpy--
    f.snapshot.movements.at(-1)!.balanceAllocations![0]!.amountJpy--
    f.snapshot.movements.at(-1)!.balanceAllocations![0]!.costAllocations![0]!.amountJpy--
    assert.throws(() => validateBalanceSnapshot(f.snapshot), /年額/)
  })
  it('rejects duplicate current-year manual expense beside a method-derived amount', () => {
    const f = methodFixture(); f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    f.snapshot.movements.push({ ...f.snapshot.movements.at(-1)!, id: 'duplicate', softwareExpense: undefined })
    assert.throws(() => validateBalanceSnapshot(f.snapshot), /二重計上/)
  })
  it('rejects a changed method while old method-derived postings remain', () => {
    const f = methodFixture(); f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    asset(f.snapshot).softwareMethod!.usefulLifeYears = 3
    assert.throws(() => validateBalanceSnapshot(f.snapshot), /年額/)
  })
  it('detects same-total acquisition ancestry changes, not only the asset amount', () => {
    const f = methodFixture(); f.snapshot.movements[0]!.reason += ' altered source'
    assert.throws(() => validateBalanceSnapshot(f.snapshot), /取得価額/)
  })
  it('does not invalidate a method for a different account or unrelated descriptive field', () => {
    const f = methodFixture(); f.snapshot.accounts.push({ id: 'other', name: '別資産', kind: 'asset', taxUnitId: 'software', openingYear: 2026, opening: { status: 'known', amountJpy: 0 } })
    asset(f.snapshot).name = '表示名変更'
    validateBalanceSnapshot(f.snapshot)
  })
  it('refuses missing selection beneath a tagged expense', () => {
    const f = methodFixture(); f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    delete asset(f.snapshot).softwareMethod
    assert.throws(() => validateBalanceSnapshot(f.snapshot), /方法がありません/)
  })
  it('rejects malformed or unsupported selection fields instead of stripping them', () => {
    const f = methodFixture(), selection = asset(f.snapshot).softwareMethod!
    for (const patch of [{ version: 2 }, { extra: true }, { allocationPolicy: 'FIFO' }, { usedOn: '2026-02-30' },
      { usefulLifeYears: 4 }, { acquisitionBasis: 'null' }, { confirmedAt: 'invalid' }, { evidenceIds: ['proof', 'proof'] }])
      assert.throws(() => validateSoftwareMethod({ ...selection, ...patch }))
  })
  it('requires complete and method-scoped blue-special conditions', () => {
    const f = methodFixture('blue-special', 350000), selected = asset(f.snapshot).softwareMethod!
    assert.doesNotThrow(() => validateSoftwareMethod(selected))
    assert.throws(() => validateSoftwareMethod({ ...selected, blueSpecial: undefined }))
    assert.throws(() => validateSoftwareMethod({ ...selected, roundingConfirmed: true }))
    const ordinary = methodFixture().snapshot.accounts.find((row) => row.id === 'asset')!.softwareMethod!
    assert.throws(() => validateSoftwareMethod({ ...ordinary, blueSpecial: selected.blueSpecial }))
  })
  it('rejects wrong account and year in an expense stamp', () => {
    const f = methodFixture(); f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    f.snapshot.movements.at(-1)!.softwareExpense!.year = 2027
    assert.throws(() => validateBalanceSnapshot(f.snapshot), /年額/)
    assert.throws(() => validateSoftwareExpense({ version: 1 }))
  })
  it('allows old records without any new fields to keep their old form', () => {
    const f = methodFixture(); validateBalanceSnapshot(f.unselected)
    assert.ok(f.unselected.accounts.every((a) => !Object.hasOwn(a, 'softwareMethod')))
  })
})

describe('explicit allocation policy and integrity', () => {
  it('allocates conserved yen by remaining amounts with deterministic tie-breaking', () => {
    const lots = [{ costYear: 2025, contributionId: 'b', remainingJpy: 1 }, { costYear: 2025, contributionId: 'a', remainingJpy: 1 }]
    assert.deepEqual(allocateSoftwareExpense(1, lots), [{ costYear: 2025, contributionId: 'a', amountJpy: 1 }])
    assert.deepEqual(allocateSoftwareExpense(1, [...lots].reverse()), allocateSoftwareExpense(1, lots))
  })
  it('uses integer arithmetic at the safe numeric boundary', () => {
    const max = Number.MAX_SAFE_INTEGER
    const result = allocateSoftwareExpense(max - 1, [{ costYear: 2025, contributionId: 'x', remainingJpy: max }])
    assert.equal(result[0]!.amountJpy, max - 1)
  })
  it('rejects unknown, duplicate and over-claimed cost lots', () => {
    assert.throws(() => allocateSoftwareExpense(1, [{ costYear: 2025, contributionId: 'x', remainingJpy: null }]))
    const lot = { costYear: 2025, contributionId: 'x', remainingJpy: 1 }
    assert.throws(() => allocateSoftwareExpense(1, [lot, lot]))
    assert.throws(() => allocateSoftwareExpense(2, [lot]))
  })
  it('does not duplicate the entire acquisition ancestry in every annual posting', () => {
    const f = methodFixture()
    f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    const proof = f.snapshot.movements.at(-1)!.softwareExpense!.methodBasis
    assert.ok(proof.length < 3000)
    assert.ok(!proof.includes('acquisitionBasis'))
    assert.ok(!proof.includes('evidenceBasis'))
    assert.ok(asset(f.snapshot).softwareMethod!.acquisitionBasis.length > 0)
  })
  it('retains canonical evidence and no private local path fields', () => {
    const f = methodFixture()
    assert.ok(!JSON.stringify(asset(f.snapshot).softwareMethod).includes('PRIVATE-LOCAL-PATH'))
    assert.equal(canonicalSoftwareValue({ b: 1, a: null }), '{"a":null,"b":1}')
  })
})
