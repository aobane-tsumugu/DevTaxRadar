import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { compareAnnualMethods, validateAnnualMethodFacts, validMethodDate, type AnnualMethodFacts } from '../../src/core/annualMethodComparison.js'
const profile = { filingType: 'blue', incomeCategory: 'business' }
function facts(patch: Partial<AnnualMethodFacts> = {}): AnnualMethodFacts {
  return { contributionIds: ['part'], scopeBasis: '', assetKind: 'software', completeCostConfirmed: true,
    businessOnly: true, acquiredOn: '2026-04-01', usedOn: '2026-07-01', usefulLifeYears: 5,
    taxpayer: 'individual', ordinaryConditions: true, rentalUse: 'none', throughYear: 2033,
    eligibleSmallBusiness: true, annualSpecialUsedJpy: 0, businessMonths: 12,
    statementReady: true, roundingConfirmed: true, reason: '合成の資産全体額・方式・期間の比較', ...patch }
}
const run = (amount = 180001, patch: Partial<AnnualMethodFacts> = {}) => compareAnnualMethods(amount, facts(patch), profile, 'facts', 2026)
const scenario = (method: string, amount = 180001, patch: Partial<AnnualMethodFacts> = {}) => run(amount, patch).scenarios.find((row) => row.method === method)!
describe('explicit whole-asset annual alternatives', () => {
  it('uses the published rate, monthly portion, and zero software residual', () => {
    const s = scenario('straight-line')
    assert.equal(s.years![0]!.expenseJpy, 18001)
    assert.equal(s.years!.at(-1)!.closingJpy, 0)
    assert.equal(s.years!.reduce((sum, row) => sum + row.expenseJpy, 0), 180001)
  })
  it('retains one yen for tangible equipment', () => {
    const s = scenario('straight-line', 180001, { assetKind: 'tangible-equipment', usefulLifeYears: 4 })
    assert.equal(s.years!.at(-1)!.closingJpy, 1)
    assert.equal(s.years!.reduce((sum, row) => sum + row.expenseJpy, 0), 180000)
  })
  it('keeps pool years independent of the first month and caps the final year', () => {
    const s = scenario('three-year-pool', 180001, { usedOn: '2026-12-31' })
    assert.deepEqual(s.years!.slice(0, 3).map((row) => row.expenseJpy), [60001, 60001, 59999])
    assert.equal(s.years![3]!.expenseJpy, 0)
  })
  for (const [cost, method, expected] of [
    [99999, 'immediate-expense', 'conditional'], [100000, 'immediate-expense', 'not-eligible'],
    [100000, 'three-year-pool', 'conditional'], [199999, 'three-year-pool', 'conditional'],
    [200000, 'three-year-pool', 'not-eligible'], [399999, 'blue-special', 'conditional'],
    [400000, 'blue-special', 'not-eligible'],
  ] as const) it(`${cost}: ${method} boundary is ${expected}`, () => assert.equal(scenario(method, cost).status, expected))
  it('keeps the pre-April-2026 special threshold separate', () => {
    assert.equal(scenario('blue-special', 300000, { acquiredOn: '2026-03-31' }).status, 'not-eligible')
    assert.equal(scenario('blue-special', 299999, { acquiredOn: '2026-03-31' }).status, 'conditional')
  })
  it('does not default missing other-asset usage or business months to zero/twelve', () => {
    for (const patch of [{ annualSpecialUsedJpy: null }, { businessMonths: null }, { statementReady: null }])
      assert.equal(scenario('blue-special', 180001, patch).years, null)
  })
  it('excludes nonprimary rental from all small-asset alternatives, not ordinary depreciation', () => {
    const r = run(150000, { rentalUse: 'other' })
    assert.equal(r.scenarios[0]!.status, 'conditional')
    for (const s of r.scenarios.slice(1)) assert.equal(s.years, null)
  })
  it('requires rental facts but never blocks the ordinary alternative by inventing a rental condition', () => {
    assert.equal(scenario('three-year-pool', 150000, { rentalUse: 'unknown' }).status, 'missing-facts')
    assert.equal(scenario('straight-line', 150000, { rentalUse: 'unknown' }).status, 'conditional')
  })
  it('respects the shortened-year aggregate cap', () => {
    assert.equal(scenario('blue-special', 200000, { annualSpecialUsedJpy: 1400000, businessMonths: 6 }).status, 'not-eligible')
    assert.equal(scenario('blue-special', 100000, { annualSpecialUsedJpy: 1400000, businessMonths: 6 }).status, 'conditional')
  })
  for (const [name, patch] of [
    ['whole amount', { completeCostConfirmed: null }], ['mixed/private', { businessOnly: false }],
    ['missing date', { usedOn: null }], ['rounding assumption', { roundingConfirmed: null }],
    ['unknown taxpayer', { taxpayer: 'unknown' }], ['special adjustment', { ordinaryConditions: false }],
    ['corporation', { taxpayer: 'corporation' }], ['reverse dates', { usedOn: '2026-03-01' }],
  ] as const) it(`keeps ${name} uncalculated rather than zero`, () => {
    assert.ok(run(150000, patch).scenarios.every((row) => row.years === null))
  })
  it('does not assume a statutory life or support an unverified software category', () => {
    assert.equal(scenario('straight-line', 150000, { usefulLifeYears: null }).status, 'missing-facts')
    assert.equal(scenario('straight-line', 150000, { usefulLifeYears: 4 }).status, 'unsupported')
  })
  it('does not extend a special tax rule beyond its verified period', () => {
    const r = compareAnnualMethods(150000, facts({ acquiredOn: '2030-01-01', usedOn: '2030-01-01', throughYear: 2035 }), profile, 'facts', 2030)
    assert.equal(r.scenarios.find((row) => row.method === 'blue-special')!.status, 'unsupported')
  })
  it('reads actual prior closing instead of recreating historical depreciation', () => {
    const f = facts({ assetKind: 'tangible-equipment', acquiredOn: '2024-01-01', usedOn: '2024-01-01', usefulLifeYears: 4 })
    assert.equal(compareAnnualMethods(200000, f, profile, 'facts', 2026).status, 'missing-facts')
    const r = compareAnnualMethods(200000, f, profile, 'facts', 2026, { taxYear: 2025, amountJpy: 77777, reference: '合成の前年資料' })
    assert.equal(r.scenarios[0]!.years![0]!.openingJpy, 77777)
    assert.ok(r.scenarios.slice(1).every((s) => s.years === null))
  })
  it('preserves annual conservation and safe integers over boundary values', () => {
    for (const amount of [1, 2, 99999, 100000, 199999, 200000, 399999, 400000, Number.MAX_SAFE_INTEGER]) {
      for (const s of run(amount).scenarios) for (const row of s.years ?? []) {
        assert.equal(BigInt(row.openingJpy) + BigInt(row.additionsJpy) - BigInt(row.expenseJpy), BigInt(row.closingJpy))
        assert.ok(Number.isSafeInteger(row.closingJpy) && row.closingJpy >= 0)
      }
    }
  })
  it('rejects fake calendar dates and unknown input fields', () => {
    assert.equal(validMethodDate('2026-02-30'), false)
    assert.equal(validMethodDate('2024-02-29'), true)
    assert.throws(() => validateAnnualMethodFacts({ ...facts(), guessed: true }))
    assert.throws(() => validateAnnualMethodFacts(facts({ contributionIds: ['part', 'part'] })))
    assert.throws(() => run(150000, { throughYear: 2151 }))
  })
})
