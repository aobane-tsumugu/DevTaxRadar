import type {
  ConsultationAnswer,
  PendingBalanceDecision,
  PendingQuestionBasis,
} from '../accounting/types.js'

function ordered(answers: ConsultationAnswer[]): ConsultationAnswer[] {
  return answers
    .map((a) => ({
      id: a.id,
      taxYear: a.taxYear,
      receivedOn: a.receivedOn,
      kind: a.kind,
      answer: a.answer,
      source: a.source,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function consultationAnswersForYear(
  pending: PendingBalanceDecision,
  year: number,
): ConsultationAnswer[] {
  return ordered((pending.answers ?? []).filter((answer) => answer.taxYear <= year))
}

function normalizeQuestion(basis: PendingQuestionBasis): PendingQuestionBasis {
  return {
    pendingId: basis.pendingId,
    taxUnitId: basis.taxUnitId,
    taxYear: basis.taxYear,
    amount:
      basis.amount.status === 'known'
        ? { status: 'known', amountJpy: basis.amount.amountJpy }
        : { status: 'unknown', amountJpy: null, reasons: [...basis.amount.reasons] },
    accountIds: [...basis.accountIds].sort(),
    reasons: [...basis.reasons],
    sourceIds: [...basis.sourceIds].sort(),
    resolutionYear: basis.resolutionYear,
    decisionId: basis.decisionId,
    resolutionReason: basis.resolutionReason,
  }
}

export function consultationQuestionBasis(pending: PendingBalanceDecision): PendingQuestionBasis {
  if (!pending.resolution) throw new Error('解消の判断を選んでください。')
  return normalizeQuestion({
    ...pending,
    pendingId: pending.id,
    resolutionYear: pending.resolution.taxYear,
    decisionId: pending.resolution.decisionId,
    resolutionReason: pending.resolution.reason,
  })
}

/** Bind resolution to both its question and answers; future-year answers are independent. */
export function consultationResolutionMatches(
  pending: PendingBalanceDecision,
  requireQuestionBasis = false,
): boolean {
  if (!pending.resolution) return false
  if (pending.resolution.questionBasis) {
    if (
      JSON.stringify(normalizeQuestion(pending.resolution.questionBasis)) !==
      JSON.stringify(consultationQuestionBasis(pending))
    )
      return false
  } else if (
    requireQuestionBasis &&
    (pending.answers?.length || pending.resolution.answerBasis?.length)
  )
    return false
  return (
    JSON.stringify(ordered(pending.resolution.answerBasis ?? [])) ===
    JSON.stringify(consultationAnswersForYear(pending, pending.resolution.taxYear))
  )
}
