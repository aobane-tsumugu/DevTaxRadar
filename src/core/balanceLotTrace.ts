import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceSnapshot, BalanceCostAllocation } from '../accounting/types.js'
import { checkBalanceCostProvenance } from './balanceCostProvenance.js'
import { checkBalanceFlowLinks } from './balanceFlowLinks.js'

export type BalanceLotTrace = {
  engineVersion: 'balance-lot-trace/1' | 'balance-lot-trace/2'
  year: number
  scope: 'uniquely-determined-cost-lots' | 'explicit-and-unique-cost-lots'
  status: 'consistent' | 'incomplete' | 'invalid'
  movements: Array<{
    movementId: string
    amountJpy: number
    lots: BalanceCostAllocation[]
    untracedJpy: number
  }>
  remaining: Array<{
    sourceKind: 'opening' | 'movement'
    sourceId: string
    accountId: string
    amountJpy: number | null
    lots: Array<BalanceCostAllocation & { remainingJpy: number | null }>
    untracedJpy: number | null
  }>
  issues: Array<{ movementId: string; message: string }>
}

/** Follow only mathematically determined compositions. Never choose FIFO or proportional lots. */
export function traceBalanceLots(
  snapshot: BalanceSnapshot,
  costs: AnnualCostProjection[],
  year: number,
): BalanceLotTrace {
  const flow = checkBalanceFlowLinks(snapshot, year)
  const costCheck = checkBalanceCostProvenance(snapshot, costs, year)
  const result: BalanceLotTrace = {
    engineVersion: 'balance-lot-trace/2',
    year,
    scope: 'explicit-and-unique-cost-lots',
    status: 'consistent',
    movements: [],
    remaining: [],
    issues: [],
  }
  if (flow.status === 'invalid' || costCheck.status === 'invalid') {
    result.status = 'invalid'
    result.issues = [...flow.issues, ...costCheck.issues]
    return result
  }
  const key = (kind: string | number, id: string) => JSON.stringify([kind, id])
  type Pool = {
    amount: number | null
    lots: BalanceCostAllocation[]
    used: Map<string, number>
    ambiguous: boolean
  }
  const pools = new Map<string, Pool>()
  for (const source of flow.sources)
    if (source.sourceKind === 'opening')
      pools.set(key('opening', source.sourceId), {
        amount: source.amountJpy,
        lots: [],
        used: new Map(),
        ambiguous: false,
      })
  const movements = snapshot.movements.filter((m) => Number(m.occurredOn.slice(0, 4)) <= year)
  const byId = new Map(movements.map((m) => [m.id, m]))
  const incoming = new Map(movements.map((m) => [m.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const m of movements)
    for (const link of m.balanceAllocations ?? [])
      if (link.sourceKind === 'movement') {
        incoming.set(m.id, incoming.get(m.id)! + 1)
        const edges = outgoing.get(link.sourceId) ?? []
        edges.push(m.id)
        outgoing.set(link.sourceId, edges)
      }
  const queue = movements.filter((m) => incoming.get(m.id) === 0).map((m) => m.id)
  for (let i = 0; i < queue.length; i++) {
    const m = byId.get(queue[i]!)!
    const gathered = new Map<string, BalanceCostAllocation>()
    const add = (lot: BalanceCostAllocation) => {
      if (lot.amountJpy === 0) return
      const id = key(lot.costYear, lot.contributionId)
      const previous = gathered.get(id)
      gathered.set(id, { ...lot, amountJpy: (previous?.amountJpy ?? 0) + lot.amountJpy })
    }
    if (m.kind === 'addition') {
      for (const lot of m.costAllocations ?? []) add(lot)
    } else {
      for (const link of m.balanceAllocations ?? []) {
        if (link.amountJpy === 0 && link.costAllocations === undefined) continue
        const pool = pools.get(key(link.sourceKind, link.sourceId))!
        let selected: BalanceCostAllocation[] = []
        if (link.costAllocations !== undefined) {
          for (const lot of link.costAllocations) {
            if (
              !pool.lots.some(
                (candidate) =>
                  candidate.costYear === lot.costYear &&
                  candidate.contributionId === lot.contributionId,
              )
            ) {
              result.status = 'invalid'
              result.issues.push({
                movementId: m.id,
                message:
                  '対応元に確認できない原価を指定しています。費用年・配分ID・上流の内訳を確認してください。',
              })
            } else selected.push(lot)
          }
          if (
            selected.reduce((sum, lot) => sum + lot.amountJpy, 0) < link.amountJpy &&
            pool.lots.length
          )
            pool.ambiguous = true
        } else if (link.amountJpy === pool.amount) selected = pool.lots
        else if (pool.lots.length === 1 && pool.lots[0]!.amountJpy === pool.amount)
          selected = [{ ...pool.lots[0]!, amountJpy: link.amountJpy }]
        else if (pool.lots.length) {
          pool.ambiguous = true
          result.issues.push({
            movementId: m.id,
            message:
              '複数原価または原価未確認分を含む対応元の一部使用です。消費する原価内訳が未確定です。',
          })
        }
        for (const lot of selected) {
          add(lot)
          const id = key(lot.costYear, lot.contributionId)
          pool.used.set(id, (pool.used.get(id) ?? 0) + lot.amountJpy)
          const original = pool.lots.find(
            (candidate) =>
              candidate.costYear === lot.costYear &&
              candidate.contributionId === lot.contributionId,
          )!
          if (pool.used.get(id)! > original.amountJpy) {
            result.status = 'invalid'
            result.issues.push({
              movementId: m.id,
              message:
                '同じ対応元の原価への使用合計が原価額を超えています。重複使用を確認してください。',
            })
          }
        }
      }
    }
    const lots = [...gathered.values()].sort(
      (a, b) =>
        a.costYear - b.costYear ||
        (a.contributionId < b.contributionId ? -1 : a.contributionId > b.contributionId ? 1 : 0),
    )
    const untracedJpy = m.amountJpy - lots.reduce((sum, lot) => sum + lot.amountJpy, 0)
    result.movements.push({ movementId: m.id, amountJpy: m.amountJpy, lots, untracedJpy })
    if (m.kind === 'addition' || m.kind === 'transfer')
      pools.set(key('movement', m.id), {
        amount: m.amountJpy,
        lots,
        used: new Map(),
        ambiguous: false,
      })
    for (const target of outgoing.get(m.id) ?? []) {
      incoming.set(target, incoming.get(target)! - 1)
      if (incoming.get(target) === 0) queue.push(target)
    }
  }
  if (result.status === 'invalid') {
    result.movements = []
    return result
  }
  for (const source of flow.sources) {
    const pool = pools.get(key(source.sourceKind, source.sourceId))!
    const lots = pool.lots.map((lot) => ({
      ...lot,
      remainingJpy:
        source.remainingJpy === 0
          ? 0
          : pool.ambiguous
            ? null
            : lot.amountJpy - (pool.used.get(key(lot.costYear, lot.contributionId)) ?? 0),
    }))
    result.remaining.push({
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      accountId: source.accountId,
      amountJpy: source.remainingJpy,
      lots,
      untracedJpy:
        source.remainingJpy === 0
          ? 0
          : pool.ambiguous || source.remainingJpy === null
            ? null
            : source.remainingJpy - lots.reduce((sum, lot) => sum + lot.remainingJpy!, 0),
    })
  }
  result.movements.sort((a, b) =>
    a.movementId < b.movementId ? -1 : a.movementId > b.movementId ? 1 : 0,
  )
  result.status =
    result.movements.some((row) => row.untracedJpy > 0) ||
    result.remaining.some((row) => row.untracedJpy === null || row.untracedJpy > 0)
      ? 'incomplete'
      : 'consistent'
  return result
}
