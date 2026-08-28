import { describe, expect, it } from 'vitest'
import { diagnosePlanning } from '../../src/core/diagnosis.js'
import { emptyPlanningSnapshot, type PlanningSnapshot } from '../../src/planning/types.js'

function completeSnapshot(): PlanningSnapshot {
  const snapshot = emptyPlanningSnapshot(2026)
  snapshot.profile = {
    ...snapshot.profile,
    incomeCategory: 'miscellaneous',
    filingType: 'white',
    hasBookkeeping: true,
  }
  snapshot.taxUnits = [
    {
      id: 'app-v1',
      name: '自分用兼公開アプリ',
      unitType: 'new-software',
      usageMode: 'mixed',
      revenueModel: 'subscription',
      lifecycleStatus: 'developing',
      journeyMode: 'early',
      monetizationStatus: 'planned',
      completionCriteria: '実作業での確認後、外部提供版をリリースする',
      sameAsExternalVersion: 'yes',
    },
  ]
  snapshot.projectRules = [
    {
      id: 'rule-1',
      projectKey: 'project-key',
      effectiveFrom: '2026-07-01',
      taxUnitId: 'app-v1',
      classification: 'new-development',
    },
  ]
  snapshot.evidence = [
    {
      id: 'receipt-1',
      evidenceType: 'receipt',
      strength: 'external',
      recordedAt: '2026-07-10T00:00:00Z',
      note: 'PCの領収書',
    },
  ]
  snapshot.equipment = [
    {
      id: 'pc-1',
      name: '開発PC',
      equipmentType: 'pc',
      acquisitionCostJpy: 480_000,
      acquiredOn: '2026-01-10',
      businessUseStartedOn: '2026-01-10',
      convertedFromPrivate: false,
      businessUseRatio: 0.8,
      usefulLifeYears: 4,
      role: '開発とテスト',
      taxUnitId: 'app-v1',
      projectAllocationRatio: 0.75,
      evidenceIds: ['receipt-1'],
    },
  ]
  snapshot.homeCosts = [
    {
      id: 'rent-2026-07',
      month: '2026-07',
      category: 'rent',
      amountJpy: 100_000,
      method: 'area-time',
      businessUseRatio: 0.2,
      basis: '作業面積20%×専用利用時間',
      rationale: '共用室のため面積と時間を併用',
      taxUnitId: 'app-v1',
      projectAllocationRatio: 0.5,
      treatment: 'shared',
      evidenceIds: ['receipt-1'],
    },
  ]
  return snapshot
}

describe('diagnosePlanning', () => {
  it('early journey creates neutral future event reminders for mixed use', () => {
    const result = diagnosePlanning(completeSnapshot())

    expect(result.currentPosition).toContain(
      '制作物ごとに診断します。早期準備1件、過去整理0件です。',
    )
    expect(result.currentPosition).toContain(
      '自分用兼公開アプリは自己利用と外部提供の両方を目的としています。',
    )
    expect(result.eventTriggeredActions.map((action) => action.id)).toEqual(
      expect.arrayContaining(['internal-use:app-v1', 'external-release:app-v1']),
    )
    expect(result.missingFacts).not.toContain('AI履歴と税務単位を結ぶ期間付き分類ルール')
    expect(result.readiness).toEqual({ confirmed: 9, total: 9 })
  })

  it('retrospective journey asks to reconstruct facts and supports Git-free evidence', () => {
    const snapshot = completeSnapshot()
    snapshot.taxUnits[0]!.journeyMode = 'retrospective'
    snapshot.evidence = []

    const result = diagnosePlanning(snapshot)

    expect(result.currentPosition[0]).toContain('過去整理1件')
    expect(result.immediateActions.map((action) => action.id)).toContain(
      'reconstruct-history:app-v1',
    )
    const evidenceAction = result.immediateActions.find(
      (action) => action.id === 'register-evidence',
    )
    expect(evidenceAction?.title).toContain('Git以外')
    expect(evidenceAction?.reason).toContain('スクリーンショット')
  })

  it('requires period rules, completion facts, equipment, home costs and bookkeeping', () => {
    const snapshot = emptyPlanningSnapshot(2026)
    snapshot.taxUnits = [
      {
        id: 'internal-tool',
        name: '自己利用ツール',
        unitType: 'new-software',
        usageMode: 'internal',
        revenueModel: 'efficiency',
        lifecycleStatus: 'in-use',
      },
    ]

    const result = diagnosePlanning(snapshot)

    expect(result.immediateActions.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        'register-project-period-rules',
        'start-bookkeeping',
        'review-equipment',
        'review-home-costs',
        'register-evidence',
      ]),
    )
    expect(result.missingFacts).toEqual(
      expect.arrayContaining([
        'AI履歴と税務単位を結ぶ期間付き分類ルール',
        '自己利用ツールの自己利用開始日と証拠',
        '開発に使用する設備の有無',
        '自宅関連費の有無と按分根拠',
        '月次帳簿',
      ]),
    )
  })

  it('does not generate language that encourages artificial tax operations', () => {
    const result = diagnosePlanning(emptyPlanningSnapshot(2026))
    const text = JSON.stringify(result)

    for (const prohibited of ['公開を遅らせ', '10万円を超えるまで', '99,999円', '有利な日に変更']) {
      expect(text).not.toContain(prohibited)
    }
  })

  it('does not report full readiness when an active unit lacks its required use event', () => {
    const snapshot = completeSnapshot()
    snapshot.taxUnits[0].lifecycleStatus = 'in-use'

    const result = diagnosePlanning(snapshot)

    expect(result.readiness.confirmed).toBeLessThan(result.readiness.total)
    expect(result.missingFacts).toEqual(
      expect.arrayContaining([
        '自分用兼公開アプリの自己利用開始日と証拠',
        '自分用兼公開アプリの外部提供開始日と証拠',
      ]),
    )
  })
})
