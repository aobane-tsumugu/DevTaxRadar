import type { AnnualCostProjection } from '../../../src/accounting/costs.js'
import type { BalanceSnapshot } from '../../../src/accounting/types.js'
import type { PlanningSnapshot } from '../../../src/planning/types.js'
import { ANNUAL_METHOD_RULE } from '../../../src/core/annualMethodComparison.js'

export function acquisitionFixture() {
  const planning: PlanningSnapshot = {
    version: 1,
    profile: {
      taxYear: 2026,
      journeyMode: 'retrospective',
      incomeCategory: 'business',
      filingType: 'blue',
      monetizationStatus: 'planned',
      hasBookkeeping: true,
    },
    taxUnits: [
      {
        id: 'software',
        name: '合成ソフト',
        unitType: 'new-software',
        usageMode: 'internal',
        revenueModel: 'efficiency',
        lifecycleStatus: 'developing',
      },
    ],
    evidence: [
      {
        id: 'proof',
        evidenceType: 'memo',
        strength: 'external',
        recordedAt: '2025-01-01T00:00:00Z',
        note: '合成の外部原価根拠',
        localReference: 'PRIVATE-LOCAL-PATH',
      },
    ],
    projectRules: [],
    lifecycleEvents: [],
    equipment: [],
    homeCosts: [],
    directCosts: [],
    decisions: [],
  }
  const costs = [2025, 2026].map((year): AnnualCostProjection => ({
    version: 1,
    engineVersion: 'cost-projection/1',
    year,
    invariantSatisfied: true,
    sources: [
      {
        id: 'direct:' + year,
        kind: 'direct',
        label: '合成原価' + year,
        originalAmountJpy: 60000,
        currency: 'JPY',
        evidenceIds: ['proof'],
        origin: 'entered',
      },
    ],
    bases: [
      {
        id: 'basis:' + year,
        sourceId: 'direct:' + year,
        parentContributionIds: [],
        affectedTaxUnitIds: ['software'],
        period: { startedOn: year + '-01-01', endedOn: year + '-12-31' },
        amount: { status: 'known', amountJpy: 60000 },
        method: { id: 'entered', version: '1', explanation: '合成の費用配分' },
        warnings: [],
      },
    ],
    contributions: [
      {
        id: 'part:' + year,
        basisId: 'basis:' + year,
        target: { kind: 'tax-unit', taxUnitId: 'software' },
        amountJpy: 60000,
        evidenceIds: ['proof'],
        sourceIds: ['direct:' + year],
        reason: '合成の製作原価',
      },
    ],
    totals: {
      knownBasisJpy: 60000,
      taxUnitJpy: 60000,
      generalJpy: 0,
      privateJpy: 0,
      unallocatedJpy: 0,
      unobservedJpy: 0,
      roundingJpy: 0,
      unknownBasisIds: [],
    },
    byTaxUnit: [
      {
        taxUnitId: 'software',
        name: '合成ソフト',
        amountJpy: 60000,
        contributionIds: ['part:' + year],
        unknownBasisIds: [],
      },
    ],
  }))
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'production',
        taxUnitId: 'software',
        name: '製作原価',
        kind: 'construction',
        openingYear: 2025,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    movements: [2025, 2026].map((year) => ({
      id: 'add:' + year,
      kind: 'addition' as const,
      occurredOn: year + '-12-31',
      accountId: 'production',
      amountJpy: 60000,
      decisionId: 'decision:' + year,
      reason: '合成の原価組入れ',
      sourceIds: ['direct:' + year],
      costAllocations: [{ costYear: year, contributionId: 'part:' + year, amountJpy: 60000 }],
    })),
    pendingDecisions: [],
  }
  return { planning, costs, snapshot }
}

