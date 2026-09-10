import { describe, expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { isNewWorkspace, workspaceChangeKind } from '../../src/core/workspaceChange.js'

function input(): { configuration: import('../../src/client/types.js').LocalConfiguration; planning: import('../../src/planning/types.js').PlanningSnapshot } {
  return {
    configuration: {
      charges: { claude: 0, codex: 0 }, monthlyCharges: [],
      contracts: { claude: {}, codex: {} }, chargePeriods: [], unobservedRatio: null,
    },
    planning: emptyPlanningSnapshot(2026),
  }
}

describe('save-path selection, not an authorization mechanism', () => {
  it('saves a changed memo without asking for an all-year monetary preview', () => {
    const before = input(), after = structuredClone(before)
    after.planning.profile.notes = '相談のための覚書'
    expect(workspaceChangeKind(before, before)).toBe('none')
    expect(workspaceChangeKind(before, after)).toBe('notes')
  })
  it('does not suppress changes to methods, dates, references, or equal-valued destinations', () => {
    const before = input()
    for (const mutate of [
      (after: ReturnType<typeof input>) => { after.planning.profile.taxYear = 2027 },
      (after: ReturnType<typeof input>) => { after.configuration.unobservedRatio = 0 },
      (after: ReturnType<typeof input>) => { after.planning.profile.hasBookkeeping = true },
      (after: ReturnType<typeof input>) => { after.planning.decisions.push({ id: 'd', taxUnitId: 'a', taxYear: 2026, engineVersion: 'manual', candidate: 'hold', status: 'pending', createdAt: '2026-09-10T00:00:00Z' }) },
    ]) {
      const after = structuredClone(before)
      mutate(after)
      expect(workspaceChangeKind(before, after)).toBe('calculation')
    }
  })
  it('does not require AI history for a direct-cost-only workspace', () => {
    const before = input()
    expect(isNewWorkspace(before, 0)).toBe(true)
    before.planning.directCosts.push({ id: 'cost', incurredOn: '2026-09-01', costType: 'other', amountJpy: 1000, directlyAttributable: false, treatment: 'general', evidenceIds: [] })
    expect(isNewWorkspace(before, 0)).toBe(false)
  })
  it('keeps new evidence records and new unrecognized fields out of the memo shortcut', () => {
    const before = input(), after = structuredClone(before)
    after.planning.evidence.push({ id: 'e', evidenceType: 'memo', strength: 'self-recorded', note: '根拠', recordedAt: '2026-09-10T00:00:00Z' })
    expect(workspaceChangeKind(before, after)).toBe('calculation')
    expect(workspaceChangeKind(before, { ...before, planning: { ...before.planning, hypotheticalAmount: 1 } } as never)).toBe('calculation')
  })
})
