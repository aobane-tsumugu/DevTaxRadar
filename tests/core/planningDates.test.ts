import { expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import {
  planningSaveSchema,
  planningSnapshotSchema,
  projectRulesSchema,
} from '../../src/planning/schema.js'
import { buildWorkspaceCostSnapshot, projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'

it('rejects impossible dates at every planning calendar field while keeping legacy records readable', () => {
  const planning = emptyPlanningSnapshot(2026)
  const bad = '2026-02-30'
  planning.profile.activityStartedOn = bad
  planning.taxUnits = [
    {
      id: 'u',
      name: '制作物',
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'efficiency',
      lifecycleStatus: 'developing',
    },
  ]
  planning.projectRules = [
    {
      id: 'r',
      projectKey: 'project-key',
      effectiveFrom: bad,
      effectiveTo: bad,
      classification: 'maintenance',
    },
  ]
  planning.lifecycleEvents = [
    {
      id: 'l',
      taxUnitId: 'u',
      eventType: 'development-started',
      occurredOn: bad,
      recordedAt: '2026-09-08T00:00:00Z',
      evidenceIds: [],
    },
  ]
  planning.equipment = [
    {
      id: 'e',
      name: 'PC',
      equipmentType: 'pc',
      acquisitionCostJpy: 100,
      orderedOn: bad,
      deliveredOn: bad,
      acquiredOn: bad,
      businessUseStartedOn: bad,
      convertedFromPrivate: false,
      businessUseRatio: 1,
      projectAllocationRatio: 1,
      role: '開発',
      evidenceIds: [],
    },
  ]
  planning.directCosts = [
    {
      id: 'd',
      incurredOn: bad,
      costType: 'domain',
      amountJpy: 100,
      directlyAttributable: false,
      treatment: 'general',
      evidenceIds: [],
    },
  ]
  planning.evidence = [
    {
      id: 'v',
      evidenceType: 'memo',
      strength: 'self-recorded',
      occurredOn: bad,
      recordedAt: '2026-09-08T00:00:00Z',
      note: '記録',
    },
  ]
  expect(planningSnapshotSchema.safeParse(planning).success).toBe(true)
  const result = planningSaveSchema.safeParse(planning)
  expect(result.success).toBe(false)
  if (!result.success)
    expect(result.error.issues.map((issue) => issue.path.join('.')).sort()).toEqual(
      [
        'profile.activityStartedOn',
        'projectRules.0.effectiveFrom',
        'projectRules.0.effectiveTo',
        'lifecycleEvents.0.occurredOn',
        'equipment.0.orderedOn',
        'equipment.0.deliveredOn',
        'equipment.0.acquiredOn',
        'equipment.0.businessUseStartedOn',
        'directCosts.0.incurredOn',
        'evidence.0.occurredOn',
      ].sort(),
    )
  expect(projectRulesSchema.safeParse({ rules: planning.projectRules }).success).toBe(false)
  const repaired = JSON.parse(JSON.stringify(planning).replaceAll(bad, '2024-02-29'))
  expect(planningSaveSchema.safeParse(repaired).success).toBe(true)
  expect(projectRulesSchema.safeParse({ rules: repaired.projectRules }).success).toBe(true)
})

it.each(['2026-02-30', '9999-99-99'])(
  'keeps direct cost with invalid date %s unknown and other costs calculable',
  (incurredOn) => {
    const planning = emptyPlanningSnapshot(2026)
    planning.directCosts = [
      {
        id: 'invalid',
        incurredOn,
        costType: 'domain',
        amountJpy: 1000,
        directlyAttributable: false,
        treatment: 'general',
        evidenceIds: [],
      },
      {
        id: 'valid',
        incurredOn: '2026-07-01',
        costType: 'domain',
        amountJpy: 2000,
        directlyAttributable: false,
        treatment: 'general',
        evidenceIds: [],
      },
    ]
    const before = structuredClone(planning)
    const snapshot = buildWorkspaceCostSnapshot(planning, [])
    expect(snapshot.sources.map((row) => row.originalAmountJpy)).toEqual([1000, 2000])
    expect(snapshot.bases[0]?.amount.status).toBe('unknown')
    expect(snapshot.bases[0]?.method.explanation).toContain('年度帰属は未確認')
    expect(snapshot.contributions.map((row) => row.amountJpy)).toEqual([2000])
    expect(() => projectWorkspaceCosts(planning, [])).not.toThrow()
    expect(planning).toEqual(before)
  },
)
