import { describe, expect, it } from 'vitest'
import {
  calculateEquipmentDepreciation,
  type EquipmentDepreciationInput,
} from '../../src/core/equipmentDepreciation.js'

function fixture(): EquipmentDepreciationInput {
  return {
    equipmentId: 'pc',
    taxYear: 2026,
    taxpayer: 'individual',
    assetKind: 'tangible-equipment',
    method: 'straight-line',
    methodReason: '確認した方法による試算',
    acquisitionCostJpy: 1_000_000,
    acquiredOn: '2026-01-01',
    businessUseStartedOn: '2026-01-01',
    usefulLifeYears: 10,
    convertedFromPrivate: false,
    useThroughYearEnd: 'confirmed',
    ordinaryTreatment: 'confirmed',
    priorClosing: null,
  }
}
describe('ordinary straight-line equipment scenario', () => {
  it('reproduces the NTA ten-year example and conserves the full-asset balance down to one yen', () => {
    const input = fixture()
    let previous = input.acquisitionCostJpy!
    let total = 0
    for (let i = 0; i < 11; i++) {
      input.taxYear = 2026 + i
      input.priorClosing = i
        ? {
            taxYear: input.taxYear - 1,
            amountJpy: previous,
            reference: `scenario-${input.taxYear - 1}`,
          }
        : null
      const before = structuredClone(input)
      const result = calculateEquipmentDepreciation(input)
      expect(input).toEqual(before)
      expect(result.status).toBe('conditional')
      expect(result.taxTreatmentVerified).toBe(false)
      const calculation = result.calculation!
      expect(calculation.depreciationJpy).toBe(i < 9 ? 100000 : i === 9 ? 99999 : 0)
      expect(calculation.openingBasisJpy).toBe(previous)
      expect(calculation.depreciationJpy + calculation.closingBasisJpy).toBe(previous)
      previous = calculation.closingBasisJpy
      total += calculation.depreciationJpy
    }
    expect(total).toBe(999999)
    expect(previous).toBe(1)
  })
  it('uses the statutory rate, started month and upward yen rounding instead of division by life', () => {
    const input = {
      ...fixture(),
      acquisitionCostJpy: 100001,
      usefulLifeYears: 3,
      businessUseStartedOn: '2026-12-31',
    }
    const result = calculateEquipmentDepreciation(input)
    expect(result.calculation).toMatchObject({
      rateNumerator: 334,
      months: 1,
      depreciationJpy: 2784,
      closingBasisJpy: 97217,
      capped: false,
    })
    input.businessUseStartedOn = '2026-07-31'
    expect(calculateEquipmentDepreciation(input).calculation?.depreciationJpy).toBe(16701)
    input.usefulLifeYears = 6
    expect(calculateEquipmentDepreciation(input).calculation?.rateNumerator).toBe(167)
  })
  it('does not invent cost, start date, method, continuing use, or the prior closing balance', () => {
    const input = fixture()
    for (const change of [
      { acquisitionCostJpy: null },
      { businessUseStartedOn: null },
      { usefulLifeYears: null },
      { method: 'unknown' as const },
      { methodReason: '' },
      { useThroughYearEnd: 'unknown' as const },
      { ordinaryTreatment: 'unknown' as const },
      { convertedFromPrivate: null },
      { taxpayer: 'unknown' as const },
    ]) {
      const result = calculateEquipmentDepreciation({ ...input, ...change })
      expect(result.status).toBe('missing-facts')
      expect(result.calculation).toBeNull()
      expect(result.reasons.length).toBeGreaterThan(0)
    }
    input.acquiredOn = '2025-01-01'
    expect(calculateEquipmentDepreciation(input).reasons).toContain(
      '前年末の設備全体の未償却残高と参照先',
    )
  })
  it('does not substitute ordinary individual straight-line for unsupported tax treatments', () => {
    for (const change of [
      { taxpayer: 'corporation' as const },
      { assetKind: 'intangible' as const },
      { method: 'other' as const },
      { acquiredOn: '2007-03-31' },
      { convertedFromPrivate: true },
      { usefulLifeYears: 51 },
      { useThroughYearEnd: 'ended-or-interrupted' as const },
      { ordinaryTreatment: 'special-or-adjusted' as const },
    ]) {
      expect(calculateEquipmentDepreciation({ ...fixture(), ...change })).toMatchObject({
        status: 'unsupported',
        calculation: null,
      })
    }
  })
  it('distinguishes inconsistent facts and outside-period use from an unknown or a confirmed zero amount', () => {
    expect(calculateEquipmentDepreciation({ ...fixture(), acquisitionCostJpy: 0 }).status).toBe(
      'inconsistent',
    )
    expect(
      calculateEquipmentDepreciation({ ...fixture(), businessUseStartedOn: '2025-12-31' }).status,
    ).toBe('inconsistent')
    expect(
      calculateEquipmentDepreciation({ ...fixture(), businessUseStartedOn: '2027-01-01' }),
    ).toMatchObject({ status: 'outside-period', calculation: null })
    const input = { ...fixture(), acquiredOn: '2025-01-01' }
    for (const priorClosing of [
      { taxYear: 2024, amountJpy: 100, reference: 'old' },
      { taxYear: 2025, amountJpy: 1000001, reference: 'too-much' },
      { taxYear: 2025, amountJpy: 0, reference: 'disposed' },
    ])
      expect(calculateEquipmentDepreciation({ ...input, priorClosing }).status).toBe('inconsistent')
    expect(
      calculateEquipmentDepreciation({
        ...input,
        priorClosing: { taxYear: 2025, amountJpy: 1, reference: 'fully-depreciated' },
      }).calculation?.depreciationJpy,
    ).toBe(0)
  })
  it('uses exact integer intermediates and rejects invalid dates and unsafe money', () => {
    const input = { ...fixture(), acquisitionCostJpy: Number.MAX_SAFE_INTEGER, usefulLifeYears: 2 }
    expect(calculateEquipmentDepreciation(input).calculation?.depreciationJpy).toBe(
      4503599627370496,
    )
    expect(() =>
      calculateEquipmentDepreciation({ ...input, acquisitionCostJpy: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow()
    expect(() => calculateEquipmentDepreciation({ ...input, acquiredOn: '2026-02-30' })).toThrow()
  })
})
