import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { proposeCommonTreatmentFacts, reusableTreatmentFacts } from '../../src/core/treatmentFactsReuse.js'
import { canonicalTreatmentValue } from '../../src/core/costTreatmentFacts.js'
import type { CostTreatmentFacts } from '../../src/core/costTreatmentFacts.js'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import type { AnnualCostProjection } from '../../src/accounting/costs.js'
function fixture() {
  const proof = { id: 'proof', evidenceType: 'memo', strength: 'self-recorded', recordedAt: '2026-01-01T00:00:00Z', note: '製作の共通事実' }
  const unit = { id: 'software', unitType: 'new-software', usageMode: 'internal' }
  const source: CostTreatmentFacts = { id: 'january', costYear: 2026, contributionId: 'jan', recordedAt: '2026-01-31T00:00:00Z',
    workPurpose: 'new-development', placedInService: 'before', assetKind: 'software', directlyAttributable: true,
    serviceProvidedInCurrentPeriod: true, paidByYearEnd: true, workInProgressAtPeriodEnd: true, liabilityFixedAtYearEnd: true,
    reason: '新規製作', evidenceIds: ['proof'], costBasis: canonicalTreatmentValue({ year: 2026, unit, evidence: [proof],
      contributions: [{ id: 'jan', basisId: 'jan-basis', target: { kind: 'tax-unit', taxUnitId: unit.id } }],
      bases: [{ id: 'jan-basis', period: { startedOn: '2026-01-01', endedOn: '2026-01-31' } }] }) }
  const target = { ...source, id: 'february', contributionId: 'feb', costBasis: '{"target":true}', reason: '', evidenceIds: [],
    workPurpose: 'unknown' as const, directlyAttributable: null, serviceProvidedInCurrentPeriod: null, paidByYearEnd: null,
    workInProgressAtPeriodEnd: null, liabilityFixedAtYearEnd: null }
  const planning = { taxUnits: [unit], evidence: [proof], costTreatmentFacts: [source], lifecycleEvents: [] } as unknown as PlanningSnapshot
  const costs = { year: 2026, contributions: [{ id: 'feb', basisId: 'feb-basis', target: { kind: 'tax-unit', taxUnitId: unit.id } }],
    bases: [{ id: 'feb-basis', period: { startedOn: '2026-02-01', endedOn: '2026-02-28' } }] } as AnnualCostProjection
  return { source, target, planning, costs }
}
describe('reuse scoped common facts without copying tax confirmation or monthly events', () => {
  it('offers the prior same-software record and preserves the destination identity and seal', () => {
    const f = fixture(), before = structuredClone(f)
    assert.equal(reusableTreatmentFacts(f.costs, f.planning, f.target).length, 1)
    const next = proposeCommonTreatmentFacts(f.costs, f.planning, f.target, f.source)
    assert.equal(next.workPurpose, 'new-development'); assert.equal(next.reason, '新規製作')
    assert.deepEqual(next.evidenceIds, ['proof']); assert.equal(next.contributionId, 'feb')
    assert.equal(next.costBasis, f.target.costBasis); assert.equal(next.id, 'february')
    for (const key of ['serviceProvidedInCurrentPeriod','paidByYearEnd','workInProgressAtPeriodEnd','liabilityFixedAtYearEnd'] as const)
      assert.equal(next[key], null)
    assert.equal(next.placedInService, 'unknown'); assert.deepEqual(f, before)
  })
  it('does not copy the donor comparison or a donor confirmation', () => {
    const f = fixture()
    f.source.methodComparison = { throughYear: 2035 } as CostTreatmentFacts['methodComparison']
    assert.equal(proposeCommonTreatmentFacts(f.costs, f.planning, f.target, f.source).methodComparison, undefined)
  })
  for (const kind of ['different-unit', 'changed-evidence', 'missing-evidence', 'future', 'changed-use', 'supply', 'abandoned'])
    it('rejects ' + kind + ' instead of approving copied facts', () => {
      const f = fixture()
      if (kind === 'different-unit' && f.costs.contributions[0]!.target.kind === 'tax-unit') f.costs.contributions[0]!.target.taxUnitId = 'other'
      if (kind === 'changed-evidence') f.planning.evidence[0]!.note += '訂正'
      if (kind === 'missing-evidence') f.planning.evidence = []
      if (kind === 'future') f.source.costYear = 2027
      if (kind === 'changed-use') f.planning.taxUnits[0]!.usageMode = 'external'
      if (kind === 'supply' || kind === 'abandoned') f.planning.lifecycleEvents.push({ id: 'changed', taxUnitId: 'software',
        eventType: kind === 'supply' ? 'internal-use-started' : 'abandoned', occurredOn: '2026-02-10', recordedAt: '2026-02-10T00:00:00Z', evidenceIds: [] })
      assert.throws(() => proposeCommonTreatmentFacts(f.costs, f.planning, f.target, f.source))
      assert.equal(reusableTreatmentFacts(f.costs, f.planning, f.target).length, 0)
    })
  it('derives supply state only from an explicit dated event, not current lifecycleStatus', () => {
    const f = fixture()
    f.planning.taxUnits[0]!.lifecycleStatus = 'in-use'
    assert.equal(proposeCommonTreatmentFacts(f.costs, f.planning, f.target, f.source).placedInService, 'unknown')
    f.planning.lifecycleEvents.push({ id: 'prior', taxUnitId: 'software', eventType: 'internal-use-started', occurredOn: '2025-12-01', recordedAt: '2025-12-01T00:00:00Z', evidenceIds: [] })
    assert.equal(proposeCommonTreatmentFacts(f.costs, f.planning, f.target, f.source).placedInService, 'after')
  })
  it('rejects unsaved donor modifications', () => {
    const f = fixture()
    assert.throws(() => proposeCommonTreatmentFacts(f.costs, f.planning, f.target, { ...f.source, reason: 'unsaved' }), /保存済み/)
  })
  it('ignores private-location relocation, while copying no local paths', () => {
    const f = fixture(); f.planning.evidence[0]!.localReference = '/private/relocated'
    assert.ok(!JSON.stringify(proposeCommonTreatmentFacts(f.costs, f.planning, f.target, f.source)).includes('/private/'))
  })
})
