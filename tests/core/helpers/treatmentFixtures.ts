import type { AnnualCostProjection, ExpenseSourceKind } from '../../../src/accounting/costs.js'
import type { PlanningSnapshot } from '../../../src/planning/types.js'
import type { CostTreatmentFacts } from '../../../src/core/costTreatmentFacts.js'
import { costTreatmentBasis, newCostTreatmentFacts } from '../../../src/core/costTreatments.js'

export function fixture(kind: ExpenseSourceKind = 'direct', amountJpy = 1000) {
  const planning: PlanningSnapshot = {
    version: 1,
    profile: { taxYear: 2026, journeyMode: 'retrospective', incomeCategory: 'undecided',
      filingType: 'undecided', monetizationStatus: 'planned', hasBookkeeping: false },
    taxUnits: [{ id: 'unit', name: '合成制作物', unitType: 'new-software', usageMode: 'internal',
      revenueModel: 'efficiency', lifecycleStatus: 'developing' }],
    projectRules: [], lifecycleEvents: [], equipment: [], homeCosts: [], directCosts: [], decisions: [],
    evidence: [{ id: 'proof', evidenceType: 'memo', strength: 'self-recorded',
      recordedAt: '2026-01-01T00:00:00Z', note: '作業実態の合成根拠', localReference: 'PRIVATE-LOCAL-REFERENCE' }],
  }
  const costs: AnnualCostProjection = {
    version: 1, year: 2026, engineVersion: 'cost-projection/1', invariantSatisfied: true,
    sources: [{ id: 'source', kind, originalAmountJpy: amountJpy, currency: 'JPY', label: '合成費用',
      evidenceIds: ['proof'], origin: 'entered' }],
    bases: [{ id: 'basis', sourceId: 'source', parentContributionIds: [], affectedTaxUnitIds: ['unit'],
      period: { startedOn: '2026-01-01', endedOn: '2026-01-31' }, amount: { status: 'known', amountJpy },
      method: { id: 'entered', version: '1', explanation: '合成の既存配分' }, warnings: [] }],
    contributions: [{ id: 'part', basisId: 'basis', target: { kind: 'tax-unit', taxUnitId: 'unit' },
      amountJpy, reason: '合成の最終配分', evidenceIds: ['proof'], sourceIds: ['source'] }],
    totals: { knownBasisJpy: amountJpy, taxUnitJpy: amountJpy, generalJpy: 0, privateJpy: 0,
      unallocatedJpy: 0, unobservedJpy: 0, roundingJpy: 0, unknownBasisIds: [] },
    byTaxUnit: [{ taxUnitId: 'unit', name: '合成制作物', amountJpy, contributionIds: ['part'], unknownBasisIds: [] }],
  }
  return { costs, planning }
}
export function addFacts(f: ReturnType<typeof fixture>, patch: Partial<CostTreatmentFacts> = {}) {
  const fact: CostTreatmentFacts = {
    ...newCostTreatmentFacts(f.costs, f.planning, 'part', 'facts', '2026-09-18T00:00:00Z'),
    workPurpose: 'new-development', placedInService: 'before', assetKind: 'software',
    directlyAttributable: true, serviceProvidedInCurrentPeriod: true,
    reason: '供用前の製作へ直接対応する根拠を記録', evidenceIds: ['proof'], ...patch,
  }
  fact.costBasis = costTreatmentBasis(f.costs, f.planning, fact.contributionId, fact.evidenceIds)
  f.planning.costTreatmentFacts = [fact]
  return fact
}
