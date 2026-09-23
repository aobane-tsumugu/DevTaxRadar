import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import { checkBalanceReferences } from '../../src/core/balanceReferences.js'
import {
  externalOpeningIssues,
  externalOpeningRecord,
  recordExternalOpening,
} from '../../src/core/externalOpening.js'

const uuid = '00000000-0000-4000-8000-000000000001'
function fixture() {
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'a',
        taxUnitId: 'u',
        name: '既存アプリ',
        kind: 'asset',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 123456 },
      },
    ],
    movements: [],
    pendingDecisions: [],
  }
  const planning: PlanningSnapshot = {
    version: 1,
    profile: {
      taxYear: 2026,
      journeyMode: 'retrospective',
      incomeCategory: 'undecided',
      filingType: 'undecided',
      monetizationStatus: 'planned',
      hasBookkeeping: false,
    },
    taxUnits: [
      {
        id: 'u',
        name: '既存アプリ',
        unitType: 'new-software',
        usageMode: 'internal',
        revenueModel: 'efficiency',
        lifecycleStatus: 'in-use',
      },
    ],
    projectRules: [],
    lifecycleEvents: [],
    equipment: [],
    homeCosts: [],
    directCosts: [],
    evidence: [
      {
        id: 'e',
        evidenceType: 'other',
        strength: 'external',
        recordedAt: '2026-01-01T00:00:00Z',
        note: '前年の残高明細',
        localReference: 'C:/private/account.pdf',
      },
    ],
    decisions: [
      {
        id: 'd',
        taxUnitId: 'u',
        taxYear: 2026,
        engineVersion: 'manual-decision/1',
        candidate: '期首の記録',
        selectedCandidate: '外部資料の未償却残高',
        reason: '明細と照合',
        status: 'confirmed',
        createdAt: '2026-01-01T00:00:00Z',
        confirmedAt: '2026-01-02T00:00:00Z',
      },
    ],
  }
  const input = {
    accountId: 'a',
    requestId: uuid,
    reference: '前年明細、2026年期首の未償却残高',
    evidenceIds: ['e'],
    decisionId: 'd',
    recordedAt: '2026-01-03T00:00:00Z',
  }
  return { snapshot, planning, input }
}

