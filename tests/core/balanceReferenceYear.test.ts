import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { BalanceSnapshot, PendingBalanceDecision } from '../../src/accounting/types.js'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import type { AdjustmentCostContext } from '../../src/core/adjustmentBalanceLinks.js'
import { checkBalanceReferences } from '../../src/core/balanceReferences.js'
import {
  consultationAnswersForYear,
  consultationQuestionBasis,
} from '../../src/core/consultationResolution.js'

function fixture() {
  const planning: PlanningSnapshot = {
    version: 1,
    profile: {
      taxYear: 2026,
      journeyMode: 'early',
      incomeCategory: 'undecided',
      filingType: 'undecided',
      monetizationStatus: 'planned',
      hasBookkeeping: false,
    },
    taxUnits: [{
      id: 'u', name: '合成アプリ', unitType: 'new-software',
      usageMode: 'internal', revenueModel: 'efficiency', lifecycleStatus: 'developing',
    }],
    projectRules: [], lifecycleEvents: [], equipment: [], homeCosts: [], directCosts: [],
    evidence: [{
      id: 'e', evidenceType: 'other', strength: 'external',
      recordedAt: '2026-01-01T00:00:00Z', note: '合成資料',
    }],
    decisions: [{
      id: 'd', taxUnitId: 'u', taxYear: 2026, engineVersion: 'manual-decision/1',
      candidate: '記録', selectedCandidate: '記録', reason: '合成資料による確認',
      status: 'confirmed', createdAt: '2026-01-01T00:00:00Z',
      confirmedAt: '2026-01-02T00:00:00Z',
    }],
  }
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [{
      id: 'a', taxUnitId: 'u', name: '制作中', kind: 'construction', openingYear: 2026,
      opening: { status: 'known', amountJpy: 0 },
    }],
    movements: [{
      id: 'm', accountId: 'a', kind: 'addition', occurredOn: '2026-01-02',
      amountJpy: 100, sourceIds: ['e'], decisionId: 'd', reason: '合成資料による記録',
    }],
    pendingDecisions: [],
  }
  const context: AdjustmentCostContext = { costs: [], trace: { year: 2026, movements: [] } }
  const check = (year: number | undefined = 2026, costs: AdjustmentCostContext | undefined = undefined) =>
    checkBalanceReferences(snapshot, planning, [], [], costs, year)
  const futureMovement = () => snapshot.movements.push({
    id: 'future', accountId: 'a', kind: 'addition', occurredOn: '2027-01-01',
    amountJpy: 10, sourceIds: ['e'], decisionId: 'future-decision', reason: '翌年度の作業案',
  })
  const question = (taxYear = 2026): PendingBalanceDecision => ({
    id: 'q', taxUnitId: 'u', taxYear, amount: { status: 'known', amountJpy: 50 },
    accountIds: ['a'], sourceIds: ['e'], reasons: ['要確認'],
  })
  return { planning, snapshot, context, check, futureMovement, question }
}

function freeze(value: unknown) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(freeze)
  }
}

