import { describe, expect, it } from 'vitest'
import { checkBalanceReferences } from '../../src/core/balanceReferences.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'

function fixture() {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits = [
    {
      id: 'u',
      name: '合成アプリ',
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'efficiency',
      lifecycleStatus: 'developing',
    },
  ]
  planning.decisions = [
    {
      id: 'd',
      taxUnitId: 'u',
      taxYear: 2026,
      engineVersion: 'manual-decision/1',
      candidate: '記録',
      selectedCandidate: '記録',
      reason: '確認資料',
      status: 'confirmed',
      createdAt: '2026-01-01T00:00:00Z',
      confirmedAt: '2026-01-02T00:00:00Z',
    },
  ]
  planning.evidence = [
    {
      id: 'e',
      evidenceType: 'other',
      strength: 'self-recorded',
      recordedAt: '2026-01-01T00:00:00Z',
      note: '資料',
    },
  ]
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'a',
        taxUnitId: 'u',
        name: '制作中',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    movements: [
      {
        id: 'm',
        accountId: 'a',
        kind: 'addition',
        occurredOn: '2026-01-02',
        amountJpy: 100,
        sourceIds: ['e', 'ai:charge:c'],
        decisionId: 'd',
        reason: '資料による記録',
      },
    ],
    pendingDecisions: [],
  }
  return { planning, snapshot, charges: [{ id: 'c' }] }
}
describe('balance external reference checks', () => {
  it('requires a confirmed resolution decision for the same unit and resolution year', () => {
    const { planning, snapshot, charges } = fixture()
    snapshot.pendingDecisions = [
      {
        id: 'q',
        taxUnitId: 'u',
        taxYear: 2026,
        amount: { status: 'known', amountJpy: 0 },
        accountIds: ['a'],
        sourceIds: ['e'],
        reasons: ['未確認'],
        resolution: { taxYear: 2026, decisionId: 'd', reason: '資料確認' },
      },
    ]
    expect(checkBalanceReferences(snapshot, planning, charges).status).toBe('consistent')
    planning.decisions[0]!.status = 'pending'
    planning.decisions[0]!.taxYear = 2027
    planning.decisions[0]!.taxUnitId = 'other'
    expect(
      checkBalanceReferences(snapshot, planning, charges)
        .issues.filter((i) => i.recordType === 'pending')
        .map((i) => i.code),
    ).toEqual(['unconfirmed-decision', 'decision-year', 'decision-unit'])
    planning.decisions = []
    expect(
      checkBalanceReferences(snapshot, planning, charges).issues.some(
        (i) => i.recordType === 'pending' && i.code === 'missing-decision',
      ),
    ).toBe(true)
  })
  it('checks references without changing amounts or implying tax eligibility; detects decisions reopened after saving', () => {
    const { planning, snapshot, charges } = fixture()
    const original = structuredClone(snapshot)
    expect(checkBalanceReferences(snapshot, planning, charges)).toMatchObject({
      status: 'consistent',
      issues: [],
    })
    planning.decisions[0]!.status = 'pending'
    expect(checkBalanceReferences(snapshot, planning, charges).issues.map((i) => i.code)).toEqual([
      'unconfirmed-decision',
    ])
    expect(snapshot).toEqual(original)
  })
  it('reports missing units, sources and decisions and distinguishes ambiguous source identifiers', () => {
    const { planning, snapshot, charges } = fixture()
    planning.taxUnits = []
    planning.decisions = []
    planning.evidence[0]!.id = 'ai:charge:c'
    expect(checkBalanceReferences(snapshot, planning, charges).issues.map((i) => i.code)).toEqual([
      'missing-unit',
      'missing-source',
      'ambiguous-source',
      'missing-decision',
    ])
  })
  it('checks both transfer units, decision years and unresolved records regardless of display year', () => {
    const { planning, snapshot, charges } = fixture()
    snapshot.accounts.push({ ...snapshot.accounts[0]!, id: 'b', taxUnitId: 'other' })
    snapshot.movements[0] = {
      ...snapshot.movements[0]!,
      kind: 'transfer',
      fromAccountId: 'a',
      toAccountId: 'b',
      occurredOn: '2027-01-01',
    }
    snapshot.pendingDecisions = [
      {
        id: 'p',
        taxUnitId: 'u',
        taxYear: 2025,
        amount: { status: 'unknown', amountJpy: null, reasons: ['確認待ち'] },
        accountIds: ['b'],
        sourceIds: ['gone'],
        reasons: ['対応待ち'],
      },
    ]
    expect(checkBalanceReferences(snapshot, planning, charges).issues.map((i) => i.code)).toEqual([
      'missing-unit',
      'decision-year',
      'decision-unit',
      'missing-source',
      'pending-unit',
    ])
  })
})
