import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { softwareMethodAlternatives, validSoftwareMethodForm, type SoftwareMethodForm } from '../../src/client/softwareMethodForm.js'
const profile = { filingType: 'blue', incomeCategory: 'business' }
const form = (patch: Partial<SoftwareMethodForm> = {}): SoftwareMethodForm => ({
  accountId: 'asset', acquisitionMovementId: 'transfer', method: 'straight-line', usedOn: '2026-01-01', life: '5',
  rental: 'none', business: true, ordinary: true, rounding: true, evidenceIds: ['proof'], reason: '明示した通常の合成条件',
  specialEligibility: '', specialUsedJpy: '', businessMonths: '', statementReady: '',
  year: '2027', decisionId: '', ordinaryYear: false, endYear: '', endReason: '', ...patch,
})
describe('C03 user-facing alternatives reuse the actual C02 method engine', () => {
  it('T02: computes 120,000 whole cost through two years without posting or modifying the form', () => {
    const input = form(), original = structuredClone(input)
    const result = softwareMethodAlternatives(input, 120000, '2026-01-01', profile)
    const straight = result.find((row) => row.method === 'straight-line')!
    assert.equal(straight.status, 'conditional')
    assert.deepEqual(straight.years!.map((row) => [row.year, row.openingJpy, row.expenseJpy, row.closingJpy]), [[2026, 0, 24000, 96000], [2027, 96000, 24000, 72000]])
    assert.deepEqual(input, original)
  })
  it('T03: 80,000 is immediate, not ordinary or pooled, and needs no rounding agreement', () => {
    const result = softwareMethodAlternatives(form({ rounding: false, life: '' }), 80000, '2026-01-01', profile)
    assert.equal(result.find((row) => row.method === 'straight-line')!.status, 'not-eligible')
    assert.equal(result.find((row) => row.method === 'three-year-pool')!.status, 'not-eligible')
    const immediate = result.find((row) => row.method === 'immediate-expense')!
    assert.equal(immediate.status, 'conditional'); assert.equal(immediate.years![0]!.expenseJpy, 80000)
  })
  for (const [amount, immediate, pool] of [[99999, true, false], [100000, false, true], [199999, false, true], [200000, false, false]] as const)
    it(`T04: applies whole-asset amount boundaries at ${amount}`, () => {
      const results = softwareMethodAlternatives(form(), amount, '2026-01-01', profile)
      assert.equal(results.find((row) => row.method === 'immediate-expense')!.status === 'conditional', immediate)
      assert.equal(results.find((row) => row.method === 'three-year-pool')!.status === 'conditional', pool)
    })
  it('supports a 350000 post-April-2026 blue-special alternative only with its own explicit conditions', () => {
    // Used on or after the 2026-04-01 acquisition; an earlier use date fails the date-order check instead.
    const eligible = softwareMethodAlternatives(form({ method: 'blue-special', usedOn: '2026-04-01', specialEligibility: 'yes', specialUsedJpy: '0', businessMonths: '12', statementReady: 'yes', rounding: false }), 350000, '2026-04-01', profile)
      .find((row) => row.method === 'blue-special')!
    assert.equal(eligible.status, 'conditional'); assert.equal(eligible.years![0]!.expenseJpy, 350000)
    const missing = softwareMethodAlternatives(form({ method: 'blue-special', usedOn: '2026-04-01', rounding: false }), 350000, '2026-04-01', profile)
      .find((row) => row.method === 'blue-special')!
    assert.equal(missing.status, 'missing-facts')
    assert.ok(missing.reasons.includes('取得時期の事業者要件を確認してください。'))
    assert.ok(missing.reasons.includes('供用年の事業月数・他資産の特例使用額・明細の準備を確認してください。'))
  })
  it('does not treat an unknown or non-primary rental as no rental', () => {
    assert.equal(softwareMethodAlternatives(form({ rental: '' }), 80000, '2026-01-01', profile).find((row) => row.method === 'immediate-expense')!.status, 'missing-facts')
    assert.equal(softwareMethodAlternatives(form({ rental: 'other' }), 80000, '2026-01-01', profile).find((row) => row.method === 'immediate-expense')!.status, 'not-eligible')
  })
  it('does not automatically check business, ordinary conditions or evidence during a preview', () => {
    const input = form({ business: false, ordinary: false, evidenceIds: [] }), original = structuredClone(input)
    assert.ok(softwareMethodAlternatives(input, 120000, '2026-01-01', profile).every((row) => row.status === 'missing-facts'))
    assert.deepEqual(input, original)
  })
  it('retains raw unfinished dates/years for editing, but cannot calculate them', () => {
    assert.ok(validSoftwareMethodForm(form({ usedOn: '2026-', year: '202', specialUsedJpy: '1e', businessMonths: '-' })))
    assert.deepEqual(softwareMethodAlternatives(form({ year: '' }), 120000, '2026-01-01', profile), [])
    assert.throws(() => softwareMethodAlternatives(form({ usedOn: '2026-' }), 120000, '2026-01-01', profile), /日付/)
  })
  it('rejects duplicate evidence or unrelated fields in a restored form', () => {
    assert.equal(validSoftwareMethodForm({ ...form(), evidenceIds: ['proof', 'proof'] }), false)
    assert.equal(validSoftwareMethodForm({ ...form(), foreign: true }), false)
  })
  it('permits an alternative comparison without changing a previously selected method', () => {
    const selected = form(), before = structuredClone(selected)
    const result = softwareMethodAlternatives({ ...selected, method: 'three-year-pool', year: '2028' }, 120000, '2026-01-01', profile)
    assert.deepEqual(result.find((row) => row.method === 'three-year-pool')!.years!.map((row) => row.expenseJpy), [40000, 40000, 40000])
    assert.deepEqual(selected, before)
  })
})