describe('annual balance reference scope', () => {
  it('does not make next-year draft decisions a prerequisite for this year', () => {
    const f = fixture()
    f.futureMovement()
    assert.equal(f.check().status, 'consistent')
    assert.ok(f.check(2027).issues.some((row) => row.recordId === 'future'))
  })

  it('keeps the existing full-snapshot check when no year is specified', () => {
    const f = fixture()
    f.futureMovement()
    assert.ok(checkBalanceReferences(f.snapshot, f.planning, []).issues.some(
      (row) => row.recordId === 'future' && row.code === 'missing-decision',
    ))
  })

  it('ignores future accounts only for annual reference checks', () => {
    const f = fixture()
    f.snapshot.accounts.push({
      ...f.snapshot.accounts[0]!, id: 'future-account', taxUnitId: 'future-unit', openingYear: 2027,
    })
    assert.equal(f.check().status, 'consistent')
    assert.ok(f.check(2027).issues.some((row) => row.code === 'missing-unit'))
  })

  it('still reports missing current-year decisions', () => {
    const f = fixture()
    f.planning.decisions = []
    assert.ok(f.check().issues.some((row) => row.code === 'missing-decision'))
  })

  it('still reports reopened current-year decisions', () => {
    const f = fixture()
    f.planning.decisions[0]!.status = 'pending'
    assert.ok(f.check().issues.some((row) => row.code === 'unconfirmed-decision'))
  })

  it('still checks earlier postings used by a later-year closing', () => {
    const f = fixture()
    f.planning.decisions[0]!.status = 'pending'
    assert.ok(f.check(2028).issues.some((row) => row.recordId === 'm'))
  })

  it('still detects current-year missing and ambiguous sources', () => {
    const f = fixture()
    f.snapshot.movements[0]!.sourceIds = ['gone', 'direct:x']
    f.planning.directCosts = [{
      id: 'x', incurredOn: '2026-01-01', costType: 'other', amountJpy: 100,
      directlyAttributable: true, treatment: 'direct', taxUnitId: 'u', evidenceIds: ['e'],
    }]
    f.planning.evidence.push({ ...f.planning.evidence[0]!, id: 'direct:x' })
    const codes = f.check().issues.map((row) => row.code)
    assert.ok(codes.includes('missing-source'))
    assert.ok(codes.includes('ambiguous-source'))
  })

  it('does not inspect a future question until its year is in scope', () => {
    const f = fixture()
    f.snapshot.pendingDecisions.push({ ...f.question(2027), sourceIds: ['not-yet-linked'] })
    assert.equal(f.check().status, 'consistent')
    assert.ok(f.check(2027).issues.some((row) => row.recordId === 'q'))
  })

  it('keeps a current question unresolved when its resolution belongs to a later year', () => {
    const f = fixture()
    const question = f.question()
    question.resolution = { taxYear: 2027, decisionId: 'later-decision', reason: '翌年に回答' }
    f.snapshot.pendingDecisions.push(question)
    assert.equal(f.check().status, 'consistent')
    assert.ok(f.check(2027).issues.some((row) => row.code === 'missing-decision'))
    assert.equal(question.resolution.taxYear, 2027)
  })

  it('still reports a broken current-year resolution', () => {
    const f = fixture()
    const question = f.question()
    question.resolution = { taxYear: 2026, decisionId: 'missing', reason: '当年の回答' }
    f.snapshot.pendingDecisions.push(question)
    assert.ok(f.check().issues.some((row) => row.code === 'missing-decision'))
  })

  it('keeps confirmed question and answer matching for the selected year', () => {
    const f = fixture()
    const question = f.question()
    question.answers = [{
      id: 'answer', taxYear: 2026, receivedOn: '2026-03-01', kind: 'fact',
      answer: '合成の事実', source: '合成資料',
    }]
    question.resolution = { taxYear: 2026, decisionId: 'd', reason: '当年の確認' }
    question.resolution.answerBasis = consultationAnswersForYear(question, 2026)
    question.resolution.questionBasis = consultationQuestionBasis(question)
    question.answers.push({ ...question.answers[0]!, id: 'later-answer', taxYear: 2027 })
    f.snapshot.pendingDecisions.push(question)
    assert.equal(f.check().status, 'consistent')
    question.answers[0]!.answer = '当年の事実を変更'
    assert.ok(f.check().issues.some((row) => row.code === 'changed-answer'))
  })

  it('keeps current-year pending-to-account unit checks', () => {
    const f = fixture()
    f.snapshot.accounts.push({
      ...f.snapshot.accounts[0]!, id: 'future-account', taxUnitId: 'other', openingYear: 2027,
    })
    f.snapshot.pendingDecisions.push({ ...f.question(), accountIds: ['future-account'] })
    assert.ok(f.check().issues.some((row) => row.code === 'pending-unit'))
  })

  it('does not require a future external-opening confirmation for this year', () => {
    const f = fixture()
    f.snapshot.accounts.push({ ...f.snapshot.accounts[0]!, id: 'future-account', openingYear: 2027 })
    f.snapshot.pendingDecisions.push({
      ...f.question(2027), id: 'external-opening:future', accountIds: ['future-account'],
    })
    assert.equal(f.check().status, 'consistent')
    assert.ok(f.check(2027).issues.some((row) => row.code === 'changed-answer'))
  })

  it('does not silently confirm a current external opening with a future resolution', () => {
    const f = fixture()
    f.snapshot.pendingDecisions.push({
      ...f.question(), id: 'external-opening:current',
      resolution: { taxYear: 2027, decisionId: 'later', reason: '後で確認' },
    })
    assert.ok(f.check().issues.some((row) => row.code === 'changed-answer'))
  })

  it('excludes future refund links from both generic source checks and cost checks', () => {
    const f = fixture()
    f.planning.sourceAdjustments = [{
      id: 'refund', sourceId: 'direct:future', sourceYear: 2027,
      sourceBasis: { kind: 'direct', originalAmountJpy: 100 },
      kind: 'refund', amountJpy: -10, occurredOn: '2027-02-01',
      recordedAt: '2027-02-01T00:00:00Z', effect: 'balance-reduction',
      balanceMovementId: 'future-reduction', reason: '翌年の返金', evidenceIds: ['future-receipt'],
    }]
    assert.equal(f.check(2026, f.context).status, 'consistent')
    assert.ok(f.check(2027).issues.some((row) => row.code === 'adjustment-link'))
  })

  it('still checks current-year refund references and missing reductions', () => {
    const f = fixture()
    f.planning.sourceAdjustments = [{
      id: 'refund', sourceId: 'direct:missing', sourceYear: 2026,
      sourceBasis: { kind: 'direct', originalAmountJpy: 100 },
      kind: 'refund', amountJpy: -10, occurredOn: '2026-02-01',
      recordedAt: '2026-02-01T00:00:00Z', effect: 'balance-reduction',
      balanceMovementId: 'missing-reduction', reason: '当年の返金', evidenceIds: ['e'],
    }]
    const codes = f.check(2026, f.context).issues.map((row) => row.code)
    assert.ok(codes.includes('missing-source'))
    assert.ok(codes.includes('adjustment-link'))
  })

  it('rejects a trace built for a different year rather than skipping refund checks', () => {
    const f = fixture()
    assert.throws(() => f.check(2027, f.context), /年度/)
  })

  for (const year of [1899, 10000, 2026.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`rejects invalid explicit review year ${String(year)}`, () => {
      assert.throws(() => fixture().check(year), /年度/)
    })
  }

  it('uses an explicit review year rather than the mutable profile display year', () => {
    const f = fixture()
    f.futureMovement()
    f.planning.profile.taxYear = 2027
    assert.equal(f.check(2026).status, 'consistent')
    assert.ok(f.check(2027).issues.some((row) => row.recordId === 'future'))
  })

  it('does not mutate frozen drafts, including future resolutions and answers', () => {
    const f = fixture()
    const question = f.question()
    question.answers = [{
      id: 'future-answer', taxYear: 2027, receivedOn: '2027-01-01', kind: 'fact',
      answer: '翌年の記録', source: '合成資料',
    }]
    question.resolution = { taxYear: 2027, decisionId: 'later', reason: '翌年の確認' }
    f.snapshot.pendingDecisions.push(question)
    const before = JSON.stringify([f.snapshot, f.planning, f.context])
    freeze(f.snapshot); freeze(f.planning); freeze(f.context)
    assert.equal(f.check(2026, f.context).status, 'consistent')
    assert.equal(JSON.stringify([f.snapshot, f.planning, f.context]), before)
  })
})
