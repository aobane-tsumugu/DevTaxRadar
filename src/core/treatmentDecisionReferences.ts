import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import type { BalanceReferenceCheck } from './balanceReferences.js'
import {
  treatmentDecisionBasis,
  treatmentDecisionBindingMatches,
} from './treatmentDecisionBinding.js'

/** Augment the existing year-scoped adoption check using the same captured cost projections. */
export function checkTreatmentDecisionReferences(
  balances: BalanceSnapshot,
  planning: PlanningSnapshot,
  costs: readonly AnnualCostProjection[],
  year: number,
  previous: BalanceReferenceCheck,
): BalanceReferenceCheck {
  const issues = [...previous.issues]
  const decisions = new Map(planning.decisions.map((row) => [row.id, row]))
  for (const movement of balances.movements) {
    if (Number(movement.occurredOn.slice(0, 4)) > year) continue
    const decision = decisions.get(movement.decisionId)
    if (!decision?.treatmentBinding) continue
    const input = costs.find((row) => row.year === decision.treatmentBinding!.costYear)
    let valid = Boolean(input && treatmentDecisionBindingMatches(decision, input, planning))
    if (valid && input) {
      const { item } = treatmentDecisionBasis(
        input,
        planning,
        decision.treatmentBinding.contributionId,
      )
      const expected =
        item.candidate === 'prepaid-expense'
          ? 'prepaid'
          : ['software-acquisition-cost', 'production-cost'].includes(item.candidate)
            ? 'construction'
            : null
      const account =
        movement.kind === 'addition'
          ? balances.accounts.find((row) => row.id === movement.accountId)
          : undefined
      const links = movement.kind === 'addition' ? (movement.costAllocations ?? []) : []
      valid = Boolean(
        expected &&
        account?.kind === expected &&
        account.taxUnitId === item.taxUnitId &&
        movement.kind === 'addition' &&
        links.length === 1 &&
        links[0]!.costYear === input.year &&
        links[0]!.contributionId === item.contributionId &&
        links[0]!.amountJpy === movement.amountJpy &&
        movement.amountJpy > 0 &&
        movement.amountJpy <= item.amountJpy &&
        input.year === Number(movement.occurredOn.slice(0, 4)),
      )
    }
    if (!valid)
      issues.push({
        recordType: 'movement',
        recordId: movement.id,
        referenceId: decision.id,
        code: 'unconfirmed-decision',
        message:
          '判断の候補元・処理条件・費用原価または増加先が現在と一致しません。候補元を更新して判断を再確認してください。',
      })
  }
  for (const pending of balances.pendingDecisions) {
    if (!pending.resolution || pending.resolution.taxYear > year) continue
    const decision = decisions.get(pending.resolution.decisionId)
    if (!decision?.treatmentBinding) continue
    const input = costs.find((row) => row.year === decision.treatmentBinding!.costYear)
    if (!input || !treatmentDecisionBindingMatches(decision, input, planning))
      issues.push({
        recordType: 'pending',
        recordId: pending.id,
        referenceId: decision.id,
        code: 'changed-answer',
        message:
          '解消に用いた判断の候補元が変わっています。問いと回答・対象額を再確認してください。',
      })
  }
  return { ...previous, issues, status: issues.length ? 'needs-review' : 'consistent' }
}
