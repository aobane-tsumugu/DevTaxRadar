import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { ReviewMaterials } from '../../src/accounting/reviewMaterials.js'
import type { AnnualCostProjection } from '../../src/accounting/costs.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { historicalReviewMaterials } from '../../src/core/reviewHistory.js'

function costs(year: number): AnnualCostProjection {
  return {
    version: 1, engineVersion: 'cost-projection/1', year,
    sources: [], bases: [], contributions: [], byTaxUnit: [], invariantSatisfied: true,
    totals: {
      knownBasisJpy: 0, taxUnitJpy: 0, generalJpy: 0, privateJpy: 0,
      unallocatedJpy: 0, unobservedJpy: 0, roundingJpy: 0, unknownBasisIds: [],
    },
  }
}

function fixture() {
  const prior = costs(2025)
  prior.sources = [{
    id: 'direct:old', kind: 'direct', label: '過年度の合成費用',
    originalAmountJpy: 1000, currency: 'JPY', incurredOn: '2025-12-01',
    evidenceIds: ['receipt'], origin: 'legacy-planning',
  }]
  prior.bases = [{
    id: 'basis', sourceId: 'direct:old', parentContributionIds: [], affectedTaxUnitIds: [],
    period: { startedOn: '2025-12-01', endedOn: '2025-12-01' },
    amount: { status: 'known', amountJpy: 1000 },
    method: { id: 'entered-direct-cost', version: '1', explanation: '合成の費用基礎' },
    warnings: [],
  }]
  prior.contributions = [{
    id: 'lot', basisId: 'basis', target: { kind: 'tax-unit', taxUnitId: 'u' },
    amountJpy: 1000, reason: '制作物への対応', evidenceIds: ['allocation-evidence'],
    sourceIds: ['direct:old'],
  }]
  prior.totals.knownBasisJpy = prior.totals.taxUnitJpy = 1000
  prior.byTaxUnit = [{
    taxUnitId: 'u', name: '合成アプリ', amountJpy: 1000,
    contributionIds: ['lot'], unknownBasisIds: [],
  }]
  const balances: BalanceSnapshot = {
    version: 1,
    accounts: [{
      id: 'a', taxUnitId: 'u', name: '制作中', kind: 'construction', openingYear: 2026,
      opening: { status: 'known', amountJpy: 0 },
    }],
    movements: [{
      id: 'm', kind: 'addition', accountId: 'a', occurredOn: '2026-01-01',
      amountJpy: 1000, sourceIds: ['direct:old'], decisionId: 'd', reason: '過年度原価の対応',
      costAllocations: [{ costYear: 2025, contributionId: 'lot', amountJpy: 1000 }],
    }],
    pendingDecisions: [],
  }
  const material: ReviewMaterials = {
    schemaVersion: 1, engineVersion: 'review-materials/1', year: 2026,
    workspaceRevision: 1, timeZone: 'Asia/Tokyo',
    configuration: {
      charges: { claude: 0, codex: 0 }, monthlyCharges: [], chargePeriods: [],
      contracts: { claude: {}, codex: {} }, unobservedRatio: null,
    },
    planning: {
      version: 1,
      profile: {
        taxYear: 2026, journeyMode: 'early', incomeCategory: 'undecided',
        filingType: 'undecided', monetizationStatus: 'planned', hasBookkeeping: false,
      },
      taxUnits: [{
        id: 'u', name: '合成アプリ', unitType: 'new-software',
        usageMode: 'internal', revenueModel: 'efficiency', lifecycleStatus: 'developing',
      }],
      projectRules: [], lifecycleEvents: [], equipment: [], homeCosts: [], directCosts: [{
        id: 'old', incurredOn: '2025-12-01', costType: 'other', amountJpy: 1000,
        directlyAttributable: true, treatment: 'direct', taxUnitId: 'u', evidenceIds: ['receipt'],
      }],
      evidence: ['receipt', 'allocation-evidence', 'refund-evidence', 'unrelated'].map((id): ReviewMaterials['planning']['evidence'][number] => ({
        id, evidenceType: 'receipt', strength: 'external',
        recordedAt: '2025-12-01T00:00:00Z', note: '合成資料 ' + id,
      })),
      decisions: [{
        id: 'd', taxUnitId: 'u', taxYear: 2026, engineVersion: 'manual-decision/1',
        candidate: '記録', selectedCandidate: '記録', reason: '合成資料による確認',
        status: 'confirmed', createdAt: '2026-01-01T00:00:00Z',
        confirmedAt: '2026-01-02T00:00:00Z',
      }],
    },
    observations: [], scanTimeZones: {}, recentScans: [], costs: costs(2026),
    referenceCheck: { engineVersion: 'balance-references/1', status: 'consistent', issues: [] },
    costLinks: {
      costs: [prior],
      check: {
        engineVersion: 'balance-cost-provenance/1', year: 2026, status: 'consistent',
        scope: 'addition-cost-links-only', issues: [],
        additions: [{ movementId: 'm', amountJpy: 1000, linkedJpy: 1000, unlinkedJpy: 0 }],
        contributions: [{
          costYear: 2025, contributionId: 'lot', availableJpy: 1000,
          claimedJpy: 1000, remainingJpy: 0, movementIds: ['m'],
        }],
      },
    },
    taxTreatmentVerified: false,
  }
  const signature = () => JSON.stringify(historicalReviewMaterials(material, balances))
  return { material, balances, prior, signature }
}

