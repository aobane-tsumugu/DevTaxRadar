import type { BalanceSnapshot, BalanceFlowAllocation } from '../accounting/types.js'
import { validateBalanceSnapshot } from './annualBalances.js'

type Source = Pick<BalanceFlowAllocation, 'sourceKind' | 'sourceId'> & {
  accountId: string
  availableOn: string
  amountJpy: number | null
  claimedJpy: number | null
  remainingJpy: number | null
}
export type BalanceFlowCheck = {
  engineVersion: 'balance-flow-links/1'
  year: number
  scope: 'recorded-balance-flows'
  status: 'consistent' | 'incomplete' | 'invalid'
  sources: Source[]
  uses: { movementId: string; amountJpy: number; linkedJpy: number; unlinkedJpy: number }[]
  issues: { movementId: string; message: string }[]
}

/** Verify explicit edges. Does not choose a cost lot or infer the provenance of an opening. */
export function checkBalanceFlowLinks(snapshot: BalanceSnapshot, year: number): BalanceFlowCheck {
  validateBalanceSnapshot(snapshot)
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error('対象年が不正です。')
  const key = (kind: string, id: string) => JSON.stringify([kind, id])
  const sources = new Map<string, Source>()
  const movements = snapshot.movements.filter((row) => Number(row.occurredOn.slice(0, 4)) <= year)
  for (const account of snapshot.accounts.filter((row) => row.openingYear <= year))
    sources.set(key('opening', account.id), {
      sourceKind: 'opening',
      sourceId: account.id,
      accountId: account.id,
      availableOn: account.openingYear + '-01-01',
      amountJpy: account.opening.amountJpy,
      claimedJpy: 0,
      remainingJpy: account.opening.amountJpy,
    })
  for (const m of movements)
    if (m.kind === 'addition' || m.kind === 'transfer')
      sources.set(key('movement', m.id), {
        sourceKind: 'movement',
        sourceId: m.id,
        accountId: m.kind === 'addition' ? m.accountId : m.toAccountId,
        availableOn: m.occurredOn,
        amountJpy: m.amountJpy,
        claimedJpy: 0,
        remainingJpy: m.amountJpy,
      })
  const issues: BalanceFlowCheck['issues'] = [],
    uses: BalanceFlowCheck['uses'] = []
  const claims = new Map<string, bigint>(),
    claimants = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>(),
    indegree = new Map(movements.map((m) => [m.id, 0]))
  for (const m of movements) {
    if (m.kind === 'addition') continue
    let linked = 0
    for (const link of m.balanceAllocations ?? []) {
      const id = key(link.sourceKind, link.sourceId),
        source = sources.get(id)
      const issue = (message: string) => issues.push({ movementId: m.id, message })
      if (!source) {
        issue('対応元の期首・増加・振替受入がありません。')
        continue
      }
      claims.set(id, (claims.get(id) ?? 0n) + BigInt(link.amountJpy))
      claimants.set(id, [...(claimants.get(id) ?? []), m.id])
      if (link.sourceKind === 'movement') {
        outgoing.set(link.sourceId, [...(outgoing.get(link.sourceId) ?? []), m.id])
        indegree.set(m.id, indegree.get(m.id)! + 1)
      }
      if (source.accountId !== (m.kind === 'transfer' ? m.fromAccountId : m.accountId)) {
        issue('対応元と払出元の残高が一致しません。')
        continue
      }
      if (source.availableOn > m.occurredOn) {
        issue('移動日より後の残高を使うことはできません。')
        continue
      }
      if (source.amountJpy === null) {
        issue('不明な期首の使用可能額は照合できません。')
        continue
      }
      linked += link.amountJpy
    }
    uses.push({
      movementId: m.id,
      amountJpy: m.amountJpy,
      linkedJpy: linked,
      unlinkedJpy: m.amountJpy - linked,
    })
  }
  for (const [id, source] of sources) {
    const claimed = claims.get(id) ?? 0n
    source.claimedJpy = claimed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(claimed) : null
    source.remainingJpy =
      source.amountJpy !== null && claimed <= BigInt(source.amountJpy)
        ? source.amountJpy - Number(claimed)
        : null
    if (source.amountJpy !== null && claimed > BigInt(source.amountJpy))
      for (const movementId of claimants.get(id) ?? [])
        issues.push({
          movementId,
          message: '同じ期首・増加・振替受入への対応額が元の額を超えています。',
        })
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id)
  for (let i = 0; i < queue.length; i++)
    for (const target of outgoing.get(queue[i]!) ?? []) {
      indegree.set(target, indegree.get(target)! - 1)
      if (indegree.get(target) === 0) queue.push(target)
    }
  for (const [movementId, degree] of indegree)
    if (degree > 0)
      issues.push({ movementId, message: '残高対応の循環または循環に依存する移動があります。' })
  return {
    engineVersion: 'balance-flow-links/1',
    year,
    scope: 'recorded-balance-flows',
    status: issues.length
      ? 'invalid'
      : uses.some((row) => row.unlinkedJpy > 0)
        ? 'incomplete'
        : 'consistent',
    sources: [...sources.values()],
    uses,
    issues,
  }
}
