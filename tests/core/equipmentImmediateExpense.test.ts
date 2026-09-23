import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  calculateEquipmentImmediateExpense as calculate,
  smallEquipmentStraightLineRestriction as restriction,
  type EquipmentExpenseFacts,
} from '../../src/core/equipmentImmediateExpense.js'

const facts = (patch: Partial<EquipmentExpenseFacts> = {}): EquipmentExpenseFacts => ({
  equipmentId: 'synthetic-device',
  taxYear: 2026,
  taxpayer: 'individual',
  assetKind: 'tangible-equipment',
  methodReason: '設備全体額・供用日と証拠を確認',
  acquisitionCostJpy: 80000,
  acquiredOn: '2026-04-01',
  businessUseStartedOn: '2026-12-31',
  convertedFromPrivate: false,
  ordinaryTreatment: 'confirmed',
  rentalUse: 'none',
  priorClosing: null,
  ...patch,
})

describe('small equipment uses the existing annual-cost entrance, not a hypothetical depreciation', () => {
  it('takes the full 80000 in the service year without monthly prorating or a life', () => {
    const input = facts(),
      before = structuredClone(input),
      result = calculate(input)
    assert.equal(result.status, 'conditional')
    assert.equal(result.calculation!.depreciationJpy, 80000)
    assert.equal(result.calculation!.closingBasisJpy, 0)
    assert.equal(result.calculation!.rateNumerator, null)
    assert.equal(result.calculation!.months, null)
    assert.equal(result.calculation!.rounding, 'none')
    assert.equal(result.taxTreatmentVerified, false)
    assert.deepEqual(input, before)
  })
  it('never repeats a service-year expense in the next year', () => {
    const result = calculate(facts({ taxYear: 2027 }))
    assert.equal(result.status, 'conditional')
    assert.equal(result.calculation!.depreciationJpy, 0)
    assert.equal(result.calculation!.openingBasisJpy, 0)
    assert.equal(result.calculation!.closingBasisJpy, 0)
  })
  it('keeps known zero different from an unknown purchase amount', () => {
    assert.equal(calculate(facts({ acquisitionCostJpy: 0 })).calculation!.depreciationJpy, 0)
    assert.equal(calculate(facts({ acquisitionCostJpy: null })).calculation, null)
  })
  it('does not take cost in the acquisition year before service', () => {
    const result = calculate(facts({ businessUseStartedOn: '2027-01-01' }))
    assert.equal(result.status, 'outside-period')
    assert.equal(result.calculation, null)
  })
  it('accepts prior acquisition with service this year and a consistent opening', () => {
    const result = calculate(
      facts({
        acquiredOn: '2025-12-01',
        priorClosing: {
          taxYear: 2025,
          amountJpy: 80000,
          reference: '合成の未供用資料',
        },
      }),
    )
    assert.equal(result.calculation!.depreciationJpy, 80000)
  })
  it('accepts confirmed zero opening after full expensing', () => {
    const result = calculate(
      facts({
        taxYear: 2027,
        priorClosing: {
          taxYear: 2026,
          amountJpy: 0,
          reference: '合成の供用年資料',
        },
      }),
    )
    assert.equal(result.calculation!.depreciationJpy, 0)
  })
  for (const [price, success] of [
    [99999, true],
    [100000, false],
    [200000, false],
  ] as const) {
    it(`uses the whole purchase amount at ${price}, before private/project allocation`, () => {
      const result = calculate(facts({ acquisitionCostJpy: price }))
      assert.equal(result.status === 'conditional', success)
      if (!success) assert.equal(result.calculation, null)
    })
  }
  for (const rentalUse of ['none', 'primary-business', 'other', 'unknown', undefined] as const) {
    it(`requires the post-2022 rental condition: ${rentalUse}`, () => {
      const input = facts({ rentalUse }),
        result = calculate(input)
      assert.equal(
        result.status,
        rentalUse === 'none' || rentalUse === 'primary-business'
          ? 'conditional'
          : rentalUse === 'other'
            ? 'unsupported'
            : 'missing-facts',
      )
      // Nonprimary rental is the explicit ordinary-depreciation exception, never a guessed default.
      assert.equal(restriction(input) === null, rentalUse === 'other')
    })
  }
  it('does not apply the post-2022 rental exclusion to earlier acquisition', () => {
    const input = facts({ acquiredOn: '2022-03-31', rentalUse: 'other' })
    assert.equal(calculate(input).status, 'conditional')
    assert.notEqual(restriction(input), null)
  })
  for (const patch of [
    { taxpayer: 'corporation' as const },
    { assetKind: 'intangible' as const },
    { convertedFromPrivate: true },
    { ordinaryTreatment: 'special-or-adjusted' as const },
  ])
    it(`does not coerce known unsupported facts: ${Object.keys(patch)}`, () => {
      assert.equal(calculate(facts(patch)).status, 'unsupported')
      assert.equal(calculate(facts(patch)).calculation, null)
    })
  for (const patch of [
    { taxpayer: 'unknown' as const },
    { assetKind: 'unknown' as const },
    { acquiredOn: null },
    { businessUseStartedOn: null },
    { convertedFromPrivate: null },
    { ordinaryTreatment: 'unknown' as const },
    { methodReason: ' ' },
  ])
    it(`preserves missing facts: ${Object.keys(patch)}`, () => {
      assert.equal(calculate(facts(patch)).status, 'missing-facts')
      assert.equal(calculate(facts(patch)).calculation, null)
    })
  for (const patch of [
    { acquisitionCostJpy: -1 },
    { acquisitionCostJpy: 0.5 },
    { acquisitionCostJpy: Number.MAX_SAFE_INTEGER + 1 },
    { taxYear: 2026.5 },
    { acquiredOn: '2026-02-30' },
    { businessUseStartedOn: '2026-03-01' },
  ])
    it(`rejects invalid facts: ${JSON.stringify(patch)}`, () => {
      assert.equal(calculate(facts(patch)).status, 'inconsistent')
      assert.equal(calculate(facts(patch)).calculation, null)
    })
  it('refuses to erase an actual old depreciation balance by choosing full expensing', () => {
    const result = calculate(
      facts({
        taxYear: 2027,
        priorClosing: {
          taxYear: 2026,
          amountJpy: 64000,
          reference: '以前の普通償却資料',
        },
      }),
    )
    assert.equal(result.status, 'inconsistent')
    assert.equal(result.calculation, null)
  })
  it('refuses contradictory first-year opening and a wrong opening year', () => {
    for (const patch of [
      { priorClosing: { taxYear: 2025, amountJpy: 80000, reference: '取得前の金額' } },
      { taxYear: 2027, priorClosing: { taxYear: 2024, amountJpy: 0, reference: '違う年度' } },
    ])
      assert.equal(calculate(facts(patch)).status, 'inconsistent')
  })
  it('does not restrict ordinary depreciation for a whole asset above the small threshold', () => {
    assert.equal(restriction(facts({ acquisitionCostJpy: 100000 })), null)
    assert.equal(restriction(facts({ acquisitionCostJpy: null })), null)
  })
})
