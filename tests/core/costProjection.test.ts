import { describe, expect, it } from 'vitest'
import type { CostBasis, CostSnapshot, CostTarget } from '../../src/accounting/costs.js'
import { projectAnnualCosts } from '../../src/core/costProjection.js'
import { allocateMonthlySubscription } from '../../src/core/allocation.js'
import { buildWorkspaceCostSnapshot, projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { costProjectionMarkdown } from '../../src/core/costExport.js'

function snapshot(): CostSnapshot {
  return {
    version: 1,
    taxUnits: [
      { id: 'a', name: '制作物A' },
      { id: 'b', name: '制作物B' },
    ],
    sources: [],
    bases: [],
    contributions: [],
  }
}
function basis(
  data: CostSnapshot,
  id: string,
  amount: number,
  allocations: Array<[CostTarget, number]>,
  year = 2026,
) {
  data.sources.push({
    id,
    kind: 'direct',
    label: id,
    originalAmountJpy: amount,
    currency: 'JPY',
    evidenceIds: [],
    origin: 'entered',
  })
  data.bases.push({
    id: `${id}:basis`,
    sourceId: id,
    parentContributionIds: [],
    affectedTaxUnitIds: [],
    period: { startedOn: `${year}-01-01`, endedOn: `${year}-12-31` },
    amount: { status: 'known', amountJpy: amount },
    method: {
      id: 'fixture',
      version: '1',
      explanation: '保存則の合成例。税務ルールの適用例ではない。',
    },
    warnings: [],
  })
  for (const [index, [target, amountJpy]] of allocations.entries())
    data.contributions.push({
      id: `${id}:${index}`,
      basisId: `${id}:basis`,
      target,
      amountJpy,
      reason: '合成の確認済み配分額',
      evidenceIds: [],
    })
}
const a: CostTarget = { kind: 'tax-unit', taxUnitId: 'a' }
const b: CostTarget = { kind: 'tax-unit', taxUnitId: 'b' }

describe('common cost projection', () => {
  it('preserves an unknown original and its reason without suppressing independent known costs or confirmed zero', () => {
    const data = snapshot()
    basis(data, 'unconfirmed', 0, [])
    data.sources[0].originalAmountJpy = null
    data.sources[0].unknownOriginalAmountReasons = ['請求書の再発行を待っている']
    data.bases[0].amount = { status: 'unknown', amountJpy: null, reasons: ['原額の確認待ち'] }
    data.bases[0].affectedTaxUnitIds = ['a']
    basis(data, 'confirmed-zero', 0, [])
    basis(data, 'confirmed-charge', 3000, [[b, 3000]])
    const result = projectAnnualCosts(data, 2026)
    expect(result.totals.knownBasisJpy).toBe(3000)
    expect(result.totals.unknownBasisIds).toEqual(['unconfirmed:basis'])
    expect(result.sources.find((source) => source.id === 'unconfirmed')).toMatchObject({
      originalAmountJpy: null,
      unknownOriginalAmountReasons: ['請求書の再発行を待っている'],
    })
    expect(result.sources.find((source) => source.id === 'confirmed-zero')?.originalAmountJpy).toBe(
      0,
    )
    const markdown = costProjectionMarkdown(result)
    expect(markdown).toContain('unconfirmed / 原額 不明')
    expect(markdown).toContain('原額が不明な理由: 請求書の再発行を待っている')
    expect(markdown).toContain('confirmed-zero / 原額 0円')
    expect(markdown).toContain('confirmed-charge / 原額 3,000円')

    data.bases[0].amount = { status: 'known', amountJpy: 0 }
    expect(() => projectAnnualCosts(data, 2026)).toThrow('原額が不明')
  })
  it('rejects missing or empty unknown-original reasons and reasons attached to a known original', () => {
    const data = snapshot()
    basis(data, 'missing', 0, [])
    data.sources[0].originalAmountJpy = null
    expect(() => projectAnnualCosts(data, 2026)).toThrow('その理由')
    data.sources[0].unknownOriginalAmountReasons = ['   ']
    expect(() => projectAnnualCosts(data, 2026)).toThrow()
    data.sources[0].unknownOriginalAmountReasons = ['未確認']
    data.sources[0].originalAmountJpy = 0
    expect(() => projectAnnualCosts(data, 2026)).toThrow('その理由')
  })
  it('reconciles the four cost sources in AC-ALLOC without calling acquisition costs annual expenses', () => {
    const data = snapshot()
    basis(data, 'ai', 8000, [
      [a, 3600],
      [b, 1800],
      [{ kind: 'private' }, 1800],
      [{ kind: 'unobserved' }, 800],
    ])
    basis(data, 'equipment-basis', 12000, [
      [a, 6000],
      [{ kind: 'private' }, 3000],
      [{ kind: 'unallocated' }, 3000],
    ])
    data.sources[1].kind = 'equipment'
    data.sources[1].originalAmountJpy = 240000
    basis(data, 'home', 10000, [
      [a, 3000],
      [{ kind: 'private' }, 5000],
      [{ kind: 'unallocated' }, 2000],
    ])
    basis(data, 'direct', 3000, [[a, 3000]])
    const result = projectAnnualCosts(data, 2026)
    expect(result.totals).toEqual({
      knownBasisJpy: 33000,
      taxUnitJpy: 17400,
      generalJpy: 0,
      privateJpy: 9800,
      unallocatedJpy: 5000,
      unobservedJpy: 800,
      roundingJpy: 0,
      unknownBasisIds: [],
    })
    expect(result.byTaxUnit.map((unit) => unit.amountJpy)).toEqual([15600, 1800])
    expect(result.sources.find((source) => source.kind === 'equipment')?.originalAmountJpy).toBe(
      240000,
    )
    expect(JSON.stringify(data)).not.toContain('engineVersion')
  })
  it('keeps unknown bases out of known subtotals and identifies affected products', () => {
    const data = snapshot()
    basis(data, 'unknown', 240000, [])
    data.bases[0].amount = { status: 'unknown', amountJpy: null, reasons: ['開始日が不明'] }
    data.bases[0].affectedTaxUnitIds = ['a']
    basis(data, 'known', 3000, [[b, 3000]])
    const result = projectAnnualCosts(data, 2026)
    expect(result.totals.knownBasisJpy).toBe(3000)
    expect(result.totals.unknownBasisIds).toEqual(['unknown:basis'])
    expect(result.byTaxUnit[0].unknownBasisIds).toEqual(['unknown:basis'])
    expect(result.sources.find((source) => source.id === 'unknown')?.originalAmountJpy).toBe(240000)
  })
  it('follows a consumed contribution through another basis without double counting', () => {
    const data = snapshot()
    basis(data, 'equipment', 12000, [
      [a, 6000],
      [{ kind: 'private' }, 6000],
    ])
    const derived: CostBasis = {
      ...data.bases[0],
      id: 'derived',
      sourceId: undefined,
      parentContributionIds: ['equipment:0'],
      amount: { status: 'known', amountJpy: 6000 },
    }
    data.bases.push(derived)
    data.contributions.push({
      id: 'derived:0',
      basisId: 'derived',
      target: b,
      amountJpy: 6000,
      reason: '設備の当年基礎から制作物へ組入れ',
      evidenceIds: [],
    })
    const result = projectAnnualCosts(data, 2026)
    expect(result.totals.knownBasisJpy).toBe(12000)
    expect(result.totals.taxUnitJpy).toBe(6000)
    expect(result.byTaxUnit.map((unit) => unit.amountJpy)).toEqual([0, 6000])
    expect(result.contributions.find((item) => item.id === 'derived:0')?.sourceIds).toEqual([
      'equipment',
    ])
    expect(result.contributions.find((item) => item.id === 'equipment:0')?.consumedByBasisId).toBe(
      'derived',
    )
    data.bases.push({ ...derived, id: 'duplicate' })
    expect(() => projectAnnualCosts(data, 2026)).toThrow('二重')
  })
  it('rejects cycles, including cycles outside the selected year', () => {
    const data = snapshot()
    basis(data, 'one', 100, [[a, 100]], 2025)
    basis(data, 'two', 100, [[b, 100]], 2025)
    data.bases[0].sourceId = undefined
    data.bases[0].parentContributionIds = ['two:0']
    data.bases[1].sourceId = undefined
    data.bases[1].parentContributionIds = ['one:0']
    expect(() => projectAnnualCosts(data, 2026)).toThrow('循環')
  })
  it('keeps years separate and rejects overlapping source periods and duplicated roots', () => {
    const data = snapshot()
    basis(data, 'one', 100, [[a, 100]], 2025)
    basis(data, 'two', 200, [[a, 200]])
    expect(projectAnnualCosts(data, 2026).totals.knownBasisJpy).toBe(200)
    data.bases[1].sourceId = 'one'
    expect(() => projectAnnualCosts(data, 2026)).toThrow('原額')
    data.sources[0].originalAmountJpy = 1000
    data.bases[1].period = { ...data.bases[0].period }
    expect(() => projectAnnualCosts(data, 2026)).toThrow('期間が重複')
  })
  it('rejects invented amounts on unknown bases, missing references, overflow and secret fields', () => {
    const data = snapshot()
    basis(data, 'one', 100, [[a, 100]])
    data.contributions[0].amountJpy = 101
    expect(() => projectAnnualCosts(data, 2026)).toThrow('一致')
    data.contributions[0].amountJpy = 100
    data.bases[0].amount = { status: 'unknown', amountJpy: null, reasons: ['未確認'] }
    expect(() => projectAnnualCosts(data, 2026)).toThrow('未算定')
    data.bases[0].amount = { status: 'known', amountJpy: 100 }
    data.contributions[0].target = { kind: 'tax-unit', taxUnitId: 'missing' }
    expect(() => projectAnnualCosts(data, 2026)).toThrow('制作物')
    data.contributions[0].target = a
    expect(() =>
      projectAnnualCosts({ ...data, rawPrompt: 'not allowed' } as CostSnapshot, 2026),
    ).toThrow()
    data.sources[0].originalAmountJpy = Number.MAX_SAFE_INTEGER + 1
    expect(() => projectAnnualCosts(data, 2026)).toThrow()
  })
})

describe('legacy inputs to common costs', () => {
  it('combines AI, home, direct and unresolved equipment while keeping general and unknown distinct', () => {
    const planning = emptyPlanningSnapshot(2026)
    planning.taxUnits = [
      {
        id: 'a',
        name: 'A',
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
        convertedFromPrivate: false,
        businessUseRatio: 1,
        role: '開発',
        taxUnitId: 'a',
        projectAllocationRatio: 1,
        evidenceIds: [],
      },
    ]
    planning.homeCosts = [
      {
        id: 'rent',
        month: '2026-07',
        category: 'rent',
        amountJpy: 10000,
        method: 'area-time',
        businessUseRatio: 0.5,
        basis: '面積50%',
        rationale: '作業場所',
        treatment: 'general',
        projectAllocationRatio: 0,
        evidenceIds: [],
      },
    ]
    planning.directCosts = [
      {
        id: 'domain',
        incurredOn: '2026-07-01',
        costType: 'domain',
        amountJpy: 3000,
        taxUnitId: 'a',
        directlyAttributable: true,
        treatment: 'direct',
        evidenceIds: [],
      },
    ]
    const result = allocateMonthlySubscription({
      provider: 'claude',
      billingMonth: '2026-07',
      monthlyFeeJpy: 8000,
      usageLines: [{ id: 'a', bucket: 'product', usageWeight: 1 }],
      unobservedUsage: { kind: 'unknown' },
    })
    const subscriptions = [
      {
        source: {
          id: 'ai',
          kind: 'subscription' as const,
          label: '合成契約',
          originalAmountJpy: 8000,
          currency: 'JPY' as const,
          evidenceIds: ['invoice-evidence'],
          origin: 'entered' as const,
        },
        basisId: 'ai:basis',
        period: { startedOn: '2026-07-01', endedOn: '2026-07-31' },
        result,
        targets: { a },
      },
    ]
    const data = buildWorkspaceCostSnapshot(planning, subscriptions)
    expect(
      data.contributions.filter((row) => row.basisId === 'ai:basis').map((row) => row.evidenceIds),
    ).toEqual([['invoice-evidence']])
    const projected = projectAnnualCosts(data, 2026)
    expect(projected.sources).toHaveLength(4)
    expect(projected.totals).toMatchObject({
      knownBasisJpy: 21000,
      taxUnitJpy: 3000,
      generalJpy: 5000,
      privateJpy: 5000,
      unallocatedJpy: 8000,
      unobservedJpy: 0,
    })
    expect(projected.totals.unknownBasisIds).toHaveLength(1)
    expect(projected.byTaxUnit[0].unknownBasisIds).toHaveLength(1)
    expect(projected.bases.find((item) => item.sourceId === 'equipment:pc')?.amount.status).toBe(
      'unknown',
    )
    planning.homeCosts[0].basis = ''
    expect(projectWorkspaceCosts(planning, subscriptions).totals).toMatchObject({
      privateJpy: 0,
      generalJpy: 0,
      unallocatedJpy: 18000,
    })
    planning.directCosts[0].costType = 'old-version-balance'
    expect(projectWorkspaceCosts(planning, subscriptions).totals.knownBasisJpy).toBe(18000)
  })
})

it('retains the home-cost calculation order, rounding and unallocated remainder in explanations and exports', () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits = [
    {
      id: 'unit',
      name: '制作物',
      unitType: 'new-software',
      usageMode: 'external',
      revenueModel: 'sales',
      lifecycleStatus: 'developing',
    },
  ]
  planning.homeCosts = [
    {
      id: 'home',
      month: '2026-01',
      category: 'rent',
      amountJpy: 101,
      method: 'area',
      businessUseRatio: 0.5,
      projectAllocationRatio: 0.5,
      taxUnitId: 'unit',
      treatment: 'shared',
      evidenceIds: [],
      basis: '面積の記録',
      rationale: '用途の記録',
    },
  ]
  const projection = projectWorkspaceCosts(planning, [])
  expect(projection.totals).toMatchObject({
    knownBasisJpy: 101,
    privateJpy: 50,
    taxUnitJpy: 26,
    unallocatedJpy: 25,
  })
  const target = projection.contributions.find((row) => row.target.kind === 'tax-unit')!
  expect(target.reason).toContain('支払額 101円 × 業務割合 0.5 を円単位で四捨五入して、業務額 51円')
  expect(target.reason).toContain(
    '業務額 51円 × 制作物への対応割合 0.5 を円単位で四捨五入して、対応額 26円',
  )
  expect(
    projection.contributions.find((row) => row.target.kind === 'unallocated')!.reason,
  ).toContain('51円 − 制作物への対応額 26円 = 未配分 25円')
  expect(costProjectionMarkdown(projection)).toContain(target.reason)
  const saved = structuredClone(projection)
  planning.homeCosts[0].businessUseRatio = 0.8
  expect(
    projectWorkspaceCosts(planning, []).contributions.find((row) => row.target.kind === 'tax-unit')!
      .reason,
  ).toContain('業務額 81円')
  expect(projection).toEqual(saved)
  planning.homeCosts[0].taxUnitId = undefined
  expect(
    projectWorkspaceCosts(planning, []).contributions.find(
      (row) => row.target.kind === 'unallocated',
    )!.reason,
  ).toContain('入力された制作物割合は適用していません')
  planning.homeCosts[0].treatment = 'general'
  expect(
    projectWorkspaceCosts(planning, []).contributions.find((row) => row.target.kind === 'general')!
      .reason,
  ).toContain('業務額 81円を一般業務へ対応')
  planning.homeCosts[0].amountJpy = null
  planning.homeCosts[0].unknownAmountReason = '請求書待ち'
  const unknown = projectWorkspaceCosts(planning, [])
  expect(unknown.contributions).toEqual([])
  expect(unknown.bases[0].method.explanation).not.toContain('支払額 null円')
  expect(unknown.bases[0].amount.status).toBe('unknown')
})
