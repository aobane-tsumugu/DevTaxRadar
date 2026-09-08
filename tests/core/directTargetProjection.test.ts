import { expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { planningSnapshotSchema } from '../../src/planning/schema.js'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'

it('conserves direct costs across targets and keeps unknowns and old balances distinct', () => {
  const p = emptyPlanningSnapshot(2026)
  p.taxUnits = ['u', 'v'].map((id) => ({
    id,
    name: id,
    unitType: 'new-software',
    usageMode: 'internal',
    revenueModel: 'efficiency',
    lifecycleStatus: 'developing',
  }))
  p.directCosts = [
    {
      id: 'd',
      incurredOn: '2026-07-01',
      costType: 'cloud',
      amountJpy: 3001,
      directlyAttributable: true,
      taxUnitId: 'u',
      treatment: 'direct',
      evidenceIds: [],
      targets: [
        { taxUnitId: 'u', shareBps: 2500 },
        { taxUnitId: 'v', shareBps: 5000 },
      ],
    },
  ]
  const cost = p.directCosts[0]!
  const result = projectWorkspaceCosts(p, [])
  expect(result.totals).toMatchObject({
    knownBasisJpy: 3001,
    taxUnitJpy: 2251,
    unallocatedJpy: 750,
  })
  expect(result.byTaxUnit.map((row) => [row.taxUnitId, row.amountJpy])).toEqual([
    ['u', 750],
    ['v', 1501],
  ])
  cost.targets!.reverse()
  expect(projectWorkspaceCosts(p, [])).toEqual(result)
  cost.targets!.find((row) => row.taxUnitId === 'v')!.shareBps = null
  expect(projectWorkspaceCosts(p, []).totals).toMatchObject({
    taxUnitJpy: 750,
    unallocatedJpy: 2251,
  })
  cost.amountJpy = null
  cost.unknownAmountReason = '請求を確認中'
  expect(
    projectWorkspaceCosts(p, []).byTaxUnit.every((row) => row.unknownBasisIds.length === 1),
  ).toBe(true)
  cost.amountJpy = 3001
  delete cost.unknownAmountReason
  cost.costType = 'old-version-balance'
  expect(projectWorkspaceCosts(p, []).totals.knownBasisJpy).toBe(0)
  cost.costType = 'cloud'
  cost.targets = []
  expect(projectWorkspaceCosts(p, []).totals.unallocatedJpy).toBe(3001)
  delete cost.targets
  expect(projectWorkspaceCosts(p, []).totals.taxUnitJpy).toBe(3001)
  for (const targets of [
    [{ taxUnitId: 'missing', shareBps: 1 }],
    [
      { taxUnitId: 'u', shareBps: 6000 },
      { taxUnitId: 'v', shareBps: 5000 },
    ],
    [{ taxUnitId: 'u', shareBps: 0.1 }],
    [
      { taxUnitId: 'u', shareBps: 1 },
      { taxUnitId: 'u', shareBps: 2 },
    ],
  ]) {
    cost.targets = targets
    expect(planningSnapshotSchema.safeParse(p).success).toBe(false)
  }
  cost.targets = []
  cost.treatment = 'general'
  expect(planningSnapshotSchema.safeParse(p).success).toBe(false)
})
