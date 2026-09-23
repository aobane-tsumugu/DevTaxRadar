import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { fixture, addFacts } from './helpers/treatmentFixtures.js'
import {
  draftTreatmentDecision,
  draftTreatmentAddition,
  refreshTreatmentDecision,
} from '../../src/core/costTreatmentDraft.js'
import {
  treatmentDecisionBindingMatches,
  validateTreatmentDecisionBinding,
} from '../../src/core/treatmentDecisionBinding.js'
import { costTreatmentBasis } from '../../src/core/costTreatments.js'
import { checkTreatmentDecisionReferences } from '../../src/core/treatmentDecisionReferences.js'
const references = {
  engineVersion: 'balance-references/1' as const,
  issues: [],
  status: 'consistent' as const,
}
function prepared() {
  const f = fixture()
  addFacts(f)
  const decision = draftTreatmentDecision(
    f.costs,
    f.planning,
    'part',
    'decision',
    '2026-09-18T00:00:00Z',
  )
  f.planning.decisions = [{ ...decision, status: 'confirmed', confirmedAt: '2026-09-18T01:00:00Z' }]
  const balances: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'construction',
        name: '合成残高',
        taxUnitId: 'unit',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    movements: [],
    pendingDecisions: [],
  }
  return { ...f, balances, decision }
}
const input = {
  contributionId: 'part',
  decisionId: 'decision',
  accountId: 'construction',
  occurredOn: '2026-01-31',
  id: 'new',
}
describe('candidate through existing decision and original cost-link prefill', () => {
  it('creates an unconfirmed bound decision without persisting or confirming', () => {
    const f = fixture()
    addFacts(f)
    const before = JSON.stringify(f)
    const d = draftTreatmentDecision(f.costs, f.planning, 'part', 'd', '2026-09-18T00:00:00Z')
    assert.equal(d.status, 'pending')
    assert.equal(d.confirmedAt, undefined)
    assert.ok(treatmentDecisionBindingMatches(d, f.costs, f.planning))
    assert.equal(JSON.stringify(f), before)
    assert.ok(!JSON.stringify(d).includes('PRIVATE-LOCAL-REFERENCE'))
  })
  it('rejects duplicate decision creation and explicitly refreshes into pending', () => {
    const f = prepared()
    assert.throws(() =>
      draftTreatmentDecision(f.costs, f.planning, 'part', 'd2', '2026-09-18T00:00:00Z'),
    )
    const d = refreshTreatmentDecision(f.costs, f.planning, 'part', 'decision')
    assert.equal(d.status, 'pending')
    assert.equal(d.confirmedAt, undefined)
    assert.equal(d.createdAt, f.decision.createdAt)
  })
  it('uses the existing allocator and leaves original drafts untouched', () => {
    const f = prepared()
    const before = JSON.stringify(f)
    const next = draftTreatmentAddition(f.costs, f.planning, f.balances, input)
    assert.equal(next.movements[0]!.amountJpy, 1000)
    assert.deepEqual(next.movements[0]!.kind === 'addition' && next.movements[0].costAllocations, [
      { costYear: 2026, contributionId: 'part', amountJpy: 1000 },
    ])
    assert.equal(JSON.stringify(f), before)
    assert.throws(
      () => draftTreatmentAddition(f.costs, f.planning, next, { ...input, id: 'duplicate' }),
      /未使用額/,
    )
  })
  it('subtracts already linked claims from all years rather than reposting the whole cost', () => {
    const f = prepared()
    f.balances.movements.push({
      ...input,
      kind: 'addition',
      accountId: 'construction',
      id: 'old',
      occurredOn: '2027-01-01',
      amountJpy: 400,
      sourceIds: ['source'],
      reason: '合成',
      costAllocations: [{ costYear: 2026, contributionId: 'part', amountJpy: 400 }],
    })
    assert.equal(
      draftTreatmentAddition(f.costs, f.planning, f.balances, input).movements.at(-1)!.amountJpy,
      600,
    )
  })
  for (const kind of [
    'pending',
    'stale',
    'wrong-account',
    'too-early',
    'wrong-year',
    'ordinary',
  ] as const)
    it(`blocks ${kind} without rewriting input`, () => {
      const f = prepared()
      if (kind === 'pending') f.planning.decisions[0]!.status = 'pending'
      if (kind === 'stale') f.planning.evidence[0]!.note += '変更'
      if (kind === 'wrong-account') f.balances.accounts[0]!.kind = 'asset'
      if (kind === 'ordinary') {
        f.planning.lifecycleEvents = [
          {
            id: 'used',
            taxUnitId: 'unit',
            eventType: 'internal-use-started',
            occurredOn: '2025-12-01',
            recordedAt: '2025-12-01T00:00:00Z',
            evidenceIds: ['proof'],
          },
        ]
        addFacts(f, {
          workPurpose: 'ordinary-operation',
          assetKind: 'none',
          placedInService: 'after',
          liabilityFixedAtYearEnd: true,
        })
        f.planning.decisions = []
        f.planning.decisions = [
          {
            ...draftTreatmentDecision(
              f.costs,
              f.planning,
              'part',
              'decision',
              '2026-09-18T00:00:00Z',
            ),
            status: 'confirmed',
            confirmedAt: '2026-09-18T01:00:00Z',
          },
        ]
      }
      const before = JSON.stringify(f)
      assert.throws(() =>
        draftTreatmentAddition(f.costs, f.planning, f.balances, {
          ...input,
          occurredOn:
            kind === 'too-early'
              ? '2026-01-01'
              : kind === 'wrong-year'
                ? '2027-01-31'
                : input.occurredOn,
        }),
      )
      assert.equal(JSON.stringify(f), before)
    })
  it('does not use a confirmed decision for a different cost of the same unit', () => {
    const f = prepared()
    const extra = { ...f.costs.contributions[0]!, id: 'other-part', amountJpy: 0 }
    f.costs.contributions.push(extra)
    const existing = f.planning.costTreatmentFacts![0]!
    f.planning.costTreatmentFacts!.push({
      ...existing,
      id: 'other-facts',
      contributionId: extra.id,
      costBasis: costTreatmentBasis(f.costs, f.planning, extra.id, existing.evidenceIds),
    })
    const before = JSON.stringify(f)
    assert.throws(
      () =>
        draftTreatmentAddition(f.costs, f.planning, f.balances, {
          ...input,
          contributionId: extra.id,
        }),
      /判断/,
    )
    assert.equal(JSON.stringify(f), before)
  })
  it('refuses ambiguous old unlinked claims', () => {
    const f = prepared()
    f.balances.movements.push({
      ...input,
      kind: 'addition',
      id: 'old',
      amountJpy: 400,
      sourceIds: ['source'],
      reason: '合成',
    })
    assert.throws(() => draftTreatmentAddition(f.costs, f.planning, f.balances, input), /未対応額/)
  })
  it('validates canonical bindings and rejects extra fields', () => {
    const f = prepared()
    const b = f.decision.treatmentBinding!
    assert.throws(() => validateTreatmentDecisionBinding({ ...b, basis: 'null' }))
    assert.throws(() => validateTreatmentDecisionBinding({ ...b, extra: true }))
  })
})
describe('server-side adoption guard for bound proposals', () => {
  it('accepts aligned drafts and preserves existing reference issues', () => {
    const f = prepared()
    const balances = draftTreatmentAddition(f.costs, f.planning, f.balances, input)
    assert.equal(
      checkTreatmentDecisionReferences(balances, f.planning, [f.costs], 2026, references).status,
      'consistent',
    )
    const bad = {
      ...references,
      issues: [
        {
          recordType: 'movement' as const,
          recordId: 'other',
          referenceId: 'missing',
          code: 'missing-source' as const,
          message: '既存の問題',
        },
      ],
    }
    assert.equal(
      checkTreatmentDecisionReferences(balances, f.planning, [f.costs], 2026, bad).issues.length,
      1,
    )
  })
  for (const kind of [
    'evidence',
    'unbound-cost',
    'wrong-kind',
    'changed-amount',
    'no-projection',
  ] as const)
    it(`does not let ${kind} pass just because a decision says confirmed`, () => {
      const f = prepared()
      const balances = draftTreatmentAddition(f.costs, f.planning, f.balances, input)
      if (kind === 'evidence') f.planning.evidence[0]!.note += '同額の根拠変更'
      if (kind === 'unbound-cost' && balances.movements[0]!.kind === 'addition')
        balances.movements[0].costAllocations![0]!.contributionId = 'different'
      if (kind === 'wrong-kind') f.balances.accounts[0]!.kind = balances.accounts[0]!.kind = 'asset'
      if (kind === 'changed-amount') balances.movements[0]!.amountJpy++
      assert.equal(
        checkTreatmentDecisionReferences(
          balances,
          f.planning,
          kind === 'no-projection' ? [] : [f.costs],
          2026,
          references,
        ).status,
        'needs-review',
      )
    })
  it('does not mix future-year entries into current adoption', () => {
    const f = prepared()
    const balances = draftTreatmentAddition(f.costs, f.planning, f.balances, input)
    balances.movements[0]!.occurredOn = '2027-01-01'
    f.planning.evidence[0]!.note += '変更'
    assert.equal(
      checkTreatmentDecisionReferences(balances, f.planning, [], 2026, references).status,
      'consistent',
    )
  })
  it('detects changed conditions even after the cost basis itself is rebound', () => {
    const f = prepared()
    const balances = draftTreatmentAddition(f.costs, f.planning, f.balances, input)
    f.planning.costTreatmentFacts![0]!.reason += '条件変更'
    f.planning.costTreatmentFacts![0]!.costBasis = costTreatmentBasis(f.costs, f.planning, 'part', [
      'proof',
    ])
    assert.equal(
      checkTreatmentDecisionReferences(balances, f.planning, [f.costs], 2026, references).status,
      'needs-review',
    )
  })
})
