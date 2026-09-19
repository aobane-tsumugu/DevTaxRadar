import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { compareAnnualMethods, type AnnualMethodFacts } from '../../src/core/annualMethodComparison.js'
import { decideTaxCandidate } from '../../src/core/taxDecision.js'
const facts = (patch: Partial<AnnualMethodFacts> = {}): AnnualMethodFacts => ({
  assetKind: 'software', contributionIds: ['part'], scopeBasis: '', completeCostConfirmed: true,
  businessOnly: true, acquiredOn: '2026-01-01', usedOn: '2026-01-01', usefulLifeYears: 5,
  taxpayer: 'individual', ordinaryConditions: true, rentalUse: 'none', throughYear: 2031,
  eligibleSmallBusiness: true, annualSpecialUsedJpy: 0, businessMonths: 12,
  statementReady: true, roundingConfirmed: true, reason: '国税庁No.2100の通常の個人用合成例', ...patch,
})
const run = (amount: number, patch: Partial<AnnualMethodFacts> = {}) =>
  compareAnnualMethods(amount, facts(patch), { filingType: 'blue', incomeCategory: 'business' }, 'f', 2026)
const method = (r: ReturnType<typeof run>, id: string) => r.scenarios.find(s => s.method === id)!
describe('C02: applicable choices, not only arithmetically consistent alternatives', () => {
  for (const amount of [1, 80000, 99999]) it(`${amount} yen is expensed on use, not a selectable normal depreciation`, () => {
    const r = run(amount)
    assert.equal(method(r, 'straight-line').status, 'not-eligible')
    assert.equal(method(r, 'straight-line').years, null)
    assert.equal(method(r, 'immediate-expense').years![0]!.expenseJpy, amount)
  })
  it('does not require an irrelevant rounding confirmation for immediate expense', () => {
    const r = run(80000, { roundingConfirmed: null, usefulLifeYears: null })
    assert.equal(method(r, 'immediate-expense').status, 'conditional')
    assert.equal(method(r, 'immediate-expense').years![0]!.expenseJpy, 80000)
    assert.equal(method(r, 'straight-line').status, 'not-eligible')
  })
  it('does not require rounding for a whole-value blue special alternative', () => {
    const r = run(150000, { roundingConfirmed: null })
    assert.equal(method(r, 'blue-special').status, 'conditional')
    assert.equal(method(r, 'straight-line').status, 'missing-facts')
    assert.equal(method(r, 'three-year-pool').status, 'missing-facts')
  })
  it('retains the small-asset rental exception rather than banning all sub-100000 depreciation', () => {
    const r = run(80000, { acquiredOn: '2026-04-01', usedOn: '2026-04-01', rentalUse: 'other' })
    assert.equal(method(r, 'immediate-expense').status, 'not-eligible')
    assert.equal(method(r, 'straight-line').status, 'conditional')
  })
  it('does not infer the rental exception when use is unknown', () => {
    const r = run(80000, { rentalUse: 'unknown' })
    assert.equal(method(r, 'straight-line').status, 'missing-facts')
    assert.equal(method(r, 'immediate-expense').status, 'missing-facts')
  })
  it('does not ask pre-2022 assets to satisfy the later rental exclusion', () => {
    const r = compareAnnualMethods(80000, facts({ acquiredOn: '2021-01-01', usedOn: '2021-01-01', rentalUse: 'unknown', throughYear: 2026 }),
      { filingType: 'white', incomeCategory: 'business' }, 'f', 2021)
    assert.equal(method(r, 'immediate-expense').status, 'conditional')
    assert.equal(method(r, 'straight-line').status, 'not-eligible')
  })
  it('distinguishes explicit mixed use outside this comparator from unknown use', () => {
    assert.equal(run(120000, { businessOnly: false }).status, 'unsupported')
    assert.equal(run(120000, { businessOnly: null }).status, 'missing-facts')
  })
  it('retains exact 100000 and 200000 boundaries', () => {
    assert.equal(method(run(100000), 'straight-line').status, 'conditional')
    assert.equal(method(run(100000), 'immediate-expense').status, 'not-eligible')
    assert.equal(method(run(199999), 'three-year-pool').status, 'conditional')
    assert.equal(method(run(200000), 'three-year-pool').status, 'not-eligible')
  })
})
describe('C02: ordinary work is not maintenance of a particular asset', () => {
  for (const placedInService of ['unknown', 'before', 'after'] as const) it(`ordinary expense is independent of ${placedInService} asset state`, () => {
    const r = decideTaxCandidate({ amountJpy: 1000, businessUse: 'business', workPurpose: 'ordinary-operation', placedInService, serviceProvidedInCurrentPeriod: true, userConfirmed: false })
    assert.equal(r.candidate, 'ordinary-expense')
    assert.equal(r.currentYearExpenseEstimate, 1000)
    assert.deepEqual(r.missingFacts, [])
    assert.equal(r.userConfirmationRequired, true)
  })
  it('keeps maintenance and unprovided services separate', () => {
    assert.equal(decideTaxCandidate({ amountJpy: 1000, businessUse: 'business', workPurpose: 'maintenance', placedInService: 'unknown', userConfirmed: false }).estimateStatus, 'not-calculated')
    assert.equal(decideTaxCandidate({ amountJpy: 1000, businessUse: 'business', workPurpose: 'ordinary-operation', placedInService: 'unknown', serviceProvidedInCurrentPeriod: false, userConfirmed: false }).candidate, 'prepaid-expense')
  })
})
