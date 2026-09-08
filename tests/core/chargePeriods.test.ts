import { describe, expect, it } from 'vitest'

import {
  duplicateChargeGroups,
  overlappingChargeGroups,
  chargeReviewGroups,
  chargePeriodIsValid,
  chargePeriodCoversDate,
  monthlyAmountsForCharge,
  monthlyAmountsForCharges,
  type ProviderChargePeriod,
} from '../../src/core/chargePeriods.ts'

const charge = (patch: Partial<ProviderChargePeriod> = {}): ProviderChargePeriod => ({
  id: 'charge-1',
  provider: 'codex',
  planName: 'Standard',
  serviceStartedOn: '2026-01-20',
  serviceEndedOn: '2026-02-19',
  amountJpy: 3_101,
  ...patch,
})

describe('charge periods', () => {
  it('limits annual review groups to invoices serving that year without changing original periods', () => {
    const rows = [
      charge({ id: 'old', serviceStartedOn: '2026-12-01', serviceEndedOn: '2026-12-31' }),
      charge({ id: 'bridge', serviceStartedOn: '2026-12-31', serviceEndedOn: '2027-02-01' }),
      charge({ id: 'future', serviceStartedOn: '2027-02-01', serviceEndedOn: '2027-02-28' }),
    ]
    expect(chargeReviewGroups(rows, 2026)).toEqual([{ kind: 'overlap', ids: ['bridge', 'old'] }])
    expect(chargeReviewGroups(rows, 2027)).toEqual([{ kind: 'overlap', ids: ['bridge', 'future'] }])
    expect(chargeReviewGroups(rows, 2025)).toEqual([])
    expect(chargeReviewGroups(rows)).toEqual([
      { kind: 'overlap', ids: ['bridge', 'future', 'old'] },
    ])
    expect(() => chargeReviewGroups(rows, NaN)).toThrow(RangeError)
  })
  it('groups connected overlaps across year and month boundaries while keeping adjacent days separate', () => {
    const rows = [
      charge({ id: 'a', serviceStartedOn: '2025-12-20', serviceEndedOn: '2026-01-10' }),
      charge({
        id: 'b',
        serviceStartedOn: '2026-01-10',
        serviceEndedOn: '2026-02-01',
        amountJpy: null,
        unknownAmountReason: '未確認',
      }),
      charge({ id: 'c', serviceStartedOn: '2026-02-01', serviceEndedOn: '2026-02-10' }),
      charge({ id: 'adjacent', serviceStartedOn: '2026-02-11', serviceEndedOn: '2026-02-20' }),
      charge({
        id: 'other',
        provider: 'claude',
        serviceStartedOn: '2026-01-01',
        serviceEndedOn: '2026-02-20',
      }),
      charge({ id: 'invalid', serviceStartedOn: '2026-02-30' }),
    ]
    const before = structuredClone(rows)
    expect(overlappingChargeGroups(rows)).toEqual([['a', 'b', 'c']])
    expect(overlappingChargeGroups([...rows].reverse())).toEqual([['a', 'b', 'c']])
    expect(rows).toEqual(before)
    expect(chargeReviewGroups([charge({ id: 'x' }), charge({ id: 'y' })])).toEqual([
      { kind: 'duplicate', ids: ['x', 'y'] },
    ])
  })
  it('flags matching known original invoices without confusing monthly splits or unknown amounts', () => {
    const first = charge(),
      second = charge({ id: 'charge-2', planName: '別名称', billedOn: '2026-02-01' })
    const input = [
      first,
      second,
      charge({ id: 'other-provider', provider: 'claude' }),
      charge({ id: 'other-period', serviceEndedOn: '2026-02-20' }),
      charge({ id: 'other-price', amountJpy: 3100 }),
      charge({ id: 'unknown-a', amountJpy: null, unknownAmountReason: '不明' }),
      charge({ id: 'unknown-b', amountJpy: null, unknownAmountReason: '不明' }),
    ]
    const before = structuredClone(input)
    expect(duplicateChargeGroups(input)).toEqual([['charge-1', 'charge-2']])
    expect(input).toEqual(before)
    expect(duplicateChargeGroups([first, first])).toEqual([])
    expect(
      duplicateChargeGroups([charge({ amountJpy: 0 }), charge({ id: 'zero-2', amountJpy: 0 })]),
    ).toEqual([['charge-1', 'zero-2']])
  })
  it('keeps unknown amounts across years and propagates uncertainty only within each provider-month', () => {
    const unknown = charge({
      amountJpy: null,
      unknownAmountReason: '請求確認待ち',
      serviceStartedOn: '2025-12-01',
      serviceEndedOn: '2026-01-31',
    })
    expect(monthlyAmountsForCharge(unknown)).toEqual([
      { provider: 'codex', month: '2025-12', amountJpy: null },
      { provider: 'codex', month: '2026-01', amountJpy: null },
    ])
    for (const periods of [
      [unknown, charge()],
      [charge(), unknown],
    ]) {
      expect(monthlyAmountsForCharges([...periods, charge({ provider: 'claude' })])).toEqual([
        { provider: 'codex', month: '2025-12', amountJpy: null },
        { provider: 'claude', month: '2026-01', amountJpy: 1200 },
        { provider: 'codex', month: '2026-01', amountJpy: null },
        { provider: 'claude', month: '2026-02', amountJpy: 1901 },
        { provider: 'codex', month: '2026-02', amountJpy: 1901 },
      ])
    }
  })
  it('distinguishes zero from missing amounts and requires a reason only for missing amounts', () => {
    expect(chargePeriodIsValid(charge({ amountJpy: 0 }))).toBe(true)
    expect(monthlyAmountsForCharge(charge({ amountJpy: 0 })).map((row) => row.amountJpy)).toEqual([
      0, 0,
    ])
    for (const unknownAmountReason of [undefined, '', '   ']) {
      expect(chargePeriodIsValid(charge({ amountJpy: null, unknownAmountReason }))).toBe(false)
    }
    expect(chargePeriodIsValid(charge({ amountJpy: null, unknownAmountReason: '確認待ち' }))).toBe(
      true,
    )
    expect(chargePeriodIsValid(charge({ amountJpy: 0, unknownAmountReason: '確認待ち' }))).toBe(
      false,
    )
  })

  it('splits a cross-month service period and preserves the actual bill', () => {
    const result = monthlyAmountsForCharge(charge())
    expect(result).toEqual([
      { provider: 'codex', month: '2026-01', amountJpy: 1_200 },
      { provider: 'codex', month: '2026-02', amountJpy: 1_901 },
    ])
    expect(
      result.reduce((sum, item) => {
        if (item.amountJpy === null) throw new Error('Known bill produced unknown allocation')
        return sum + item.amountJpy
      }, 0),
    ).toBe(3_101)
  })

  it('aggregates plan changes in the same calendar month', () => {
    const result = monthlyAmountsForCharges([
      charge({
        id: 'old',
        serviceStartedOn: '2026-03-01',
        serviceEndedOn: '2026-03-15',
        amountJpy: 1_500,
      }),
      charge({
        id: 'new',
        serviceStartedOn: '2026-03-16',
        serviceEndedOn: '2026-03-31',
        amountJpy: 3_000,
      }),
    ])
    expect(result).toEqual([{ provider: 'codex', month: '2026-03', amountJpy: 4_500 }])
  })

  it('uses exact service dates for eligibility', () => {
    expect(chargePeriodCoversDate(charge(), '2026-01-19')).toBe(false)
    expect(chargePeriodCoversDate(charge(), '2026-01-20')).toBe(true)
    expect(chargePeriodCoversDate(charge(), '2026-02-19')).toBe(true)
    expect(chargePeriodCoversDate(charge(), '2026-02-20')).toBe(false)
  })

  it('rejects impossible calendar dates', () => {
    expect(
      chargePeriodIsValid(charge({ serviceStartedOn: '2026-02-31', serviceEndedOn: '2026-03-05' })),
    ).toBe(false)
  })
})
