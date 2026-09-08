import { expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { planningSnapshotSchema } from '../../src/planning/schema.js'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'

it('preserves home costs across multiple targets, unknowns, and legacy inputs', () => {
  const p = emptyPlanningSnapshot(2026)
  p.taxUnits = ['u', 'v'].map((id) => ({
    id,
    name: id,
    unitType: 'new-software',
    usageMode: 'internal',
    revenueModel: 'efficiency',
    lifecycleStatus: 'developing',
  }))
  p.homeCosts = [
    {
      id: 'h',
      month: '2026-07',
      category: 'rent',
      amountJpy: 4000,
      method: 'area',
      businessUseRatio: 0.5,
      basis: '面積',
      rationale: '使用実態',
      projectAllocationRatio: 0.9,
      taxUnitId: 'u',
      treatment: 'shared',
      evidenceIds: [],
      targets: [
        { taxUnitId: 'u', shareBps: 2500 },
        { taxUnitId: 'v', shareBps: 5000 },
      ],
    },
  ]
  const cost = p.homeCosts[0]!
  const result = projectWorkspaceCosts(p, [])
  expect(result.totals).toMatchObject({
    knownBasisJpy: 4000,
    privateJpy: 2000,
    taxUnitJpy: 1500,
    unallocatedJpy: 500,
  })
  expect(result.byTaxUnit.map((row) => [row.taxUnitId, row.amountJpy])).toEqual([
    ['u', 500],
    ['v', 1000],
  ])
  cost.targets!.reverse()
  expect(projectWorkspaceCosts(p, [])).toEqual(result)
  cost.targets!.find((row) => row.taxUnitId === 'v')!.shareBps = null
  expect(projectWorkspaceCosts(p, []).totals).toMatchObject({
    privateJpy: 2000,
    taxUnitJpy: 500,
    unallocatedJpy: 1500,
  })
  cost.amountJpy = null
  cost.unknownAmountReason = '未確認'
  expect(
    projectWorkspaceCosts(p, []).byTaxUnit.every((row) => row.unknownBasisIds.length === 1),
  ).toBe(true)
  cost.amountJpy = 4000
  delete cost.unknownAmountReason
  cost.basis = ''
  expect(projectWorkspaceCosts(p, []).totals).toMatchObject({
    privateJpy: 0,
    taxUnitJpy: 0,
    unallocatedJpy: 4000,
  })
  cost.basis = '面積'
  cost.targets = []
  expect(projectWorkspaceCosts(p, []).totals.unallocatedJpy).toBe(2000)
  delete cost.targets
  expect(projectWorkspaceCosts(p, []).totals.taxUnitJpy).toBe(1800)
  for (const targets of [
    [{ taxUnitId: 'missing', shareBps: 100 }],
    [
      { taxUnitId: 'u', shareBps: 6000 },
      { taxUnitId: 'v', shareBps: 5000 },
    ],
    [{ taxUnitId: 'u', shareBps: 1.1 }],
    [
      { taxUnitId: 'u', shareBps: 1 },
      { taxUnitId: 'u', shareBps: 2 },
    ],
  ]) {
    cost.targets = targets
    expect(planningSnapshotSchema.safeParse(p).success).toBe(false)
  }
})
