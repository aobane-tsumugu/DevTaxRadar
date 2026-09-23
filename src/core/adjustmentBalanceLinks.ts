import type { BalanceSnapshot } from '../accounting/types.js'
import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceLotTrace } from './balanceLotTrace.js'
import {
  evaluateSourceAdjustments,
  validateSourceAdjustments,
  type SourceAdjustmentRecord,
} from './sourceAdjustments.js'

export type AdjustmentBalanceLinkIssue = {
  recordId: string
  movementId: string
  message: string
}

/** Reuse the material's cost and lot calculations; never run a second projection. */
export type AdjustmentCostContext = {
  costs: readonly Pick<AnnualCostProjection, 'year' | 'sources' | 'contributions'>[]
  trace: Pick<BalanceLotTrace, 'year' | 'movements'>
}

/** Validate the selected reduction, not a guessed tax year or a second posting. */
export function adjustmentBalanceLinkIssues(
  records: readonly SourceAdjustmentRecord[],
  balances: BalanceSnapshot,
  context?: AdjustmentCostContext,
): AdjustmentBalanceLinkIssue[] {
  validateSourceAdjustments(records)
  const issues: AdjustmentBalanceLinkIssue[] = []
  const movements = new Map(balances.movements.map((row) => [row.id, row]))
  const claimants = new Map<string, string[]>()
  const traced = new Map(context?.trace.movements.map((row) => [row.movementId, row]))
  const costs = new Map(context?.costs.map((row) => [row.year, row]))
  for (const row of records) {
    if (row.effect !== 'balance-reduction') continue
    // A future refund must not prevent recording an earlier year's material.
    if (context && Number(row.occurredOn.slice(0, 4)) > context.trace.year) continue
    const movementId = row.balanceMovementId!
    const add = (message: string) => issues.push({ recordId: row.id, movementId, message })
    const claim = claimants.get(movementId) ?? []
    claim.push(row.id)
    claimants.set(movementId, claim)
    const movement = movements.get(movementId)
    if (!movement) {
      add('返金に対応する残高減少がありません。')
      continue
    }
    if (movement.kind !== 'reduction')
      add('返金は「その他減少」に対応させてください。費用化・増加・振替へ読み替えません。')
    if (movement.amountJpy !== -row.amountJpy)
      add('返金・訂正の減額と、対応する残高減少額が一致しません。')
    if (movement.occurredOn !== row.occurredOn)
      add('返金・訂正と残高減少の日付が一致しません。異なる年度の処理を自動で決めません。')
    if (!movement.sourceIds.includes(row.sourceId)) add('残高減少の根拠に元費用がありません。')
    if (!context || movement.kind !== 'reduction') continue

    const original = costs.get(row.sourceYear)?.sources.find((source) => source.id === row.sourceId)
    if (!original) {
      add('返金元の費用を参照年の資料で確認できません。参照年と元費用を確認してください。')
    } else if (
      evaluateSourceAdjustments(original, [row]).rows.some((item) => item.status === 'stale')
    ) {
      add('返金記録の原額・期間・契約が現在の元費用と異なります。確認内容を見直してください。')
    }

    const trace = traced.get(movementId)
    if (!trace || trace.untracedJpy !== 0 || trace.amountJpy !== movement.amountJpy) {
      add(
        '残高減少に使った原価の内訳が未確定です。根拠IDの記載だけでは返金元との一致を確認できません。',
      )
      continue
    }
    let matched = 0n
    let ambiguous = false
    let differentSource = false
    const seen = new Set<string>()
    for (const lot of trace.lots) {
      const key = JSON.stringify([lot.costYear, lot.contributionId])
      if (seen.has(key) || !Number.isSafeInteger(lot.amountJpy) || lot.amountJpy < 0) {
        ambiguous = true
        continue
      }
      seen.add(key)
      if (lot.amountJpy === 0) continue
      const contribution = costs
        .get(lot.costYear)
        ?.contributions.find((item) => item.id === lot.contributionId)
      if (!contribution || contribution.sourceIds.length !== 1) {
        // A multi-source lot has no source-by-source yen breakdown. Do not
        // infer that its full amount belongs to every listed source.
        ambiguous = true
      } else if (contribution.sourceIds[0] !== row.sourceId) {
        differentSource = true
      } else {
        matched += BigInt(lot.amountJpy)
      }
    }
    if (differentSource)
      add('残高減少に使った原価が返金元の費用と異なります。元費用名だけの付替えはできません。')
    if (ambiguous)
      add(
        '使用した原価を返金元の費用別金額まで特定できません。内訳を確認するか、返金の扱いを未判断で保持してください。',
      )
    if (!ambiguous && !differentSource && matched !== BigInt(movement.amountJpy))
      add('返金元に対応する原価の使用額と残高減少額が一致しません。')
  }
  for (const [movementId, ids] of claimants) {
    if (ids.length < 2) continue
    for (const recordId of ids)
      issues.push({
        recordId,
        movementId,
        message: '同じ残高減少を複数の返金・訂正へ重複して対応させることはできません。',
      })
  }
  return issues
}