function freeze(value: unknown) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(freeze)
  }
}

describe('historical evidence for linked cost years', () => {
  it('detects a changed linked receipt even when amount and evidence ID stay the same', () => {
    const f = fixture()
    const before = f.signature()
    f.material.planning.evidence[0]!.note = '同じIDの証拠内容を訂正'
    assert.notEqual(f.signature(), before)
    assert.equal(f.prior.totals.knownBasisJpy, 1000)
  })

  it('detects removal of a linked receipt rather than treating it as unchanged history', () => {
    const f = fixture()
    const before = f.signature()
    f.material.planning.evidence = f.material.planning.evidence.filter((row) => row.id !== 'receipt')
    assert.notEqual(f.signature(), before)
  })

  it('detects a changed recorded time for a linked receipt', () => {
    const f = fixture()
    const before = f.signature()
    f.material.planning.evidence[0]!.recordedAt = '2026-01-01T00:00:00Z'
    assert.notEqual(f.signature(), before)
  })

  it('binds allocation evidence as well as the original payment evidence', () => {
    const f = fixture()
    const before = f.signature()
    f.material.planning.evidence[1]!.note = '配賦根拠を訂正'
    assert.notEqual(f.signature(), before)
  })

  it('binds evidence for a refund fact embedded in the linked cost projection', () => {
    const f = fixture()
    f.prior.sources[0]!.adjustments = [{
      id: 'refund', sourceId: 'direct:old', sourceYear: 2025,
      sourceBasis: { kind: 'direct', originalAmountJpy: 1000, incurredOn: '2025-12-01' },
      kind: 'refund', amountJpy: -100, occurredOn: '2025-12-20',
      recordedAt: '2025-12-20T00:00:00Z', effect: 'undetermined',
      reason: '返金の事実だけを記録', evidenceIds: ['refund-evidence'],
    }]
    f.material.planning.sourceAdjustments = structuredClone(f.prior.sources[0]!.adjustments)
    const before = f.signature()
    f.material.planning.evidence[2]!.note = '過年度の返金根拠を訂正'
    assert.notEqual(f.signature(), before)
  })

  it('still ignores evidence not used by this material or its linked cost inputs', () => {
    const f = fixture()
    const before = f.signature()
    f.material.planning.evidence[3]!.note = '無関係な資料の変更'
    assert.equal(f.signature(), before)
  })

  it('does not include an unlinked future expense or its evidence', () => {
    const f = fixture()
    const before = f.signature()
    f.material.planning.directCosts.push({
      id: 'future', incurredOn: '2027-01-01', costType: 'other', amountJpy: 500,
      directlyAttributable: true, treatment: 'direct', taxUnitId: 'u', evidenceIds: ['future'],
    })
    f.material.planning.evidence.push({
      id: 'future', evidenceType: 'receipt', strength: 'external',
      recordedAt: '2027-01-01T00:00:00Z', note: '翌年の資料',
    })
    assert.equal(f.signature(), before)
  })

  it('does not turn evidence ordering into a historical correction', () => {
    const f = fixture()
    const before = f.signature()
    f.material.planning.evidence.reverse()
    assert.equal(f.signature(), before)
  })

  it('keeps legacy materials without linked costs readable and ignores unrelated old evidence', () => {
    const f = fixture()
    delete f.material.costLinks
    const before = f.signature()
    f.material.planning.evidence[0]!.note = '未使用の過年度資料'
    assert.equal(f.signature(), before)
  })

  it('continues to bind evidence referenced directly by a current movement', () => {
    const f = fixture()
    delete f.material.costLinks
    f.balances.movements[0]!.sourceIds.push('receipt')
    const before = f.signature()
    f.material.planning.evidence[0]!.note = '当年の根拠を変更'
    assert.notEqual(f.signature(), before)
  })

  it('keeps the same comparison after JSON save and reload', () => {
    const f = fixture()
    assert.equal(
      JSON.stringify(historicalReviewMaterials(
        JSON.parse(JSON.stringify(f.material)), JSON.parse(JSON.stringify(f.balances)),
      )),
      f.signature(),
    )
  })

  it('does not mutate frozen saved materials or balances while collecting evidence', () => {
    const f = fixture()
    const before = JSON.stringify([f.material, f.balances])
    freeze(f.material); freeze(f.balances)
    f.signature()
    assert.equal(JSON.stringify([f.material, f.balances]), before)
  })
})
