import { describe, expect, it } from 'vitest'
import type { ProjectRuleRecord } from '../../src/planning/types.js'
import { resolveSessionAssignment } from '../../src/server/sessionAssignment.ts'

const session = {
  projectKey: 'project_a',
  provider: 'codex' as const,
  startedAt: '2026-07-15T03:00:00.000Z',
}

function rule(overrides: Partial<ProjectRuleRecord> = {}): ProjectRuleRecord {
  return {
    id: 'rule-1',
    projectKey: 'project_a',
    effectiveFrom: '2026-07-01',
    taxUnitId: 'tax-unit-a',
    classification: 'new-development',
    ...overrides,
  }
}

describe('resolveSessionAssignment', () => {
  it('ルールがなければ未割当を返す', () => {
    expect(resolveSessionAssignment(session, [], 'Asia/Tokyo')).toEqual({
      taxUnitId: null,
      classification: 'unclassified',
      ruleId: null,
    })
  })

  it('期間内の単一ルールを採用する', () => {
    expect(resolveSessionAssignment(session, [rule()], 'Asia/Tokyo')).toEqual({
      taxUnitId: 'tax-unit-a',
      classification: 'new-development',
      ruleId: 'rule-1',
    })
  })

  it('月の途中で切り替わるルールをセッション単位で振り分ける', () => {
    const rules = [
      rule({ id: 'rule-early', effectiveFrom: '2026-07-01', effectiveTo: '2026-07-14' }),
      rule({ id: 'rule-late', effectiveFrom: '2026-07-15', classification: 'maintenance' }),
    ]

    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-late')
    expect(resolveSessionAssignment(
      { ...session, startedAt: '2026-07-10T03:00:00.000Z' }, rules, 'Asia/Tokyo',
    ).ruleId).toBe('rule-early')
  })

  it('開始日当日と終了日当日を期間に含める', () => {
    const rules = [rule({ effectiveFrom: '2026-07-15', effectiveTo: '2026-07-15' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-1')
  })

  it('期間外のルールは採用しない', () => {
    const rules = [rule({ effectiveFrom: '2026-07-16' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').taxUnitId).toBeNull()
  })

  it('projectKeyが違うルールは無視する', () => {
    const rules = [rule({ projectKey: 'project_b' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').taxUnitId).toBeNull()
  })

  it('provider指定が合わないルールは無視する', () => {
    const rules = [rule({ provider: 'claude' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').taxUnitId).toBeNull()
  })

  it('provider指定のあるルールを優先する', () => {
    const rules = [
      rule({ id: 'rule-any' }),
      rule({ id: 'rule-codex', provider: 'codex', classification: 'maintenance' }),
    ]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-codex')
  })

  it('同じ具体度ならeffectiveFromが新しい方を優先する', () => {
    const rules = [
      rule({ id: 'rule-old', effectiveFrom: '2026-07-01' }),
      rule({ id: 'rule-new', effectiveFrom: '2026-07-10' }),
    ]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-new')
  })

  it('effectiveFromも同じならid昇順で決定的に選ぶ', () => {
    const rules = [
      rule({ id: 'rule-b' }),
      rule({ id: 'rule-a' }),
    ]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-a')
  })

  it('taxUnitIdのないルールは分類だけを返す', () => {
    const rules = [rule({ taxUnitId: undefined, classification: 'private' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo')).toEqual({
      taxUnitId: null,
      classification: 'private',
      ruleId: 'rule-1',
    })
  })

  it('タイムゾーンで日付が変わる境界を正しく扱う', () => {
    const lateNight = { ...session, startedAt: '2026-07-14T23:00:00.000Z' }
    const rules = [rule({ id: 'rule-15th', effectiveFrom: '2026-07-15' })]

    expect(resolveSessionAssignment(lateNight, rules, 'Asia/Tokyo').ruleId).toBe('rule-15th')
    expect(resolveSessionAssignment(lateNight, rules, 'UTC').taxUnitId).toBeNull()
  })
})
