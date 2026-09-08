import type { BalanceReview } from '../accounting/balanceWorkspace.js'
import type {
  AnnualBalanceProjection,
  AmountState,
  BalanceCostAllocation,
} from '../accounting/types.js'
import { costLotLabel, describeCostLots } from './costLotLabel.js'

export type OpeningLotCarry = {
  engineVersion: 'opening-lot-carry/1'
  year: number
  previousReviewId: string | null
  status: 'consistent' | 'incomplete' | 'invalid' | 'not-linked'
  accounts: Array<{
    accountId: string
    name: string
    previousClosing: AmountState
    opening: AmountState
    lots: Array<BalanceCostAllocation & { label: string }>
    untracedJpy: number | null
  }>
  issues: string[]
}

/** Explain this year's opening from the previous frozen closing; never post a new addition. */
export function checkOpeningLotCarry(
  previous:
    | (Pick<BalanceReview, 'id' | 'year' | 'projection'> & {
        materials?: Pick<
          NonNullable<BalanceReview['materials']>,
          'costs' | 'costLinks' | 'balanceLotTrace'
        >
      })
    | null,
  current: AnnualBalanceProjection,
): OpeningLotCarry {
  const result: OpeningLotCarry = {
    engineVersion: 'opening-lot-carry/1',
    year: current.year,
    previousReviewId: previous?.id ?? null,
    status: previous ? 'consistent' : 'not-linked',
    accounts: [],
    issues: [],
  }
  if (!previous) return result
  if (previous.year !== current.year - 1)
    return { ...result, status: 'invalid', issues: ['直前年度の採用資料ではありません。'] }
  const trace = previous.materials?.balanceLotTrace
  const labels = describeCostLots(
    previous.materials ? (previous.materials.costLinks?.costs ?? [previous.materials.costs]) : [],
  )
  if (trace && (trace.year !== previous.year || trace.status === 'invalid'))
    return { ...result, status: 'invalid', issues: ['前年の原価追跡結果に不整合があります。'] }
  for (const old of previous.projection.accounts) {
    const now = current.accounts.find((row) => row.accountId === old.accountId)
    if (!now || now.taxUnitId !== old.taxUnitId || now.kind !== old.kind) {
      result.status = 'invalid'
      result.issues.push('前年の残高と当年の対象・種類を照合できません。残高ID ' + old.accountId)
      continue
    }
    const row: OpeningLotCarry['accounts'][number] = {
      accountId: old.accountId,
      name: old.name,
      previousClosing: structuredClone(old.closing),
      opening: structuredClone(now.opening),
      lots: [],
      untracedJpy: null,
    }
    result.accounts.push(row)
    if (old.closing.status !== 'known' || now.opening.status !== 'known') {
      if (result.status !== 'invalid') result.status = 'incomplete'
      continue
    }
    if (old.closing.amountJpy !== now.opening.amountJpy) {
      result.status = 'invalid'
      result.issues.push('前年期末と当年期首の額が一致しません。残高ID ' + old.accountId)
      continue
    }
    const sources = trace?.remaining.filter((source) => source.accountId === old.accountId) ?? []
    if (!trace || sources.some((source) => source.amountJpy === null)) {
      if (result.status !== 'invalid') result.status = 'incomplete'
      row.untracedJpy = old.closing.amountJpy
      continue
    }
    const total = sources.reduce((sum, source) => sum + BigInt(source.amountJpy!), 0n)
    if (total !== BigInt(old.closing.amountJpy)) {
      result.status = 'invalid'
      result.issues.push('前年の原価追跡残額と採用期末が一致しません。残高ID ' + old.accountId)
      continue
    }
    const lots = new Map<string, { lot: BalanceCostAllocation; amount: bigint }>()
    for (const source of sources)
      for (const lot of source.lots) {
        if (lot.remainingJpy === null || lot.remainingJpy === 0) continue
        const key = JSON.stringify([lot.costYear, lot.contributionId])
        lots.set(key, { lot, amount: (lots.get(key)?.amount ?? 0n) + BigInt(lot.remainingJpy) })
      }
    const traced = [...lots.values()].reduce((sum, entry) => sum + entry.amount, 0n)
    if (traced > total || [...lots.values()].some((entry) => entry.amount < 0n)) {
      result.status = 'invalid'
      result.issues.push('前年の原価内訳が残額の範囲を超えています。残高ID ' + old.accountId)
      continue
    }
    row.lots = [...lots.values()].map(({ lot, amount }) => ({
      costYear: lot.costYear,
      contributionId: lot.contributionId,
      amountJpy: Number(amount),
      label: costLotLabel(lot, labels),
    }))
    row.untracedJpy = Number(total - traced)
    if (row.untracedJpy > 0 && result.status !== 'invalid') result.status = 'incomplete'
  }
  for (const now of current.accounts) {
    if (previous.projection.accounts.some((old) => old.accountId === now.accountId)) continue
    if (now.opening.status === 'known' && now.opening.amountJpy === 0) continue
    result.accounts.push({
      accountId: now.accountId,
      name: now.name,
      previousClosing: {
        status: 'unknown',
        amountJpy: null,
        reasons: ['前年の採用資料にこの残高がありません。'],
      },
      opening: structuredClone(now.opening),
      lots: [],
      untracedJpy: now.opening.amountJpy,
    })
    if (result.status !== 'invalid') result.status = 'incomplete'
  }
  return result
}
