import { describe, expect, it } from 'vitest'
import { decideTaxCandidate } from '../../src/core/taxDecision.js'
import type { TaxDecisionInput } from '../../src/core/types.js'

describe('uncertain business share and confirmation', () => {
  it.each<TaxDecisionInput>([
    {
      amountJpy: 10000,
      businessUse: 'mixed',
      workPurpose: 'maintenance',
      placedInService: 'after',
    },
    {
      amountJpy: 10000,
      businessUse: 'unknown',
      workPurpose: 'new-development',
      placedInService: 'before',
      directlyAttributable: true,
    },
    {
      amountJpy: 10000,
      businessUse: 'mixed',
      workPurpose: 'ordinary-operation',
      placedInService: 'after',
      serviceProvidedInCurrentPeriod: false,
    },
    { amountJpy: 0, businessUse: 'unknown', workPurpose: 'maintenance', placedInService: 'after' },
  ])('does not replace an unknown share with the entire original amount: %j', (input) => {
    const result = decideTaxCandidate({ ...input, userConfirmed: true })
    expect(result.currentYearExpenseEstimate).toBeNull()
    expect(result.futureBalanceEstimate).toBeNull()
    expect(result.estimateStatus).toBe('not-calculated')
    expect(result.userConfirmationRequired).toBe(true)
  })

  it('keeps confirmed zero separate from an unknown share', () => {
    const result = decideTaxCandidate({
      amountJpy: 0,
      businessUse: 'business',
      workPurpose: 'maintenance',
      placedInService: 'after',
      userConfirmed: true,
    })
    expect(result.currentYearExpenseEstimate).toBe(0)
    expect(result.estimateStatus).toBe('estimated')
  })

  it('does not ask for the same confirmation solely because evidence confidence is medium', () => {
    const result = decideTaxCandidate({
      amountJpy: 10000,
      businessUse: 'mixed',
      privateUseRatio: 0.2,
      workPurpose: 'maintenance',
      placedInService: 'after',
      userConfirmed: true,
    })
    expect(result.currentYearExpenseEstimate).toBe(8000)
    expect(result.confidence).toBe('medium')
    expect(result.userConfirmationRequired).toBe(false)
  })

  it('does not request a business ratio for a wholly excluded and confirmed private activity', () => {
    const result = decideTaxCandidate({
      amountJpy: 10000,
      businessUse: 'private',
      workPurpose: 'hobby',
      placedInService: 'unknown',
      userConfirmed: true,
    })
    expect(result.currentYearExpenseEstimate).toBe(0)
    expect(result.missingFacts).toEqual([])
    expect(result.userConfirmationRequired).toBe(false)
  })

  it.each([NaN, Infinity, -0.1, 1.1])(
    'rejects an invalid supplied ratio (%s), even if another flag excludes it',
    (privateUseRatio) => {
      expect(() =>
        decideTaxCandidate({
          amountJpy: 1,
          businessUse: 'private',
          privateUseRatio,
          workPurpose: 'hobby',
          placedInService: 'unknown',
        }),
      ).toThrow(RangeError)
    },
  )
})
