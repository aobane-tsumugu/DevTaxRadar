import { expect, it } from 'vitest'
import { buildWorkspaceCostSnapshot, projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { planningSnapshotSchema, planningSaveSchema } from '../../src/planning/schema.js'
import { mergeWorkspaceDrafts } from '../../src/core/workspaceMerge.js'

export function methodPlanning() {
  const planning = emptyPlanningSnapshot(2026)
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
  planning.equipment = [
    {
      id: 'pc',
      name: 'PC',
      equipmentType: 'pc',
      acquisitionCostJpy: 240000,
      acquiredOn: '2026-01-01',
      businessUseStartedOn: '2026-07-31',
      convertedFromPrivate: false,
      usefulLifeYears: 99,
      businessUseRatio: 0.5,
      projectAllocationRatio: 0.6,
      taxUnitId: 'u',
      evidenceIds: [],
      role: '制作',
    },
  ]
  planning.equipmentMethods = [
    {
      id: 'method',
      equipmentId: 'pc',
      taxYear: 2026,
      taxpayer: 'individual',
      assetKind: 'tangible-equipment',
      method: 'straight-line',
      methodReason: '設備区分と方法の確認メモ',
      usefulLifeYears: 4,
      useThroughYearEnd: 'confirmed',
      ordinaryTreatment: 'confirmed',
      priorClosing: null,
      recordedAt: '2026-09-08T00:00:00Z',
    },
  ]
  return planning
}
it('projects annual multiple targets and keeps affected units even when facts are missing', () => {
  const planning = methodPlanning()
  planning.taxUnits.push({ ...planning.taxUnits[0]!, id: 'v', name: '別制作物' })
  planning.equipmentMethods![0]!.allocation = {
    businessUseRatio: 0.8,
    projectAllocationRatio: null,
    taxUnitId: null,
    reason: '年度の用途記録',
    targets: [
      { taxUnitId: 'u', shareBps: 2500 },
      { taxUnitId: 'v', shareBps: 5000 },
    ],
  }
  expect(planningSaveSchema.safeParse(planning).success).toBe(true)
  const snapshot = buildWorkspaceCostSnapshot(planning, [])
  expect(snapshot.contributions.map((row) => [row.target, row.amountJpy])).toEqual([
    [{ kind: 'private' }, 6000],
    [{ kind: 'unallocated' }, 6000],
    [{ kind: 'tax-unit', taxUnitId: 'u' }, 6000],
    [{ kind: 'tax-unit', taxUnitId: 'v' }, 12000],
  ])
  expect(snapshot.bases[0]!.affectedTaxUnitIds).toEqual(['u', 'v'])
  planning.equipmentMethods![0]!.allocation!.targets![1]!.shareBps = null
  expect(
    buildWorkspaceCostSnapshot(planning, []).contributions.find(
      (row) => row.target.kind === 'unallocated',
    )!.amountJpy,
  ).toBe(18000)
  planning.equipmentMethods![0]!.allocation!.businessUseRatio = null
  const unknown = buildWorkspaceCostSnapshot(planning, [])
  expect(unknown.bases[0]!.affectedTaxUnitIds).toEqual(['u', 'v'])
  expect(unknown.contributions.map((row) => [row.target.kind, row.amountJpy])).toEqual([
    ['unallocated', 30000],
  ])
  planning.equipment[0]!.acquiredOn = '2026-02-30'
  expect(buildWorkspaceCostSnapshot(planning, []).bases[0]!.affectedTaxUnitIds).toEqual(['u', 'v'])
  planning.equipmentMethods![0]!.allocation!.targets![1]!.taxUnitId = 'missing'
  expect(planningSnapshotSchema.safeParse(planning).success).toBe(false)
})
it('projects only annual depreciation and conserves private, product and unallocated contributions', () => {
  const planning = methodPlanning(),
    before = structuredClone(planning)
  const snapshot = buildWorkspaceCostSnapshot(planning, [])
  expect(snapshot.sources[0]?.originalAmountJpy).toBe(240000)
  expect(snapshot.bases[0]?.amount).toEqual({ status: 'known', amountJpy: 30000 })
  expect(snapshot.contributions.map((row) => [row.target.kind, row.amountJpy])).toEqual([
    ['private', 15000],
    ['tax-unit', 9000],
    ['unallocated', 6000],
  ])
  expect(snapshot.contributions.reduce((sum, row) => sum + row.amountJpy, 0)).toBe(30000)
  expect(snapshot.bases[0]?.method.explanation).toContain('償却後残高 210000円')
  expect(snapshot.bases[0]?.warnings.join(' ')).toContain('適用条件と根拠の内容は未検証')
  expect(() => projectWorkspaceCosts(planning, [])).not.toThrow()
  expect(planning).toEqual(before)
  planning.profile.taxYear = 2027
  expect(buildWorkspaceCostSnapshot(planning, []).bases[0]?.amount.status).toBe('unknown')
})
it('keeps missing, unsupported and inconsistent conditions unknown without fabricating an annual cost', () => {
  const planning = methodPlanning()
  planning.equipmentMethods![0]!.useThroughYearEnd = 'unknown'
  expect(buildWorkspaceCostSnapshot(planning, []).bases[0]?.amount.status).toBe('unknown')
  planning.equipmentMethods![0]!.useThroughYearEnd = 'confirmed'
  planning.equipmentMethods![0]!.method = 'other'
  expect(buildWorkspaceCostSnapshot(planning, []).bases[0]?.amount.status).toBe('unknown')
  planning.equipmentMethods![0]!.method = 'straight-line'
  planning.equipment[0]!.businessUseStartedOn = '2025-01-01'
  const snapshot = buildWorkspaceCostSnapshot(planning, [])
  expect(snapshot.bases[0]?.amount).toMatchObject({
    status: 'unknown',
    reasons: ['業務利用開始が取得日より前です。'],
  })
  expect(snapshot.contributions).toEqual([])
})
it.each([
  ['acquiredOn', '2026-02-30', '取得日'],
  ['acquiredOn', '9999-99-99', '取得日'],
  ['businessUseStartedOn', '2026-02-29', '業務利用開始日'],
] as const)(
  'retains invalid legacy %s=%s as unknown without stopping other costs',
  (field, value, label) => {
    const planning = methodPlanning()
    planning.equipment[0]![field] = value
    planning.equipment.push({
      ...planning.equipment[0]!,
      id: 'valid',
      acquiredOn: '2026-01-01',
      businessUseStartedOn: '2026-07-31',
    })
    planning.equipmentMethods!.push({
      ...planning.equipmentMethods![0]!,
      id: 'valid-method',
      equipmentId: 'valid',
    })
    const before = structuredClone(planning)
    expect(planningSnapshotSchema.safeParse(planning).success).toBe(true)
    expect(planningSaveSchema.safeParse(planning).success).toBe(false)
    const snapshot = buildWorkspaceCostSnapshot(planning, [])
    expect(snapshot.sources).toHaveLength(2)
    expect(snapshot.sources[0]?.originalAmountJpy).toBe(240000)
    expect(snapshot.bases[0]?.amount).toEqual({
      status: 'unknown',
      amountJpy: null,
      reasons: [`${label}が実在する年月日ではありません。`],
    })
    expect(snapshot.bases[1]?.amount).toEqual({ status: 'known', amountJpy: 30000 })
    expect(snapshot.contributions.reduce((sum, row) => sum + row.amountJpy, 0)).toBe(30000)
    expect(() => projectWorkspaceCosts(planning, [])).not.toThrow()
    expect(planning).toEqual(before)
  },
)
it('validates equipment references and resolves competing annual methods as whole records', () => {
  const planning = methodPlanning()
  const invalid = structuredClone(planning)
  invalid.equipment = []
  expect(planningSnapshotSchema.safeParse(invalid).success).toBe(false)
  invalid.equipment = planning.equipment
  invalid.equipmentMethods!.push({ ...invalid.equipmentMethods![0]!, id: 'second' })
  expect(planningSnapshotSchema.safeParse(invalid).success).toBe(false)
  const configuration = {
    charges: { claude: 0, codex: 0 },
    contracts: { claude: {}, codex: {} },
    monthlyCharges: [],
    chargePeriods: [],
    unobservedRatio: null,
  }
  const base = { configuration, planning: { ...planning, equipmentMethods: [] } }
  const local = { configuration, planning }
  const latest = structuredClone(local)
  latest.planning.equipmentMethods![0]!.id = 'different-id'
  latest.planning.equipmentMethods![0]!.usefulLifeYears = 5
  expect(mergeWorkspaceDrafts(base, local, latest).contents).toBeNull()
  const resolved = mergeWorkspaceDrafts(base, local, latest, {
    [JSON.stringify(['equipmentMethods', '2026:pc'])]: 'latest',
  })
  expect(resolved.contents?.planning.equipmentMethods).toEqual(latest.planning.equipmentMethods)
})

it('uses annual allocation independently of shared ratios and preserves unknown versus zero', () => {
  const planning = methodPlanning()
  const method = planning.equipmentMethods![0]!
  method.allocation = {
    businessUseRatio: 0.8,
    projectAllocationRatio: 0.25,
    reason: '2026年の利用記録',
  }
  const amounts = () =>
    buildWorkspaceCostSnapshot(planning, []).contributions.map((row) => [
      row.target.kind,
      row.amountJpy,
    ])
  expect(amounts()).toEqual([
    ['private', 6000],
    ['tax-unit', 6000],
    ['unallocated', 18000],
  ])
  planning.equipment[0]!.businessUseRatio = 0.1
  planning.equipment[0]!.projectAllocationRatio = 0.1
  expect(amounts()).toEqual([
    ['private', 6000],
    ['tax-unit', 6000],
    ['unallocated', 18000],
  ])
  method.allocation.projectAllocationRatio = null
  expect(amounts()).toEqual([
    ['private', 6000],
    ['unallocated', 24000],
  ])
  method.allocation.businessUseRatio = null
  expect(amounts()).toEqual([['unallocated', 30000]])
  method.allocation.businessUseRatio = 0
  expect(amounts()).toEqual([['private', 30000]])
  method.allocation.reason = ''
  expect(amounts()).toEqual([['unallocated', 30000]])
  method.allocation = {
    businessUseRatio: 0.8,
    projectAllocationRatio: 0.25,
    reason: '2026年の利用記録',
  }
  planning.equipmentMethods!.push({
    ...structuredClone(method),
    id: 'next-year',
    taxYear: 2027,
    priorClosing: { taxYear: 2026, amountJpy: 210000, reference: '前年確認資料' },
    allocation: { businessUseRatio: 0.5, projectAllocationRatio: 1, reason: '2027年の利用記録' },
  })
  expect(amounts()).toEqual([
    ['private', 6000],
    ['tax-unit', 6000],
    ['unallocated', 18000],
  ])
  planning.profile.taxYear = 2027
  expect(amounts()).toEqual([
    ['private', 30000],
    ['tax-unit', 30000],
  ])
  expect(planningSnapshotSchema.safeParse(planning).success).toBe(true)
  method.allocation.businessUseRatio = 1.01
  expect(planningSnapshotSchema.safeParse(planning).success).toBe(false)
})

it('keeps annual equipment destinations separate and does not fall back when explicitly unassigned', () => {
  const planning = methodPlanning()
  planning.taxUnits.push({ ...planning.taxUnits[0]!, id: 'next', name: '翌年の制作物' })
  const row = planning.equipmentMethods![0]!
  row.allocation = {
    taxUnitId: 'u',
    businessUseRatio: 1,
    projectAllocationRatio: 1,
    reason: '当年の対応',
  }
  planning.equipmentMethods!.push({
    ...structuredClone(row),
    id: 'next-method',
    taxYear: 2027,
    priorClosing: { taxYear: 2026, amountJpy: 210000, reference: '前年資料' },
    allocation: { ...row.allocation, taxUnitId: 'next' },
  })
  planning.equipment[0]!.taxUnitId = 'next'
  const current = buildWorkspaceCostSnapshot(planning, [])
  expect(current.contributions[0]?.target).toEqual({ kind: 'tax-unit', taxUnitId: 'u' })
  expect(current.bases[0]?.affectedTaxUnitIds).toEqual(['u'])
  planning.profile.taxYear = 2027
  expect(buildWorkspaceCostSnapshot(planning, []).contributions[0]?.target).toEqual({
    kind: 'tax-unit',
    taxUnitId: 'next',
  })
  planning.profile.taxYear = 2026
  row.allocation.taxUnitId = null
  expect(buildWorkspaceCostSnapshot(planning, []).contributions).toMatchObject([
    { target: { kind: 'unallocated' }, amountJpy: 30000 },
  ])
  expect(buildWorkspaceCostSnapshot(planning, []).bases[0]?.affectedTaxUnitIds).toEqual([])
  row.allocation.taxUnitId = 'missing'
  expect(planningSnapshotSchema.safeParse(planning).success).toBe(false)
})
