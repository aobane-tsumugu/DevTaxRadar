import type { BalanceSnapshot } from '../accounting/types.js'

export type BalanceMergeChoice = 'local' | 'latest'
export type BalanceMergeChange = {
  key: string
  label: string
  base: unknown
  local: unknown
  latest: unknown
  conflict: boolean
  choice?: BalanceMergeChoice
}
function canonical(value: unknown, field = ''): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) {
    const values = value.map((v) => canonical(v))
    if (field === 'sourceIds' || field === 'accountIds') values.sort()
    return '[' + values.join(',') + ']'
  }
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v, k))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}
/** Whole-record choices preserve amount, reason, transfer sides and resolution together. */
export function mergeBalanceDrafts(
  base: BalanceSnapshot,
  local: BalanceSnapshot,
  latest: BalanceSnapshot,
  choices: Record<string, BalanceMergeChoice> = {},
) {
  const result: BalanceSnapshot = { version: 1, accounts: [], movements: [], pendingDecisions: [] }
  const changes: BalanceMergeChange[] = []
  const labels = { accounts: '残高', movements: '増減・振替', pendingDecisions: '未判断' }
  let unresolved = false
  for (const group of ['accounts', 'movements', 'pendingDecisions'] as const) {
    type RecordValue = BalanceSnapshot[typeof group][number]
    const index = (rows: RecordValue[]) => {
      const values = new Map<string, RecordValue>()
      for (const row of rows) {
        if (values.has(row.id)) throw new Error('同じIDの記録が重複しているため比較できません。')
        values.set(row.id, row)
      }
      return values
    }
    const old = index(base[group]),
      mine = index(local[group]),
      theirs = index(latest[group])
    const rows: RecordValue[] = []
    for (const id of new Set([...theirs.keys(), ...mine.keys(), ...old.keys()])) {
      const b = old.get(id),
        l = mine.get(id),
        r = theirs.get(id)
      const bt = canonical(b),
        lt = canonical(l),
        rt = canonical(r)
      const key = JSON.stringify([group, id])
      const conflict = lt !== bt && rt !== bt && lt !== rt
      const automatic = lt === rt || lt === bt ? 'latest' : rt === bt ? 'local' : undefined
      const choice = conflict ? choices[key] : automatic
      if (lt !== bt || rt !== bt) {
        const record = l ?? r ?? b!
        const title =
          'name' in record
            ? record.name
            : 'reason' in record
              ? record.reason
              : record.reasons.join(' / ')
        changes.push({
          key,
          label: labels[group] + '：' + (title || id),
          base: b,
          local: l,
          latest: r,
          conflict,
          choice,
        })
      }
      if (!choice) unresolved = true
      const selected = choice === 'local' ? l : r
      if (selected) rows.push(selected)
    }
    Object.assign(result, { [group]: rows })
  }
  return { changes, snapshot: unresolved ? null : structuredClone(result) }
}
