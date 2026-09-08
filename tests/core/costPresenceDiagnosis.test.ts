import { expect, it } from 'vitest'
import { diagnosePlanning } from '../../src/core/diagnosis.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
it('limits absence declarations to their year, keeps deferrals and conflicts actionable, and accepts unfinished drafts', () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.costPresence = [
    {
      id: 'home',
      taxYear: 2026,
      category: 'home',
      status: 'not-applicable',
      reason: '確認した理由',
      recordedAt: '2026-01-01T00:00:00Z',
    },
  ]
  const actions = () => diagnosePlanning(planning).immediateActions
  expect(actions().some((row) => row.id === 'review-home-costs')).toBe(false)
  planning.profile.taxYear = 2027
  expect(actions().some((row) => row.id === 'review-home-costs')).toBe(true)
  planning.profile.taxYear = 2026
  planning.costPresence[0]!.status = 'deferred'
  expect(actions().find((row) => row.id === 'cost-presence-home')?.reason).toContain('確認した理由')
  planning.homeCosts = [
    {
      id: 'zero',
      month: '2026-01',
      category: 'rent',
      amountJpy: 0,
      method: 'area',
      businessUseRatio: 0,
      basis: '',
      rationale: '',
      projectAllocationRatio: 0,
      treatment: 'general',
      evidenceIds: [],
    },
  ]
  planning.costPresence[0]!.status = 'not-applicable'
  expect(actions().find((row) => row.id === 'cost-presence-home')?.priority).toBe('high')
  expect(diagnosePlanning(planning).missingFacts).toContain('2026-01 rentの按分根拠')
  planning.costPresence[0]!.reason = ''
  expect(diagnosePlanning(planning).missingFacts).toContain(
    '年度別の費用項目確認の理由・日時・重複',
  )
  expect(planning.homeCosts[0]!.amountJpy).toBe(0)
})
