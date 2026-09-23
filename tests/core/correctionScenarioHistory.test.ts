import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { ReviewMaterials } from '../../src/accounting/reviewMaterials.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { historicalReviewMaterials } from '../../src/core/reviewHistory.js'
const balances = {
  version: 1,
  accounts: [],
  movements: [],
  pendingDecisions: [],
} as BalanceSnapshot
function material(): ReviewMaterials {
  return {
    year: 2026,
    timeZone: 'Asia/Tokyo',
    observations: [],
    planning: {
      taxUnits: [],
      directCosts: [],
      homeCosts: [],
      equipment: [],
      decisions: [],
      evidence: [{ id: 'proof', note: '製作の根拠' }],
      costTreatmentFacts: [
        {
          id: 'fact',
          costYear: 2026,
          contributionId: 'cost',
          recordedAt: '2026-01-01T00:00:00Z',
          reason: '製作に対応',
          workPurpose: 'new-development',
          evidenceIds: ['proof'],
          methodComparison: { throughYear: 2030, usefulLifeYears: 5, reason: '未採用の試算' },
        },
      ],
    },
    costs: {
      year: 2026,
      sources: [{ id: 'source', originalAmountJpy: 120000, evidenceIds: ['proof'] }],
      contributions: [{ id: 'cost', amountJpy: 120000, evidenceIds: ['proof'] }],
      treatments: {
        items: [{ contributionId: 'cost', futureCostJpy: 120000 }],
        methodComparisons: [
          { ownerFactsId: 'fact', scenarios: [{ years: [{ year: 2030, expenseJpy: 24000 }] }] },
        ],
      },
    },
  } as unknown as ReviewMaterials
}
const history = (m: ReviewMaterials) => historicalReviewMaterials(m, balances)
describe('C04 unadopted comparisons are not historical production facts', () => {
  it('does not require a correction for a display horizon or edit timestamp', () => {
    const old = material(),
      next = structuredClone(old)
    next.planning.costTreatmentFacts![0]!.methodComparison!.throughYear = 2040
    next.planning.costTreatmentFacts![0]!.recordedAt = '2026-09-20T00:00:00Z'
    next.costs.treatments!.methodComparisons = []
    assert.deepEqual(history(next), history(old))
  })
  it('compares hypothetical methods without changing the fixed record', () => {
    const old = material(),
      before = structuredClone(old),
      next = structuredClone(old)
    next.planning.costTreatmentFacts![0]!.methodComparison!.usefulLifeYears = 3
    next.planning.costTreatmentFacts![0]!.methodComparison!.reason = '比較だけを変更'
    next.costs.treatments!.methodComparisons = []
    assert.deepEqual(history(next), history(old))
    assert.deepEqual(old, before)
  })
  for (const kind of [
    'production-facts',
    'proof',
    'original-cost',
    'qualified-amount',
    'confirmed-decision',
  ])
    it('still detects actual ' + kind + ' changes', () => {
      const old = material(),
        next = structuredClone(old)
      if (kind === 'production-facts') next.planning.costTreatmentFacts![0]!.reason = '別の実態'
      if (kind === 'proof') next.planning.evidence[0]!.note = '別の根拠'
      if (kind === 'original-cost') next.costs.sources[0]!.originalAmountJpy = 130000
      if (kind === 'qualified-amount') next.costs.treatments!.items[0]!.futureCostJpy = 110000
      if (kind === 'confirmed-decision')
        next.planning.decisions.push({
          id: 'chosen',
          taxYear: 2026,
          selectedCandidate: 'ordinary-expense',
        } as never)
      assert.notDeepEqual(history(next), history(old))
    })
  it('applies the same distinction to linked earlier-year costs', () => {
    const old = material(),
      prior = structuredClone(old.costs)
    prior.year = 2025
    old.costLinks = { costs: [prior] } as ReviewMaterials['costLinks']
    const next = structuredClone(old)
    next.costLinks!.costs[0]!.treatments!.methodComparisons = []
    assert.deepEqual(history(next), history(old))
    next.costLinks!.costs[0]!.sources[0]!.originalAmountJpy = 130000
    assert.notDeepEqual(history(next), history(old))
  })
  it('does not synthesize treatment fields in old records', () => {
    const old = material()
    delete old.costs.treatments
    delete old.planning.costTreatmentFacts
    const result = history(old) as { costs: Record<string, unknown> }
    assert.equal(Object.hasOwn(result.costs, 'treatments'), false)
    assert.equal(Object.hasOwn(result, 'costTreatmentFacts'), false)
  })
})
