import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceMovement, BalanceSnapshot } from '../accounting/types.js'

type Addition = Extract<BalanceMovement, { kind: 'addition' }>
type Contribution = AnnualCostProjection['contributions'][number]
export type CostLinkSuggestion =
  { available: false; reason: string } | { available: true; amountJpy: number; cost: Contribution }

const safeYen = (value: number) => Number.isSafeInteger(value) && value >= 0
const sameLink = (link: { costYear: number; contributionId: string }, year: number, id: string) =>
  link.costYear === year && link.contributionId === id

/**
 * Prefill only, not a write or a tax decision. Count claims across the entire
 * draft (including later years); a transfer consumes a balance, not the cost
 * a second time. Existing adoption/provenance checks remain authoritative.
 */
export function suggestCostLink(
  snapshot: BalanceSnapshot,
  movement: Addition,
  projection: AnnualCostProjection,
  contributionId: string,
): CostLinkSuggestion {
  const blocked = (reason: string): CostLinkSuggestion => ({ available: false, reason })
  const year = Number(movement.occurredOn.slice(0, 4))
  const date = new Date(movement.occurredOn + 'T00:00:00Z')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(movement.occurredOn) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== movement.occurredOn ||
    year < 1900 ||
    year > 9999 ||
    !Number.isInteger(projection.year) ||
    projection.year < 1900 ||
    projection.year > year
  )
    return blocked('増加日と費用の対象年を確認してください。将来の費用は取り込みません。')
  if (!projection.invariantSatisfied) return blocked('費用資料の整合を確認できません。')
  const accounts = snapshot.accounts.filter((row) => row.id === movement.accountId)
  if (accounts.length !== 1 || accounts[0]!.openingYear > year)
    return blocked('増加先の残高と記録開始年を選んでください。')
  if (snapshot.movements.filter((row) => row.id === movement.id).length !== 1)
    return blocked('編集中の増加記録を一意に確認できません。')
  const matching = projection.contributions.filter((row) => row.id === contributionId)
  if (matching.length !== 1) return blocked('対応する費用配分を一意に確認できません。')
  const cost = matching[0]!
  if (cost.consumedByBasisId)
    return blocked('別の費用基礎へ組入れ済みです。最終配分を選んでください。')
  if (cost.target.kind !== 'tax-unit' || cost.target.taxUnitId !== accounts[0]!.taxUnitId)
    return blocked('同じ制作物への配分だけを取り込めます。私用・未配分等は対象外です。')
  const bases = projection.bases.filter((row) => row.id === cost.basisId)
  if (bases.length !== 1 || bases[0]!.amount.status !== 'known')
    return blocked('費用基礎が未算定、または対応先が不明です。')
  if (bases[0]!.period.endedOn > movement.occurredOn)
    return blocked('増加日より後までの費用を含みます。対象期間と増加日を確認してください。')
  if (
    !safeYen(cost.amountJpy) ||
    !cost.sourceIds.length ||
    new Set(cost.sourceIds).size !== cost.sourceIds.length ||
    cost.sourceIds.some((id) => projection.sources.filter((row) => row.id === id).length !== 1)
  )
    return blocked('費用配分の金額または原額の参照を確認できません。')
  if ((movement.costAllocations ?? []).some((link) => sameLink(link, projection.year, cost.id)))
    return blocked('この配分は追加済みです。既存の対応額を確認してください。')

  let claimed = 0n
  const movementIds = new Set<string>()
  for (const existing of snapshot.movements) {
    if (movementIds.has(existing.id))
      return blocked('増減IDが重複しているため残額を算定できません。')
    movementIds.add(existing.id)
    if (existing.id === movement.id || existing.kind !== 'addition') continue
    const links = existing.costAllocations ?? []
    const matches = links.filter((link) => sameLink(link, projection.year, cost.id))
    if (matches.length > 1 || matches.some((link) => !safeYen(link.amountJpy)))
      return blocked('同じ配分の既存対応に重複または未入力額があります。')
    for (const link of matches) claimed += BigInt(link.amountJpy)
    // A historical unlinked addition could already contain this source. Do not
    // silently assume it consumed zero just because its detailed links are absent.
    if (existing.sourceIds.some((id) => cost.sourceIds.includes(id))) {
      if (!safeYen(existing.amountJpy) || links.some((link) => !safeYen(link.amountJpy)))
        return blocked('同じ原額を参照する既存増加の金額を確認してください。')
      const linked = links.reduce((sum, link) => sum + BigInt(link.amountJpy), 0n)
      if (linked !== BigInt(existing.amountJpy))
        return blocked(
          '同じ原額を参照する既存増加に未対応額があります。先に内訳を確認してください。',
        )
    }
  }
  const remaining = BigInt(cost.amountJpy) - claimed
  if (remaining < 0n) return blocked('既存の対応額が費用配分額を超えています。自動補完しません。')
  if (remaining === 0n) return blocked('この費用配分の未使用額はありません。')
  return { available: true, amountJpy: Number(remaining), cost }
}

/** User explicitly chooses to replace the addition amount with the linked sum. */
export function applyCostLinkSuggestion(
  snapshot: BalanceSnapshot,
  movement: Addition,
  projection: AnnualCostProjection,
  contributionId: string,
): Addition {
  const suggestion = suggestCostLink(snapshot, movement, projection, contributionId)
  if (!suggestion.available) throw new Error(suggestion.reason)
  const existing = movement.costAllocations ?? []
  const ids = new Set<string>()
  for (const link of existing) {
    const id = JSON.stringify([link.costYear, link.contributionId])
    if (ids.has(id) || !safeYen(link.amountJpy))
      throw new Error('編集中の金額対応に重複または未入力額があります。入力は保持しています。')
    ids.add(id)
  }
  const costAllocations = [
    ...existing.map((link) => ({ ...link })),
    { costYear: projection.year, contributionId, amountJpy: suggestion.amountJpy },
  ]
  const total = costAllocations.reduce((sum, link) => sum + BigInt(link.amountJpy), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('合計が扱える整数円を超えています。')
  return {
    ...movement,
    amountJpy: Number(total),
    costAllocations,
    sourceIds: [...new Set([...movement.sourceIds, ...suggestion.cost.sourceIds])],
  }
}
