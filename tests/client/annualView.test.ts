import { describe, expect, it } from 'vitest'
import { annualAiView, billingMonthKey } from '../../src/client/annualView'
import { demoDashboard } from '../../src/client/dashboard'

describe('annual AI view', () => {
  it('keeps unknown bills in the correct year while excluding other years and undated months', () => {
    const data = structuredClone(demoDashboard)
    data.months = [
      { monthKey: '2025-12', label: '12月', current: 0, future: 0, review: 3100 },
      {
        monthKey: '2026-01',
        label: '1月',
        current: 100,
        future: 0,
        review: 3000,
        unknownChargeIds: ['unknown'],
      },
      { label: '2027年1月', current: 0, future: 0, review: 9000 },
      { label: '2月', current: 0, future: 0, review: 9999 },
    ]
    data.allocations = [2025, 2026, 2027].map((year) => ({
      ...data.allocations[0]!,
      id: String(year),
      monthKey: year + '-01',
      amount: year,
    }))
    const selected = annualAiView(data, 2026)
    expect(selected.months).toEqual([data.months[1]])
    expect(selected.allocations.map((row) => row.id)).toEqual(['2026'])
    expect(selected.undatedMonths).toBe(1)
    expect(annualAiView(data, 2028).months).toEqual([])
    expect(data.months).toHaveLength(4)
  })
  it('accepts explicit legacy year labels but never guesses the year from a short label', () => {
    expect(billingMonthKey({ label: '2026年7月' })).toBe('2026-07')
    expect(billingMonthKey({ month: '2025年12月' })).toBe('2025-12')
    for (const label of ['7月', '2026年13月', '2026年0月', '2026年7月追加']) {
      expect(billingMonthKey({ label })).toBeUndefined()
    }
  })
})
