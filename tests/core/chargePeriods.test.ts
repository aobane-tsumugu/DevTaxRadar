import { describe, expect, it } from 'vitest'

import {
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
  it('splits a cross-month service period and preserves the actual bill', () => {
    const result = monthlyAmountsForCharge(charge())
    expect(result).toEqual([
      { provider: 'codex', month: '2026-01', amountJpy: 1_200 },
      { provider: 'codex', month: '2026-02', amountJpy: 1_901 },
    ])
    expect(result.reduce((sum, item) => sum + item.amountJpy, 0)).toBe(3_101)
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
