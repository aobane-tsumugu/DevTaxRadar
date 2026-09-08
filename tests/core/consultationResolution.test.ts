import { expect, it } from 'vitest'
import type { PendingBalanceDecision } from '../../src/accounting/types.js'
import {
  consultationAnswersForYear,
  consultationQuestionBasis,
  consultationResolutionMatches,
} from '../../src/core/consultationResolution.js'
import { buildAnnualBalances, validateBalanceSnapshot } from '../../src/core/annualBalances.js'

function confirmed(): PendingBalanceDecision {
  const pending: PendingBalanceDecision = {
    id: 'q',
    taxUnitId: 'u',
    taxYear: 2026,
    amount: { status: 'known', amountJpy: 100 },
    accountIds: [],
    sourceIds: ['e', 'f'],
    reasons: ['用途の確認'],
    answers: [
      {
        id: 'a',
        taxYear: 2026,
        receivedOn: '2027-01-01',
        kind: 'fact',
        answer: '事実を確認',
        source: '本人',
      },
    ],
    resolution: { taxYear: 2026, decisionId: 'd', reason: '対応を確認' },
  }
  pending.resolution!.answerBasis = consultationAnswersForYear(pending, 2026)
  pending.resolution!.questionBasis = consultationQuestionBasis(pending)
  return pending
}

it.each([
  'question',
  'amount',
  'unknown',
  'unit',
  'year',
  'source',
  'account',
  'decision',
  'resolution-year',
  'reason',
  'identity',
])('requires review when the confirmed context changes: %s', (field) => {
  const pending = confirmed()
  expect(consultationResolutionMatches(pending)).toBe(true)
  const basis = structuredClone(pending.resolution!.questionBasis)
  switch (field) {
    case 'question':
      pending.reasons = ['別の問い']
      break
    case 'amount':
      pending.amount = { status: 'known', amountJpy: 200 }
      break
    case 'unknown':
      pending.amount = { status: 'unknown', amountJpy: null, reasons: ['確認待ち'] }
      break
    case 'unit':
      pending.taxUnitId = 'other'
      break
    case 'year':
      pending.taxYear = 2025
      break
    case 'source':
      pending.sourceIds = ['other']
      break
    case 'account':
      pending.accountIds = ['other']
      break
    case 'decision':
      pending.resolution!.decisionId = 'other'
      break
    case 'resolution-year':
      pending.resolution!.taxYear = 2027
      break
    case 'reason':
      pending.resolution!.reason = '別の採用理由'
      break
    case 'identity':
      pending.id = 'other'
      break
  }
  expect(consultationResolutionMatches(pending)).toBe(false)
  expect(pending.resolution!.questionBasis).toEqual(basis)
})

it('ignores reference ordering and future answers, preserves old no-answer records, and keeps changed amounts pending', () => {
  const pending = confirmed()
  pending.sourceIds.reverse()
  pending.answers!.push({
    ...pending.answers![0]!,
    id: 'future',
    taxYear: 2027,
    answer: '翌年だけの回答',
  })
  expect(consultationResolutionMatches(pending)).toBe(true)
  const snapshot = { version: 1 as const, accounts: [], movements: [], pendingDecisions: [pending] }
  expect(() => validateBalanceSnapshot(snapshot)).not.toThrow()
  expect(buildAnnualBalances(snapshot, 2026).pendingDecisions).toHaveLength(0)
  pending.amount = { status: 'known', amountJpy: 200 }
  expect(buildAnnualBalances(snapshot, 2026).pendingDecisions).toHaveLength(1)
  expect(buildAnnualBalances(snapshot, 2026).totals.knownClosingJpy).toBe(0)
  delete pending.resolution!.questionBasis
  expect(consultationResolutionMatches(pending)).toBe(true)
  expect(consultationResolutionMatches(pending, true)).toBe(false)
  delete pending.answers
  delete pending.resolution!.answerBasis
  expect(consultationResolutionMatches(pending)).toBe(true)
})
