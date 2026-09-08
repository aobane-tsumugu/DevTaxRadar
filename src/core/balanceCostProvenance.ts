import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import { validateBalanceSnapshot } from './annualBalances.js'

export type BalanceCostProvenance = {
  engineVersion: 'balance-cost-provenance/1'
  year: number
  status: 'consistent' | 'incomplete' | 'invalid'
  issues: Array<{ movementId: string; contributionId?: string; message: string }>
  additions: Array<{
    movementId: string
    amountJpy: number
    linkedJpy: number
    unlinkedJpy: number
  }>
  contributions: Array<{
    costYear: number
    contributionId: string
    availableJpy: number
    claimedJpy: number | null
    remainingJpy: number | null
    movementIds: string[]
  }>
  /** Initial balances and later expense/transfer tracing are separate responsibilities. */
  scope: 'addition-cost-links-only'
}

/** Read all claims through the review year; a later transfer never consumes a cost again. */
export function checkBalanceCostProvenance(
  snapshot: BalanceSnapshot,
  costs: AnnualCostProjection[],
  year: number,
): BalanceCostProvenance {
  validateBalanceSnapshot(snapshot)
  const key = (costYear: number, id: string) => JSON.stringify([costYear, id])
  const accounts = new Map(snapshot.accounts.map((row) => [row.id, row]))
  const available = new Map<
    string,
    {
      cost: AnnualCostProjection['contributions'][number]
      row: BalanceCostProvenance['contributions'][number]
    }
  >()
  for (const projection of costs) {
    if (projection.year > year) continue
    for (const cost of projection.contributions) {
      const id = key(projection.year, cost.id)
      if (available.has(id)) throw new Error('費用配分の年とIDが重複しています。')
      available.set(id, {
        cost,
        row: {
          costYear: projection.year,
          contributionId: cost.id,
          availableJpy: cost.amountJpy,
          claimedJpy: 0,
          remainingJpy: cost.amountJpy,
          movementIds: [],
        },
      })
    }
  }
  const issues: BalanceCostProvenance['issues'] = []
  const additions: BalanceCostProvenance['additions'] = []
  for (const movement of snapshot.movements) {
    const movementYear = Number(movement.occurredOn.slice(0, 4))
    if (movement.kind !== 'addition' || movementYear > year) continue
    let linkedJpy = 0
    for (const allocation of movement.costAllocations ?? []) {
      const entry = available.get(key(allocation.costYear, allocation.contributionId))
      const issue = (message: string) =>
        issues.push({ movementId: movement.id, contributionId: allocation.contributionId, message })
      if (!entry) {
        issue('対応する年度の費用配分がありません。未算定や削除・変更を確認してください。')
        continue
      }
      const claimed =
        entry.row.claimedJpy === null ? NaN : entry.row.claimedJpy + allocation.amountJpy
      entry.row.claimedJpy = Number.isSafeInteger(claimed) ? claimed : null
      entry.row.movementIds.push(movement.id)
      if (entry.row.claimedJpy === null)
        issue('費用への対応額の合計が安全な整数円の範囲を超えています。')
      if (allocation.costYear > movementYear) {
        issue('増加年より後の費用配分は対応付けできません。')
        continue
      }
      if (entry.cost.consumedByBasisId) {
        issue('別の費用基礎へ組み入れ済みです。最終配分を指定してください。')
        continue
      }
      if (
        entry.cost.target.kind !== 'tax-unit' ||
        entry.cost.target.taxUnitId !== accounts.get(movement.accountId)?.taxUnitId
      ) {
        issue('費用配分と残高の制作物が一致しません。私用・未配分等は組み入れられません。')
        continue
      }
      if (!entry.cost.sourceIds.every((id) => movement.sourceIds.includes(id))) {
        issue('費用配分の元となる原額の参照が、増加の根拠にそろっていません。')
        continue
      }
      linkedJpy += allocation.amountJpy
    }
    additions.push({
      movementId: movement.id,
      amountJpy: movement.amountJpy,
      linkedJpy,
      unlinkedJpy: movement.amountJpy - linkedJpy,
    })
  }
  for (const { row, cost } of available.values()) {
    if (row.claimedJpy === null || row.claimedJpy > cost.amountJpy) {
      row.remainingJpy = null
      for (const movementId of row.movementIds)
        issues.push({
          movementId,
          contributionId: row.contributionId,
          message:
            '同じ費用配分への対応額が配分額を超えています。複数年・複数残高への二重計上を確認してください。',
        })
    } else row.remainingJpy = cost.amountJpy - row.claimedJpy
  }
  return {
    engineVersion: 'balance-cost-provenance/1',
    year,
    scope: 'addition-cost-links-only',
    status: issues.length
      ? 'invalid'
      : additions.some((row) => row.unlinkedJpy > 0)
        ? 'incomplete'
        : 'consistent',
    issues,
    additions,
    contributions: [...available.values()]
      .filter(
        ({ cost, row }) =>
          row.movementIds.length || (!cost.consumedByBasisId && cost.target.kind === 'tax-unit'),
      )
      .map(({ row }) => row),
  }
}
