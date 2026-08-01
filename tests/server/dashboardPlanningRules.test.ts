import { describe, expect, it } from 'vitest'
import { emptyPlanningSnapshot, type PlanningSnapshot } from '../../src/planning/types.js'
import { resolveMonthlyProjectMapping } from '../../src/server/dashboard.js'
import type { ProjectMapping } from '../../src/server/database.js'

const row = {
  projectKey: 'project_1234567890abcdef12345678',
  provider: 'codex' as const,
  month: '2026-07',
}

const legacy: ProjectMapping = {
  projectKey: row.projectKey,
  productName: '旧設定の名前',
  assetName: '旧設定の資産',
  classification: 'maintenance',
}

function planningWithRules(
  rules: PlanningSnapshot['projectRules'],
): PlanningSnapshot {
  return {
    ...emptyPlanningSnapshot(2026),
    taxUnits: [{
      id: 'tax-unit-a',
      name: '公開アプリ A',
      unitType: 'new-software',
      usageMode: 'external',
      revenueModel: 'sales',
      lifecycleStatus: 'developing',
    }],
    projectRules: rules,
  }
}

describe('resolveMonthlyProjectMapping', () => {
  it('planning ruleが一つもないprojectだけ旧設定へフォールバックする', () => {
    expect(resolveMonthlyProjectMapping(emptyPlanningSnapshot(2026), row, legacy)).toEqual({
      ...legacy,
      source: 'legacy',
    })
  })

  it('月全体を覆う単一ルールは税務単位名で分類する', () => {
    const planning = planningWithRules([{
      id: 'rule-full-month',
      projectKey: row.projectKey,
      provider: 'codex',
      effectiveFrom: '2026-06-15',
      effectiveTo: '2026-07-31',
      taxUnitId: 'tax-unit-a',
      classification: 'new-development',
    }])

    expect(resolveMonthlyProjectMapping(planning, row, legacy)).toEqual({
      projectKey: row.projectKey,
      productName: '公開アプリ A',
      assetName: '公開アプリ A',
      classification: 'new-development',
      source: 'planning',
    })
  })

  it('月途中からのルールは旧設定へ戻さず要確認に残す', () => {
    const planning = planningWithRules([{
      id: 'rule-mid-month',
      projectKey: row.projectKey,
      effectiveFrom: '2026-07-18',
      taxUnitId: 'tax-unit-a',
      classification: 'new-development',
    }])

    expect(resolveMonthlyProjectMapping(planning, row, legacy)).toBeUndefined()
  })

  it('期間ルールの空白月は旧設定へ戻さず要確認に残す', () => {
    const planning = planningWithRules([{
      id: 'rule-ended-before-month',
      projectKey: row.projectKey,
      effectiveFrom: '2026-04-01',
      effectiveTo: '2026-06-30',
      taxUnitId: 'tax-unit-a',
      classification: 'new-development',
    }])

    expect(resolveMonthlyProjectMapping(planning, row, legacy)).toBeUndefined()
  })

  it('同じ月に複数ルールが触れる場合は誤分類しない', () => {
    const planning = planningWithRules([
      {
        id: 'rule-first-half',
        projectKey: row.projectKey,
        effectiveFrom: '2026-07-01',
        effectiveTo: '2026-07-15',
        taxUnitId: 'tax-unit-a',
        classification: 'new-development',
      },
      {
        id: 'rule-second-half',
        projectKey: row.projectKey,
        effectiveFrom: '2026-07-16',
        taxUnitId: 'tax-unit-a',
        classification: 'maintenance',
      },
    ])

    expect(resolveMonthlyProjectMapping(planning, row, legacy)).toBeUndefined()
  })

  it('providerが違うルールしかない場合も旧設定へ戻さない', () => {
    const planning = planningWithRules([{
      id: 'rule-claude-only',
      projectKey: row.projectKey,
      provider: 'claude',
      effectiveFrom: '2026-07-01',
      taxUnitId: 'tax-unit-a',
      classification: 'new-development',
    }])

    expect(resolveMonthlyProjectMapping(planning, row, legacy)).toBeUndefined()
  })
})
