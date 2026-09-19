import type { AnnualCostProjection } from '../../../src/accounting/costs.js'
import type { assembleSoftwareAcquisitionBasis } from '../../../src/core/softwareAcquisitionBasis.js'

type Context = Parameters<typeof assembleSoftwareAcquisitionBasis>[0]
function cost(year: number): AnnualCostProjection {
  return {
    version: 1, engineVersion: 'cost-projection/1', year, invariantSatisfied: true,
    sources: [{ id: `direct:${year}`, kind: 'direct', label: `${year}年の製作費`,
      originalAmountJpy: 60000, currency: 'JPY', evidenceIds: ['proof'], origin: 'entered' }],
    bases: [{ id: 'basis', sourceId: `direct:${year}`, parentContributionIds: [],
      affectedTaxUnitIds: ['software'], period: { startedOn: `${year}-01-01`, endedOn: `${year}-12-01` },
      amount: { status: 'known', amountJpy: 60000 },
      method: { id: 'entered-direct-cost', version: '1', explanation: '合成の製作原価' }, warnings: [] }],
    contributions: [{ id: 'part', basisId: 'basis', target: { kind: 'tax-unit', taxUnitId: 'software' },
      amountJpy: 60000, sourceIds: [`direct:${year}`], evidenceIds: ['proof'], reason: '製作へ対応' }],
    totals: { knownBasisJpy: 60000, taxUnitJpy: 60000, generalJpy: 0, privateJpy: 0,
      unallocatedJpy: 0, unobservedJpy: 0, roundingJpy: 0, unknownBasisIds: [] },
    byTaxUnit: [{ taxUnitId: 'software', name: '合成ソフト', amountJpy: 60000, contributionIds: ['part'], unknownBasisIds: [] }],
  }
}
export function fixture(): Context {
  return {
    occurredOn: '2026-12-31', constructionAccountId: 'construction',
    planning: {
      version: 1, profile: { taxYear: 2026, journeyMode: 'retrospective', incomeCategory: 'undecided',
        filingType: 'undecided', monetizationStatus: 'planned', hasBookkeeping: false },
      taxUnits: [{ id: 'software', name: '合成ソフト', unitType: 'new-software',
        usageMode: 'internal', revenueModel: 'efficiency', lifecycleStatus: 'developing' }],
      projectRules: [], lifecycleEvents: [], equipment: [], homeCosts: [], directCosts: [],
      evidence: [{ id: 'proof', evidenceType: 'receipt', strength: 'external',
        recordedAt: '2025-01-01T00:00:00Z', note: '合成の製作費明細' }], decisions: [],
    },
    snapshot: {
      version: 1,
      accounts: [
        { id: 'construction', name: '制作中', taxUnitId: 'software', kind: 'construction', openingYear: 2025, opening: { status: 'known', amountJpy: 0 } },
        { id: 'asset', name: '完成ソフト', taxUnitId: 'software', kind: 'asset', openingYear: 2026, opening: { status: 'known', amountJpy: 0 } },
      ],
      movements: [2025, 2026].map((year) => ({ id: `addition-${year}`, kind: 'addition', accountId: 'construction',
        occurredOn: `${year}-12-01`, amountJpy: 60000, sourceIds: [`direct:${year}`],
        decisionId: `production-${year}`, reason: '確認した製作原価',
        costAllocations: [{ costYear: year, contributionId: 'part', amountJpy: 60000 }] })),
      pendingDecisions: [],
    },
    costs: [cost(2025), cost(2026)],
    remaining: [2025, 2026].map((year) => ({ sourceKind: 'movement', sourceId: `addition-${year}`,
      accountId: 'construction', amountJpy: 60000, untracedJpy: 0,
      lots: [{ costYear: year, contributionId: 'part', amountJpy: 60000, remainingJpy: 60000 }],
      name: '制作中', availableOn: `${year}-12-01`, sourceIds: [`direct:${year}`] })),
    openingProblems: [], confirmedDecisionIds: [], openingReviews: [],
  }
}

