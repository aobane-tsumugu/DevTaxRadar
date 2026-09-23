import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { calculateEquipmentPool } from '../../src/core/equipmentPool.js'
import type { EquipmentDepreciationInput } from '../../src/core/equipmentDepreciation.js'
const input = (patch: Partial<EquipmentDepreciationInput> = {}): EquipmentDepreciationInput => ({
  equipmentId: 'pc',
  taxYear: 2026,
  taxpayer: 'individual',
  assetKind: 'tangible-equipment',
  method: 'three-year-pool',
  methodReason: '供用年の合成の一括償却選択',
  acquisitionCostJpy: 180001,
  acquiredOn: '2026-04-01',
  businessUseStartedOn: '2026-12-31',
  usefulLifeYears: null,
  rentalUse: 'none',
  convertedFromPrivate: false,
  useThroughYearEnd: 'unknown',
  ordinaryTreatment: 'confirmed',
  priorClosing: null,
  poolElection: { serviceYear: 2026, reference: '合成の供用年選択資料', roundingConfirmed: true },
  ...patch,
})
describe('equipment pool selection into the real annual cost basis', () => {
  it('uses the shared formula, no monthly fraction or statutory life, and conserves the full amount', () => {
    const original = input(),
      before = structuredClone(original)
    const first = calculateEquipmentPool(original)
    const second = calculateEquipmentPool(
      input({
        taxYear: 2027,
        priorClosing: { taxYear: 2026, amountJpy: 120000, reference: '実際の前年資料' },
      }),
    )
    const third = calculateEquipmentPool(
      input({
        taxYear: 2028,
        priorClosing: { taxYear: 2027, amountJpy: 59999, reference: '実際の前年資料' },
      }),
    )
    assert.equal(first.status, 'conditional')
    assert.deepEqual(
      [first, second, third].map((r) => r.calculation!.depreciationJpy),
      [60001, 60001, 59999],
    )
    assert.equal(third.calculation!.closingBasisJpy, 0)
    assert.equal(third.calculation!.capped, true)
    assert.equal(
      [first, second, third].reduce((sum, r) => sum + r.calculation!.depreciationJpy, 0),
      180001,
    )
    assert.equal(first.taxTreatmentVerified, false)
    assert.deepEqual(original, before)
  })
  for (const amount of [100000, 100001, 150000, 199999])
    it(`allows the whole-asset boundary ${amount}`, () => {
      assert.equal(
        calculateEquipmentPool(input({ acquisitionCostJpy: amount })).status,
        'conditional',
      )
    })
  for (const amount of [0, 80000, 99999, 200000, 300000])
    it(`excludes ${amount} instead of using a fractional purchase amount`, () => {
      const r = calculateEquipmentPool(input({ acquisitionCostJpy: amount }))
      assert.equal(r.status, 'unsupported')
      assert.equal(r.calculation, null)
    })
  it('does not turn an unknown amount into zero', () => {
    assert.equal(
      calculateEquipmentPool(input({ acquisitionCostJpy: null })).status,
      'missing-facts',
    )
  })
  it('does not require irrelevant life, months or uninterrupted individual equipment use', () => {
    const a = calculateEquipmentPool(input())
    const b = calculateEquipmentPool(
      input({ usefulLifeYears: 99, useThroughYearEnd: 'ended-or-interrupted' }),
    )
    assert.deepEqual(a.calculation, b.calculation)
    assert.ok(b.reasons.some((r) => r.includes('一時費用化しません')))
  })
  it('requires actual previous closing for an existing asset even though a formula can compute it', () => {
    assert.equal(calculateEquipmentPool(input({ taxYear: 2027 })).status, 'missing-facts')
  })
  for (const prior of [
    { taxYear: 2025, amountJpy: 120000, reference: 'wrong year' },
    { taxYear: 2026, amountJpy: 119999, reference: 'different prior method' },
    { taxYear: 2026, amountJpy: 180001, reference: 'no actual expense' },
    { taxYear: 2026, amountJpy: 120000, reference: '' },
  ])
    it('refuses contradictory prior records ' + JSON.stringify(prior), () => {
      assert.equal(
        calculateEquipmentPool(input({ taxYear: 2027, priorClosing: prior })).status,
        'inconsistent',
      )
    })
  it('does not repeat the original cost after year three, or keep a one-yen tangible residual', () => {
    const r = calculateEquipmentPool(
      input({
        taxYear: 2035,
        priorClosing: { taxYear: 2034, amountJpy: 0, reference: 'actual zero' },
      }),
    )
    assert.equal(r.calculation!.depreciationJpy, 0)
    assert.equal(r.calculation!.closingBasisJpy, 0)
    assert.equal(
      calculateEquipmentPool(
        input({
          taxYear: 2035,
          priorClosing: { taxYear: 2034, amountJpy: 1, reference: 'wrong residual' },
        }),
      ).status,
      'inconsistent',
    )
  })
  it('handles purchase before the service year without inventing prior depreciation', () => {
    const f = input({ acquiredOn: '2025-12-01' })
    assert.equal(calculateEquipmentPool(f).status, 'missing-facts')
    f.priorClosing = { taxYear: 2025, amountJpy: 180001, reference: '未供用の実際の前年額' }
    assert.equal(calculateEquipmentPool(f).calculation!.depreciationJpy, 60001)
  })
  it('does not post before service, and rejects reverse dates or a conflicting election year', () => {
    assert.equal(calculateEquipmentPool(input({ taxYear: 2025 })).status, 'outside-period')
    assert.equal(
      calculateEquipmentPool(input({ businessUseStartedOn: '2026-03-31' })).status,
      'inconsistent',
    )
    assert.equal(
      calculateEquipmentPool(
        input({ poolElection: { serviceYear: 2025, reference: 'wrong', roundingConfirmed: true } }),
      ).status,
      'inconsistent',
    )
  })
  it('requires a documented original election, not a retroactive checkbox for a later year', () => {
    assert.equal(calculateEquipmentPool(input({ poolElection: undefined })).status, 'missing-facts')
    assert.equal(
      calculateEquipmentPool(
        input({ poolElection: { serviceYear: null, reference: '', roundingConfirmed: null } }),
      ).status,
      'missing-facts',
    )
  })
  it('keeps rental exceptions date-specific and does not infer unknown rental use', () => {
    assert.equal(calculateEquipmentPool(input({ rentalUse: 'other' })).status, 'unsupported')
    assert.equal(calculateEquipmentPool(input({ rentalUse: undefined })).status, 'missing-facts')
    assert.equal(
      calculateEquipmentPool(
        input({
          taxYear: 2021,
          acquiredOn: '2021-01-01',
          businessUseStartedOn: '2021-01-01',
          rentalUse: 'other',
          poolElection: {
            serviceYear: 2021,
            reference: 'actual election',
            roundingConfirmed: true,
          },
        }),
      ).status,
      'conditional',
    )
  })
  for (const patch of [
    { taxpayer: 'corporation' },
    { convertedFromPrivate: true },
    { assetKind: 'intangible' },
    { ordinaryTreatment: 'special-or-adjusted' },
  ] as const)
    it(
      'does not convert special conditions into ordinary arithmetic ' + JSON.stringify(patch),
      () => {
        assert.equal(calculateEquipmentPool(input(patch)).status, 'unsupported')
      },
    )
  it('rejects non-calendar dates and unsafe numeric values without throwing from BigInt', () => {
    for (const patch of [
      { businessUseStartedOn: '2026-02-30' },
      { acquisitionCostJpy: Number.MAX_SAFE_INTEGER + 1 },
      { taxYear: 2026.5 },
    ])
      assert.equal(calculateEquipmentPool(input(patch)).status, 'inconsistent')
  })
})
