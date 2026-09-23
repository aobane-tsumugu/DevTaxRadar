import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import type { DecisionRecord, PlanningSnapshot } from '../planning/types.js'
import { MANUAL_DECISION_VERSION, decisionIsConfirmed } from './decisionConfirmation.js'
import { applyCostLinkSuggestion } from './balanceCostDraft.js'
import {
  treatmentDecisionBasis,
  treatmentDecisionBindingMatches,
} from './treatmentDecisionBinding.js'
import { validMethodDate } from './annualMethodComparison.js'

/** No persistence or confirmation: user reviews this through the existing DecisionEditor. */
export function draftTreatmentDecision(
  costs: AnnualCostProjection,
  planning: PlanningSnapshot,
  contributionId: string,
  id: string,
  createdAt: string,
): DecisionRecord {
  if (
    !id ||
    id.length > 120 ||
    planning.decisions.some((row) => row.id === id) ||
    !Number.isFinite(Date.parse(createdAt))
  )
    throw new Error('判断案のIDと記録日時を確認してください。')
  const { item, binding } = treatmentDecisionBasis(costs, planning, contributionId)
  if (
    planning.decisions.some(
      (row) =>
        row.treatmentBinding?.costYear === costs.year &&
        row.treatmentBinding.contributionId === contributionId,
    )
  )
    throw new Error(
      'この候補に対応する判断記録が既にあります。新しい判断を重ねず既存記録を見直してください。',
    )
  const reason = item.reasons.join('\n')
  if (reason.length > 2000)
    throw new Error(
      '理由が判断欄の上限を超えます。元の理由を整理してください。省略して取り込みません。',
    )
  return {
    id,
    taxUnitId: item.taxUnitId!,
    taxYear: costs.year,
    engineVersion: MANUAL_DECISION_VERSION,
    candidate: item.candidate,
    selectedCandidate: item.candidate,
    status: 'pending',
    reason,
    createdAt,
    treatmentBinding: binding,
  }
}

/** A draft addition uses the existing cost-link prefill; later transfer/expense is a separate stock use. */
export function draftTreatmentAddition(
  costs: AnnualCostProjection,
  planning: PlanningSnapshot,
  snapshot: BalanceSnapshot,
  input: {
    contributionId: string
    decisionId: string
    accountId: string
    occurredOn: string
    id: string
  },
): BalanceSnapshot {
  const { item } = treatmentDecisionBasis(costs, planning, input.contributionId)
  const decision = planning.decisions.find((row) => row.id === input.decisionId)
  if (
    !decision ||
    !decisionIsConfirmed(decision) ||
    !decision.treatmentBinding ||
    decision.treatmentBinding.contributionId !== input.contributionId ||
    decision.treatmentBinding.costYear !== costs.year ||
    !treatmentDecisionBindingMatches(decision, costs, planning)
  )
    throw new Error(
      'この候補元に対応する最新の判断を確認してください。未確認・変更後の判断では増加案を作りません。',
    )
  const expectedKind =
    item.candidate === 'prepaid-expense'
      ? 'prepaid'
      : ['software-acquisition-cost', 'production-cost'].includes(item.candidate)
        ? 'construction'
        : null
  if (!expectedKind || item.futureCostJpy !== item.amountJpy)
    throw new Error(
      '通常経費を架空の残高へ増減させません。資産供用・費用化は既存の残額使用操作で確認してください。',
    )
  const account = snapshot.accounts.find((row) => row.id === input.accountId)
  if (!account || account.kind !== expectedKind || account.taxUnitId !== item.taxUnitId)
    throw new Error('候補の制作物と残高の種類が一致しません。')
  if (
    !validMethodDate(input.occurredOn) ||
    !input.occurredOn.startsWith(costs.year + '-') ||
    !input.id ||
    input.id.length > 120 ||
    snapshot.movements.some((row) => row.id === input.id)
  )
    throw new Error('増加日と新しい記録IDを確認してください。')
  const addition = {
    id: input.id,
    occurredOn: input.occurredOn,
    kind: 'addition' as const,
    accountId: input.accountId,
    amountJpy: 0,
    sourceIds: [...item.sourceIds],
    decisionId: decision.id,
    reason: '確認した処理候補から、未使用の原価だけを増加案へ取り込み。',
  }
  const next: BalanceSnapshot = structuredClone(snapshot)
  next.movements.push(addition)
  const linked = applyCostLinkSuggestion(next, addition, costs, item.contributionId)
  next.movements[next.movements.length - 1] = linked
  // This returns an editor draft. Existing API/schema/provenance/adoption checks still run at save/adopt.
  return next
}

/** Refresh explicitly, never preserve a confirmation for changed source facts. */
export function refreshTreatmentDecision(
  costs: AnnualCostProjection,
  planning: PlanningSnapshot,
  contributionId: string,
  id: string,
): DecisionRecord {
  const current = planning.decisions.find((row) => row.id === id)
  if (
    !current?.treatmentBinding ||
    current.treatmentBinding.costYear !== costs.year ||
    current.treatmentBinding.contributionId !== contributionId
  )
    throw new Error('同じ候補に対応する判断だけを更新できます。')
  const { item, binding } = treatmentDecisionBasis(costs, planning, contributionId)
  const reason = item.reasons.join('\n')
  if (reason.length > 2000) throw new Error('理由が判断欄の上限を超えています。')
  return {
    ...current,
    taxYear: costs.year,
    taxUnitId: item.taxUnitId!,
    engineVersion: MANUAL_DECISION_VERSION,
    status: 'pending',
    confirmedAt: undefined,
    candidate: item.candidate,
    selectedCandidate: item.candidate,
    reason,
    treatmentBinding: binding,
  }
}
