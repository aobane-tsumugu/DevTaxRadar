import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { fixture, addFacts } from './helpers/treatmentFixtures.js'
import { costTreatmentBasis, projectCostTreatments } from '../../src/core/costTreatments.js'
import { draftTreatmentDecision } from '../../src/core/costTreatmentDraft.js'

function graph() {
  const f = fixture()
  const fact = addFacts(f)
  const parent = f.costs.contributions[0]!
  parent.consumedByBasisId = 'final-basis'
  parent.evidenceIds.push('parent-proof')
  f.planning.evidence.push({ ...f.planning.evidence[0]!, id: 'parent-proof', note: '親の原価根拠' })
  f.costs.bases.push({
    ...f.costs.bases[0]!,
    id: 'final-basis',
    sourceId: undefined,
    parentContributionIds: ['part'],
  })
  f.costs.contributions.push({
    ...parent,
    id: 'final',
    basisId: 'final-basis',
    consumedByBasisId: undefined,
    evidenceIds: ['proof'],
  })
  fact.contributionId = 'final'
  const reseal = () => {
    fact.costBasis = costTreatmentBasis(f.costs, f.planning, 'final', fact.evidenceIds)
  }
  reseal()
  return { ...f, fact, reseal }
}

describe('complete evidence closure of a terminal cost', () => {
  it('retains the known final amount when parent evidence exists', () => {
    const f = graph()
    const report = projectCostTreatments(f.costs, f.planning)
    assert.equal(report.items.length, 1)
    assert.equal(report.items[0]!.futureCostJpy, 1000)
  })

  it('does not turn missing parent evidence into a numeric candidate by resealing', () => {
    const f = graph()
    f.planning.evidence = f.planning.evidence.filter((row) => row.id !== 'parent-proof')
    assert.equal(projectCostTreatments(f.costs, f.planning).items[0]!.status, 'stale')
    f.reseal()
    const before = structuredClone(f.costs)
    const result = projectCostTreatments(f.costs, f.planning)
    assert.equal(result.items[0]!.status, 'needs-facts')
    assert.equal(result.items[0]!.futureCostJpy, null)
    assert.equal(result.totals.unresolvedKnownJpy, 1000)
    assert.deepEqual(f.costs, before)
  })

  it('rejects a decision proposal while an ancestor proof is missing', () => {
    const f = graph()
    f.planning.evidence = f.planning.evidence.filter((row) => row.id !== 'parent-proof')
    f.reseal()
    assert.throws(() =>
      draftTreatmentDecision(f.costs, f.planning, 'final', 'proposal', '2026-09-19T00:00:00Z'),
    )
    assert.equal(f.planning.decisions.length, 0)
  })

  it('also checks evidence referenced by a relevant lifecycle event', () => {
    const f = graph()
    f.planning.lifecycleEvents.push({
      id: 'started',
      taxUnitId: 'unit',
      eventType: 'development-started',
      occurredOn: '2026-01-01',
      recordedAt: '2026-01-01T00:00:00Z',
      evidenceIds: ['event-proof'],
    })
    f.reseal()
    assert.equal(projectCostTreatments(f.costs, f.planning).items[0]!.futureCostJpy, null)
    f.planning.evidence.push({ ...f.planning.evidence[0]!, id: 'event-proof', note: '開始の根拠' })
    f.reseal()
    assert.equal(projectCostTreatments(f.costs, f.planning).items[0]!.futureCostJpy, 1000)
  })

  it('does not demand an unrelated or future-year proof', () => {
    const f = graph()
    f.planning.lifecycleEvents.push({
      id: 'future',
      taxUnitId: 'unit',
      eventType: 'abandoned',
      occurredOn: '2027-01-01',
      recordedAt: '2027-01-01T00:00:00Z',
      evidenceIds: ['future-proof'],
    })
    f.reseal()
    assert.equal(projectCostTreatments(f.costs, f.planning).items[0]!.futureCostJpy, 1000)
  })

  it('requires an explicit new basis after the missing proof is restored', () => {
    const f = graph()
    const proof = f.planning.evidence.find((row) => row.id === 'parent-proof')!
    f.planning.evidence = f.planning.evidence.filter((row) => row !== proof)
    f.reseal()
    f.planning.evidence.push(proof)
    assert.equal(projectCostTreatments(f.costs, f.planning).items[0]!.status, 'stale')
    f.reseal()
    assert.equal(projectCostTreatments(f.costs, f.planning).items[0]!.status, 'conditional')
  })
})
