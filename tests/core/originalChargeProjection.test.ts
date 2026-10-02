import { describe, expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { originalChargeFactSchema } from '../../src/planning/originalCharges.js'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'
import { costProjectionMarkdown } from '../../src/core/costExport.js'
import { planningMarkdown } from '../../src/core/planningExport.js'
import { costTreatmentBasis } from '../../src/core/costTreatments.js'
import { mergeWorkspaceDrafts } from '../../src/core/workspaceMerge.js'
import { workspaceChangeKind } from '../../src/core/workspaceChange.js'

function fixture() {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits.push({
    id: 'unit',
    name: 'Synthetic unit',
    unitType: 'new-software',
    usageMode: 'internal',
    revenueModel: 'efficiency',
    lifecycleStatus: 'developing',
  })
  planning.evidence.push({
    id: 'proof',
    evidenceType: 'receipt',
    strength: 'external',
    recordedAt: '2026-01-01T00:00:00Z',
    note: 'Synthetic receipt',
    localReference: '/synthetic/private/receipt',
  })
  planning.directCosts.push({
    id: 'charge',
    taxUnitId: 'unit',
    incurredOn: '2026-01-05',
    costType: 'cloud',
    amountJpy: 150,
    directlyAttributable: true,
    treatment: 'direct',
    evidenceIds: ['proof'],
  })
  const fact = originalChargeFactSchema.parse({
    id: 'fact',
    recordedAt: '2026-01-06T00:00:00Z',
    sourceId: 'direct:charge',
    category: 'direct',
    record: planning.directCosts[0],
    original: {
      currency: 'USD',
      amount: '1',
      amountJpy: 150,
      fx: {
        currency: 'USD',
        foreignAmount: '1',
        jpyPerUnit: '150',
        rounding: 'nearest-yen',
        convertedOn: '2026-01-05',
        reference: 'Synthetic rate',
      },
      conversionEvidenceIds: ['proof'],
    },
    dates: { incurredOn: '2026-01-05', billedOn: '2026-01-04', paidOn: '2026-01-06' },
    contract: { reference: 'Contract A' },
    evidenceIds: ['proof'],
    provenance: { kind: 'manual' },
  })
  planning.originalCharges = { version: 1, facts: [fact] }
  return { planning, fact }
}
describe('original-charge provenance follows the single cost source', () => {
  it('keeps one ledger, separates foreign amount and adopted yen, and exports frozen factual dates', () => {
    const { planning, fact } = fixture()
    const costs = projectWorkspaceCosts(planning, [])
    expect(costs.sources).toHaveLength(1)
    expect(costs.sources[0]?.id).toBe('direct:charge')
    expect(costs.sources[0]?.originalChargeFact).toEqual(fact)
    expect(costs.totals.knownBasisJpy).toBe(150)
    expect(costs.totals.taxUnitJpy).toBe(150)
    const markdown = costProjectionMarkdown(costs, 'recorded')
    expect(markdown).toContain('USD 1')
    expect(markdown).toContain('支払日: 2026-01-06')
    expect(markdown).not.toContain('/synthetic/private')
    expect(planningMarkdown(planning)).toContain('原始請求の取込・訂正履歴')
    planning.originalCharges!.facts[0]!.original.fx!.reference = 'Later live change'
    expect(costProjectionMarkdown(costs, 'recorded')).toBe(markdown)
  })
  it('same-amount date/evidence corrections invalidate linked working bases without another charge', () => {
    const { planning, fact } = fixture()
    const before = projectWorkspaceCosts(planning, [])
    const basis = costTreatmentBasis(before, planning, before.contributions[0]!.id)
    planning.originalCharges!.facts.push({
      ...fact,
      id: 'correction',
      correctsId: fact.id,
      correctionReason: 'Payment date evidence',
      recordedAt: '2026-01-07T00:00:00Z',
      dates: { ...fact.dates, paidOn: '2026-01-07' },
    })
    const after = projectWorkspaceCosts(planning, [])
    expect(after.sources).toHaveLength(1)
    expect(after.totals).toEqual(before.totals)
    expect(after.sources[0]?.originalChargeFact?.id).toBe('correction')
    expect(costTreatmentBasis(after, planning, after.contributions[0]!.id)).not.toBe(basis)
  })
  it('merges facts by stable identity and treats metadata changes as reviewable work', () => {
    const { planning, fact } = fixture()
    const configuration = {
      charges: { claude: null, codex: null },
      unknownChargeReasons: { claude: 'Unknown', codex: 'Unknown' },
      monthlyCharges: [],
      contracts: { claude: {}, codex: {} },
      chargePeriods: [],
      unobservedRatio: null,
    }
    const base = { planning, configuration }
    const local = structuredClone(base)
    local.planning.originalCharges!.facts.push({
      ...fact,
      id: 'correction',
      correctsId: fact.id,
      correctionReason: 'Payment date',
      recordedAt: '2026-01-07T00:00:00Z',
      dates: { ...fact.dates, paidOn: '2026-01-07' },
    })
    expect(workspaceChangeKind(base, local)).toBe('calculation')
    const result = mergeWorkspaceDrafts(base, local, base)
    expect(result.changes.some((row) => row.label.includes('原始請求'))).toBe(true)
  })
})
