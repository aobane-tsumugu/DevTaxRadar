import type { BalanceSnapshot } from '../accounting/types.js'
import { validateSourceAdjustments, type SourceAdjustmentRecord } from './sourceAdjustments.js'

export type AdjustmentBalanceLinkIssue = { recordId: string; movementId: string; message: string }

/** Validate the selected reduction, not a guessed tax year or an invented second posting. */
export function adjustmentBalanceLinkIssues(
  records: readonly SourceAdjustmentRecord[],
  balances: BalanceSnapshot,
): AdjustmentBalanceLinkIssue[] {
  validateSourceAdjustments(records)
  const issues: AdjustmentBalanceLinkIssue[] = []
  const movements = new Map(balances.movements.map((row) => [row.id, row]))
  const claimants = new Map<string, string[]>()
  for (const row of records) {
    if (row.effect !== 'balance-reduction') continue
    const movementId = row.balanceMovementId!
    const add = (message: string) => issues.push({ recordId: row.id, movementId, message })
    const claim = claimants.get(movementId) ?? []
    claim.push(row.id)
    claimants.set(movementId, claim)
    const movement = movements.get(movementId)
    if (!movement) { add('返金に対応する残高減少がありません。'); continue }
    if (movement.kind !== 'reduction') add('返金は「その他減少」に対応させてください。費用化・増加・振替へ読み替えません。')
    if (movement.amountJpy !== -row.amountJpy) add('返金・訂正の減額と、対応する残高減少額が一致しません。')
    if (movement.occurredOn !== row.occurredOn) add('返金・訂正と残高減少の日付が一致しません。異なる年度の処理を自動で決めません。')
    if (!movement.sourceIds.includes(row.sourceId)) add('残高減少の根拠に元費用がありません。')
  }
  for (const [movementId, ids] of claimants) {
    if (ids.length < 2) continue
    for (const recordId of ids) issues.push({ recordId, movementId, message: '同じ残高減少を複数の返金・訂正へ重複して対応させることはできません。' })
  }
  return issues
}
