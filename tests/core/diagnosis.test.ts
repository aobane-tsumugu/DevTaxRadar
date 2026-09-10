import { describe, expect, it } from 'vitest'
import { diagnosePlanning } from '../../src/core/diagnosis.js'
import { emptyPlanningSnapshot, type PlanningSnapshot } from '../../src/planning/types.js'

function sample(): PlanningSnapshot {
  return {
    ...emptyPlanningSnapshot(2026),
    profile: { ...emptyPlanningSnapshot(2026).profile, hasBookkeeping: true },
    taxUnits: [{ id: 'app', name: '制作アプリ', unitType: 'new-software', usageMode: 'mixed',
      revenueModel: 'subscription', lifecycleStatus: 'developing', completionCriteria: '正式業務への採用', sameAsExternalVersion: 'yes' }],
  }
}
describe('fact-specific guidance without readiness scores', () => {
  it('retains actual use and release questions for the relevant unit', () => {
    const result = diagnosePlanning(sample())
    expect(result.currentPosition.some((text) => text.includes('自己利用と外部提供の両方'))).toBe(true)
    expect(result.eventTriggeredActions.map((row) => row.id)).toEqual(expect.arrayContaining(['internal-use:app', 'external-release:app']))
    expect(result).not.toHaveProperty('readiness')
  })
  it('does not require imaginary equipment, home costs or AI rules', () => {
    const result = diagnosePlanning(sample())
    expect(result.immediateActions.some((row) => ['review-equipment', 'review-home-costs', 'register-project-period-rules'].includes(row.id))).toBe(false)
  })
  it('asks for period attribution only when relevant observed AI usage exists', () => {
    const result = diagnosePlanning(sample(), { hasRelevantAiUsage: true })
    expect(result.immediateActions.some((row) => row.id === 'register-project-period-rules')).toBe(true)
  })
  it('keeps retrospective reconstruction and non-Git evidence actionable', () => {
    const planning = sample()
    planning.profile.journeyMode = 'retrospective'
    planning.directCosts.push({ id: 'c', incurredOn: '2026-07-01', costType: 'other', amountJpy: 1000, directlyAttributable: false, treatment: 'general', evidenceIds: [] })
    const result = diagnosePlanning(planning)
    expect(result.immediateActions.some((row) => row.id === 'reconstruct-history:app')).toBe(true)
    expect(result.immediateActions.find((row) => row.id === 'register-evidence')?.reason).toContain('スクリーンショット')
  })
  it('preserves missing actual-use evidence without a completion score', () => {
    const planning = sample()
    planning.taxUnits[0]!.lifecycleStatus = 'in-use'
    const result = diagnosePlanning(planning)
    expect(result.missingFacts).toContain('制作アプリの自己利用開始日と証拠')
    expect(result.missingFacts).toContain('制作アプリの外部提供開始日と証拠')
    expect(result).not.toHaveProperty('readiness')
  })
  it('does not demand retirement of an operating predecessor', () => {
    const planning = sample()
    planning.taxUnits.push({ ...planning.taxUnits[0]!, id: 'v2', name: '改良版', unitType: 'improvement-plan', predecessorId: 'app' })
    const result = diagnosePlanning(planning)
    expect(result.eventTriggeredActions.some((row) => row.id.startsWith('predecessor-retirement'))).toBe(false)
    expect(result.currentPosition.some((text) => text.includes('自動で終了・振替しません'))).toBe(true)
  })
  it('does not advise changing actual dates, splitting assets or spending to cross a boundary', () => {
    const serialized = JSON.stringify(diagnosePlanning(sample()))
    for (const term of ['供用日を遅らせ', '資産を分割', '追加購入', '経費を増やす']) expect(serialized).not.toContain(term)
  })
})
