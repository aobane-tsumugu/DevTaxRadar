import { describe, expect, it } from 'vitest'

import { buildFilingScenarios } from '../../src/core/filingScenarios.ts'

describe('filing scenario comparison', () => {
  it('compares every scenario against the same fact totals', () => {
    const scenarios = buildFilingScenarios({ current: 12_000, future: 34_000, review: 5_000 })

    expect(scenarios).toHaveLength(3)
    for (const scenario of scenarios) {
      expect(scenario).toMatchObject({
        currentExpenseCandidateJpy: 12_000,
        futureCostCandidateJpy: 34_000,
        reviewJpy: 5_000,
      })
    }
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'miscellaneous',
      'business-white',
      'business-blue',
    ])
  })
})
