import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { checkBalanceReferences } from '../../src/core/balanceReferences.js'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'

function fixture(): { planning: PlanningSnapshot; snapshot: BalanceSnapshot } {
  const planning: PlanningSnapshot = {
    version: 1,
    profile: {
      taxYear: 2026,
      journeyMode: 'retrospective',
      incomeCategory: 'undecided',
      filingType: 'undecided',
      monetizationStatus: 'planned',
      hasBookkeeping: true,
    },
    taxUnits: [
      {
        id: 'v1',
        name: 'Operating version',
        unitType: 'new-software',
        usageMode: 'internal',
        revenueModel: 'efficiency',
        lifecycleStatus: 'in-use',
      },
      {
        id: 'v2',
        name: 'Successor version',
        predecessorId: 'v1',
        unitType: 'new-software',
        usageMode: 'internal',
        revenueModel: 'efficiency',
        lifecycleStatus: 'developing',
      },
    ],
    projectRules: [],
    lifecycleEvents: [],
    equipment: [],
    homeCosts: [],
    directCosts: [],
    evidence: [
      {
        id: 'source-record',
        evidenceType: 'other',
        strength: 'self-recorded',
        recordedAt: '2026-01-01T00:00:00Z',
        note: 'Source and receiving version were reviewed',
      },
    ],
    decisions: [
      {
        id: 'transfer-decision',
        taxUnitId: 'v2',
        taxYear: 2026,
        engineVersion: 'manual-decision/1',
        candidate: 'partial-transfer',
        selectedCandidate: 'partial-transfer',
        reason: 'Explicit partial transfer, not retirement of the predecessor',
        status: 'confirmed',
        createdAt: '2026-01-01T00:00:00Z',
        confirmedAt: '2026-01-02T00:00:00Z',
      },
    ],
  }
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'old',
        taxUnitId: 'v1',
        name: 'Old balance',
        kind: 'asset',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 10000 },
      },
      {
        id: 'next',
        taxUnitId: 'v2',
        name: 'New balance',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    movements: [
      {
        id: 'transfer',
        kind: 'transfer',
        fromAccountId: 'old',
        toAccountId: 'next',
        occurredOn: '2026-06-01',
        amountJpy: 4000,
        sourceIds: ['source-record'],
        decisionId: 'transfer-decision',
        reason: 'Partial transfer',
        balanceAllocations: [{ sourceKind: 'opening', sourceId: 'old', amountJpy: 4000 }],
      },
    ],
    pendingDecisions: [],
  }
  return { planning, snapshot }
}
function codes(planning: PlanningSnapshot, snapshot: BalanceSnapshot) {
  return checkBalanceReferences(snapshot, planning, []).issues.map((row) => row.code)
}

describe('registered predecessor and successor balance transfers', () => {
  it('accepts the receiving version decision without retiring or rewriting the old version', () => {
    const { planning, snapshot } = fixture()
    const before = structuredClone({ planning, snapshot })
    assert.equal(checkBalanceReferences(snapshot, planning, []).status, 'consistent')
    assert.deepEqual({ planning, snapshot }, before)
    assert.equal(planning.taxUnits[0]!.lifecycleStatus, 'in-use')
    assert.equal(snapshot.movements.length, 1)
  })
  it('rejects a cross-unit transfer without a registered predecessor relation', () => {
    const { planning, snapshot } = fixture()
    delete planning.taxUnits[1]!.predecessorId
    assert.deepEqual(codes(planning, snapshot), ['decision-unit'])
  })
  it('rejects a predecessor relation to a different source unit', () => {
    const { planning, snapshot } = fixture()
    planning.taxUnits[1]!.predecessorId = 'unrelated'
    assert.deepEqual(codes(planning, snapshot), ['decision-unit'])
  })
  it('rejects use of the old version decision for the new version receipt', () => {
    const { planning, snapshot } = fixture()
    planning.decisions[0]!.taxUnitId = 'v1'
    assert.deepEqual(codes(planning, snapshot), ['decision-unit'])
  })
  it('does not allow reverse transfers based on a forward predecessor relation', () => {
    const { planning, snapshot } = fixture()
    const movement = snapshot.movements[0]!
    assert.equal(movement.kind, 'transfer')
    if (movement.kind !== 'transfer') throw new Error('fixture')
    movement.fromAccountId = 'next'
    movement.toAccountId = 'old'
    planning.decisions[0]!.taxUnitId = 'v1'
    assert.deepEqual(codes(planning, snapshot), ['decision-unit'])
  })
  it('retains the decision-year check', () => {
    const { planning, snapshot } = fixture()
    planning.decisions[0]!.taxYear = 2027
    assert.deepEqual(codes(planning, snapshot), ['decision-year'])
  })
  it('retains the confirmation check', () => {
    const { planning, snapshot } = fixture()
    planning.decisions[0]!.status = 'pending'
    assert.deepEqual(codes(planning, snapshot), ['unconfirmed-decision'])
  })
  it('retains the source existence check', () => {
    const { planning, snapshot } = fixture()
    planning.evidence = []
    assert.deepEqual(codes(planning, snapshot), ['missing-source'])
  })
  it('retains the missing receiving unit check', () => {
    const { planning, snapshot } = fixture()
    planning.taxUnits.pop()
    assert.deepEqual(codes(planning, snapshot), ['missing-unit', 'decision-unit'])
  })
  it('preserves existing same-unit transfers without requiring a predecessor', () => {
    const { planning, snapshot } = fixture()
    snapshot.accounts[1]!.taxUnitId = 'v1'
    planning.decisions[0]!.taxUnitId = 'v1'
    assert.equal(checkBalanceReferences(snapshot, planning, []).status, 'consistent')
  })
  it('does not apply transfer exceptions to ordinary additions', () => {
    const { planning, snapshot } = fixture()
    snapshot.movements = [
      {
        id: 'addition',
        kind: 'addition',
        accountId: 'old',
        occurredOn: '2026-06-01',
        amountJpy: 4000,
        sourceIds: ['source-record'],
        decisionId: 'transfer-decision',
        reason: 'Cannot use a different version decision',
      },
    ]
    assert.deepEqual(codes(planning, snapshot), ['decision-unit'])
  })
})