import {
  inspectSoftwareAcquisition,
  draftSoftwareAcquisition,
} from '../../../src/core/softwareAcquisitionDraft.js'
import { chooseSoftwareMethod } from '../../../src/core/softwareMethodDraft.js'
import type { SoftwareMethod } from '../../../src/core/softwareMethod.js'
export function methodFixture(method: SoftwareMethod['method'] = 'straight-line', total = 120000) {
  const f = acquisitionFixture()
  for (const year of [2025, 2026]) {
    const cost = f.costs.find((c) => c.year === year)!
    const amount = year === 2025 ? Math.floor(total / 2) : total - Math.floor(total / 2)
    cost.sources[0]!.originalAmountJpy = amount
    cost.bases[0]!.amount = { status: 'known', amountJpy: amount }
    cost.bases[0]!.period.endedOn = year === 2026 ? '2026-06-30' : '2025-12-31'
    cost.contributions[0]!.amountJpy = amount
    cost.totals.knownBasisJpy = cost.totals.taxUnitJpy = amount
    const movement = f.snapshot.movements.find((m) => m.id === 'add:' + year)!
    movement.amountJpy = amount
    movement.occurredOn = cost.bases[0]!.period.endedOn
    if (movement.kind === 'addition') movement.costAllocations![0]!.amountJpy = amount
  }
  const makeDecision = (year: number, candidate: string, id: string) => ({
    id,
    taxUnitId: 'software',
    taxYear: year,
    engineVersion: 'manual-decision/1',
    candidate,
    selectedCandidate: candidate,
    status: 'confirmed' as const,
    reason: '合成の対象年の方法・年額確認',
    createdAt: year + '-07-01T00:00:00Z',
    confirmedAt: year + '-07-01T01:00:00Z',
  })
  f.planning.decisions = [
    makeDecision(2025, 'software-acquisition-cost', 'decision:2025'),
    makeDecision(2026, 'software-acquisition-cost', 'decision:2026'),
    ...Array.from({ length: 8 }, (_, i) =>
      makeDecision(2026 + i, 'ordinary-expense', 'expense:' + (2026 + i)),
    ),
  ]
  f.snapshot.accounts.push({
    id: 'asset',
    name: '完成ソフト',
    taxUnitId: 'software',
    kind: 'asset',
    openingYear: 2026,
    opening: { status: 'known', amountJpy: 0 },
  })
  const basis = inspectSoftwareAcquisition(
    f.snapshot,
    f.planning,
    f.costs,
    'production',
    '2026-06-30',
  )
  const acquisitionId = 'balance-use:11111111-1111-4111-8111-111111111111'
  f.snapshot = draftSoftwareAcquisition(f.snapshot, f.planning, f.costs, {
    requestId: acquisitionId.slice('balance-use:'.length),
    constructionAccountId: 'production',
    toAccountId: 'asset',
    occurredOn: '2026-06-30',
    decisionId: 'decision:2026',
    reason: '2年度の同じソフト原価全額を確認',
    evidenceIds: ['proof'],
    completeCostConfirmed: true,
    expectedAmountJpy: total,
    expectedSources: basis.sources.map((row) => ({
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      amountJpy: row.amountJpy!,
    })),
  })
  const unselected = structuredClone(f.snapshot)
  f.snapshot = chooseSoftwareMethod(f.snapshot, f.planning, 'asset', {
    acquisitionMovementId: acquisitionId,
    method,
    usedOn: '2026-07-01',
    usefulLifeYears: method === 'straight-line' ? 5 : null,
    businessOnly: true,
    ordinaryConditions: true,
    rentalUse: 'none',
    roundingConfirmed: ['straight-line', 'three-year-pool'].includes(method),
    ...(method === 'blue-special'
      ? {
          blueSpecial: {
            version: 1 as const,
            ruleVersion: ANNUAL_METHOD_RULE.version,
            filingType: 'blue' as const,
            incomeCategory: 'business' as const,
            eligibleSmallBusiness: true as const,
            annualSpecialUsedJpy: 0,
            businessMonths: 12,
            statementReady: true as const,
          },
        }
      : {}),
    allocationPolicy: 'proportional-largest-remainder',
    evidenceIds: ['proof'],
    reason: '業務用ソフト全体原価・適用方法・端数条件を確認',
    confirmedAt: '2026-07-01T00:00:00Z',
  })
  return { ...f, unselected, acquisitionId }
}
export const expenseInput = (year: number) => ({
  accountId: 'asset',
  year,
  requestId: `22222222-2222-4222-8222-${String(year).padStart(12, '0')}`,
  decisionId: 'expense:' + year,
  ordinaryYearConfirmed: true,
})