describe('external opening linked to existing factual questions', () => {
  it('binds a known opening without adding a movement or copying private paths', () => {
    const { snapshot, planning, input } = fixture()
    const before = structuredClone(snapshot)
    const next = recordExternalOpening(snapshot, planning, input)
    assert.deepEqual(snapshot, before)
    assert.deepEqual(next.accounts, before.accounts)
    assert.deepEqual(next.movements, [])
    assert.equal(next.pendingDecisions.length, 1)
    assert.equal(next.pendingDecisions[0]!.resolution?.decisionId, 'd')
    assert.deepEqual(externalOpeningIssues(next, planning), [])
    assert.equal(checkBalanceReferences(next, planning, []).status, 'consistent')
    assert.equal(JSON.stringify(next).includes('C:/private'), false)
  })
  it('keeps an unknown opening unresolved and does not require a fictional zero or decision', () => {
    const { snapshot, planning, input } = fixture()
    snapshot.accounts[0]!.opening = {
      status: 'unknown',
      amountJpy: null,
      reasons: ['明細の一部が不明'],
    }
    planning.decisions = []
    const next = recordExternalOpening(snapshot, planning, { ...input, decisionId: undefined })
    assert.equal(next.accounts[0]!.opening.amountJpy, null)
    assert.equal(next.pendingDecisions[0]!.amount.amountJpy, null)
    assert.equal(next.pendingDecisions[0]!.resolution, undefined)
    assert.deepEqual(externalOpeningIssues(next, planning), [])
  })
  it('keeps the same record on re-confirmation, without accumulating duplicate balances', () => {
    const { snapshot, planning, input } = fixture()
    const first = recordExternalOpening(snapshot, planning, input)
    const second = recordExternalOpening(first, planning, { ...input, reference: '追加資料も確認' })
    assert.equal(second.pendingDecisions.length, 1)
    assert.equal(second.pendingDecisions[0]!.id, first.pendingDecisions[0]!.id)
    assert.equal(second.accounts[0]!.opening.amountJpy, 123456)
    assert.deepEqual(externalOpeningIssues(second, planning), [])
  })
  for (const kind of ['construction', 'asset', 'prepaid'] as const) {
    it(`distinguishes the meaning of ${kind}`, () => {
      const { snapshot, planning, input } = fixture()
      snapshot.accounts[0]!.kind = kind
      const next = recordExternalOpening(snapshot, planning, input)
      assert.deepEqual(externalOpeningIssues(next, planning), [])
      next.accounts[0]!.kind = kind === 'asset' ? 'prepaid' : 'asset'
      assert.ok(externalOpeningIssues(next, planning).length)
    })
  }
  for (const field of [
    'amount',
    'year',
    'unit',
    'reason',
    'answer',
    'decision',
    'external-source',
  ] as const) {
    it(`does not reuse a stale ${field} confirmation`, () => {
      const { snapshot, planning, input } = fixture()
      const next = recordExternalOpening(snapshot, planning, input)
      if (field === 'amount') next.accounts[0]!.opening = { status: 'known', amountJpy: 234567 }
      if (field === 'year') next.accounts[0]!.openingYear = 2027
      if (field === 'unit') next.accounts[0]!.taxUnitId = 'other'
      if (field === 'reason') next.pendingDecisions[0]!.reasons[1] = '確認後の書換え'
      if (field === 'answer') next.pendingDecisions[0]!.answers![0]!.answer = '確認後の回答'
      if (field === 'decision') planning.decisions[0]!.status = 'pending'
      if (field === 'external-source') planning.evidence[0]!.strength = 'self-recorded'
      assert.equal(checkBalanceReferences(next, planning, []).status, 'needs-review')
    })
  }
  it('compares equivalent amount objects independently of JSON property order', () => {
    const { snapshot, planning, input } = fixture()
    const next = recordExternalOpening(snapshot, planning, input)
    next.accounts[0]!.opening = { amountJpy: 123456, status: 'known' }
    assert.deepEqual(externalOpeningIssues(next, planning), [])
  })
  it('does not overwrite an adopted carry or touch the original on failure', () => {
    const { snapshot, planning, input } = fixture()
    snapshot.accounts[0]!.openingRevisionId = 'adopted-review'
    const before = structuredClone(snapshot)
    assert.throws(() => recordExternalOpening(snapshot, planning, input), /採用版/)
    assert.deepEqual(snapshot, before)
  })
  for (const invalid of [
    'missing-unit',
    'missing-evidence',
    'duplicate-evidence',
    'self-only',
    'pending-decision',
    'wrong-year',
    'wrong-unit',
    'blank-reference',
    'bad-date',
    'normalized-bad-date',
    'future-evidence',
    'future-decision',
    'bad-id',
    'negative',
    'unsafe',
  ] as const) {
    it(`rejects ${invalid} without altering the input`, () => {
      const { snapshot, planning, input } = fixture()
      if (invalid === 'missing-unit') planning.taxUnits = []
      if (invalid === 'missing-evidence') input.evidenceIds = ['missing']
      if (invalid === 'duplicate-evidence') input.evidenceIds = ['e', 'e']
      if (invalid === 'self-only') planning.evidence[0]!.strength = 'self-recorded'
      if (invalid === 'pending-decision') planning.decisions[0]!.status = 'pending'
      if (invalid === 'wrong-year') planning.decisions[0]!.taxYear = 2027
      if (invalid === 'wrong-unit') planning.decisions[0]!.taxUnitId = 'other'
      if (invalid === 'blank-reference') input.reference = ' '
      if (invalid === 'bad-date') input.recordedAt = 'wrong'
      if (invalid === 'normalized-bad-date') input.recordedAt = '2026-02-30T00:00:00Z'
      if (invalid === 'future-evidence') planning.evidence[0]!.recordedAt = '2026-02-01T00:00:00Z'
      if (invalid === 'future-decision') planning.decisions[0]!.confirmedAt = '2026-02-01T00:00:00Z'
      if (invalid === 'bad-id') input.requestId = 'not-uuid'
      if (invalid === 'negative') snapshot.accounts[0]!.opening = { status: 'known', amountJpy: -1 }
      if (invalid === 'unsafe')
        snapshot.accounts[0]!.opening = { status: 'known', amountJpy: Number.MAX_SAFE_INTEGER + 1 }
      const before = structuredClone(snapshot)
      assert.throws(() => recordExternalOpening(snapshot, planning, input))
      assert.deepEqual(snapshot, before)
    })
  }
  it('detects duplicate imported proof instead of arbitrarily choosing one', () => {
    const { snapshot, planning, input } = fixture()
    const next = recordExternalOpening(snapshot, planning, input)
    next.pendingDecisions.push({
      ...structuredClone(next.pendingDecisions[0]!),
      id: 'external-opening:duplicate',
    })
    assert.throws(() => externalOpeningRecord(next, 'a'), /複数/)
    assert.ok(externalOpeningIssues(next, planning).some((row) => row.message.includes('重複')))
  })
})
