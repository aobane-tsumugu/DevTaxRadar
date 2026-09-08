import { expect, it } from 'vitest'
import { projectAnnualCosts } from '../../src/core/costProjection.js'
import { traceCost } from '../../src/core/costTrace.js'
import type { CostSnapshot } from '../../src/accounting/costs.js'

function fixture() {
  const period = { startedOn: '2026-01-01', endedOn: '2026-12-31' }
  const method = { id: 'manual', version: '1', explanation: '合成の配分根拠' }
  const snapshot: CostSnapshot = {
    version: 1,
    taxUnits: [{ id: 'unit', name: '制作物' }],
    sources: [100, 300].map((amount, index) => ({
      id: `source${index}`,
      kind: 'direct',
      label: `支払${index}`,
      originalAmountJpy: amount,
      currency: 'JPY',
      evidenceIds: [`evidence${index}`],
      origin: 'entered',
    })),
    bases: [100, 300].map((amount, index) => ({
      id: `basis${index}`,
      sourceId: `source${index}`,
      parentContributionIds: [],
      affectedTaxUnitIds: ['unit'],
      period,
      amount: { status: 'known', amountJpy: amount },
      method,
      warnings: [],
    })),
    contributions: [50, 150].flatMap((amount, index) => [
      {
        id: `parent${index}`,
        basisId: `basis${index}`,
        target: { kind: 'tax-unit', taxUnitId: 'unit' },
        amountJpy: amount,
        reason: '制作物への対応',
        evidenceIds: [`evidence${index}`],
      },
      {
        id: `private${index}`,
        basisId: `basis${index}`,
        target: { kind: 'private' },
        amountJpy: amount,
        reason: '私用分',
        evidenceIds: [],
      },
    ]),
  }
  snapshot.bases.push({
    id: 'merged',
    parentContributionIds: ['parent0', 'parent1'],
    affectedTaxUnitIds: ['unit'],
    period,
    amount: { status: 'known', amountJpy: 200 },
    method,
    warnings: [],
  })
  snapshot.contributions.push({
    id: 'final',
    basisId: 'merged',
    target: { kind: 'tax-unit', taxUnitId: 'unit' },
    amountJpy: 200,
    reason: '組入れた費用',
    evidenceIds: [],
  })
  return projectAnnualCosts(snapshot, 2026)
}
it('traces both upstream payments in dependency order without adding unrelated private allocations', () => {
  const projection = fixture()
  const before = structuredClone(projection)
  const trace = traceCost(projection, { kind: 'contribution', id: 'final' })
  expect(trace.issues).toEqual([])
  expect(trace.nodes.map((node) => node.key)).toEqual([
    'source:source0',
    'basis:basis0',
    'contribution:parent0',
    'source:source1',
    'basis:basis1',
    'contribution:parent1',
    'basis:merged',
    'contribution:final',
  ])
  expect(trace.nodes.find((node) => node.key === 'basis:merged')!.inputs).toEqual([
    'contribution:parent0',
    'contribution:parent1',
  ])
  expect(projection).toEqual(before)
})
it('reports missing references and cycles rather than filling them or looping', () => {
  const projection = fixture()
  projection.sources = []
  projection.bases[0]!.sourceId = undefined
  projection.bases[0]!.parentContributionIds = ['final']
  const trace = traceCost(projection, { kind: 'contribution', id: 'final' })
  expect(trace.issues.some((issue) => issue.includes('循環'))).toBe(true)
  expect(trace.issues.some((issue) => issue.includes('source:source1'))).toBe(true)
  expect(new Set(trace.nodes.map((node) => node.key)).size).toBe(trace.nodes.length)
  expect(traceCost(projection, { kind: 'basis', id: 'missing' }).nodes).toEqual([])
})
