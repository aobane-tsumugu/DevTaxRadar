import { describe, expect, it } from 'vitest'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { mergeBalanceDrafts } from '../../src/core/balanceMerge.js'
const fixture = (): BalanceSnapshot => ({
  version: 1,
  accounts: [
    {
      id: 'a',
      name: '制作物',
      taxUnitId: 'u',
      kind: 'asset',
      openingYear: 2026,
      opening: { status: 'unknown', amountJpy: null, reasons: ['資料待ち'] },
    },
  ],
  movements: [
    {
      id: 'm',
      kind: 'transfer',
      fromAccountId: 'a',
      toAccountId: 'b',
      occurredOn: '2026-01-01',
      amountJpy: 10,
      reason: '完成分',
      sourceIds: ['x', 'y'],
      decisionId: 'd',
    },
  ],
  pendingDecisions: [],
})
describe('balance draft comparison', () => {
  it('retains independent records and identical edits while preserving unknown and ignoring reference order', () => {
    const base = fixture(),
      local = fixture(),
      latest = fixture()
    local.accounts[0]!.name = '自分の変更'
    latest.movements[0]!.reason = '相手の変更'
    latest.movements[0]!.sourceIds.reverse()
    const result = mergeBalanceDrafts(base, local, latest)
    expect(result.changes.every((c) => !c.conflict)).toBe(true)
    expect(result.snapshot?.accounts[0]!.opening).toEqual(base.accounts[0]!.opening)
    expect(result.snapshot?.accounts[0]!.name).toBe('自分の変更')
    expect(result.snapshot?.movements[0]!.reason).toBe('相手の変更')
    latest.accounts[0]!.name = local.accounts[0]!.name
    expect(mergeBalanceDrafts(base, local, latest).snapshot).not.toBeNull()
    expect(base).toEqual(fixture())
  })
  it('requires whole-record choices for transfer changes and deletion versus update', () => {
    const base = fixture(),
      local = fixture(),
      latest = fixture()
    local.movements[0]!.amountJpy = 20
    latest.movements[0] = {
      ...latest.movements[0]!,
      kind: 'transfer',
      fromAccountId: 'a',
      toAccountId: 'c',
    }
    local.accounts = []
    latest.accounts[0]!.opening = { status: 'known', amountJpy: 0 }
    const unresolved = mergeBalanceDrafts(base, local, latest)
    expect(unresolved.snapshot).toBeNull()
    expect(unresolved.changes.filter((c) => c.conflict)).toHaveLength(2)
    const choices = Object.fromEntries(unresolved.changes.map((c) => [c.key, 'local' as const]))
    const chosen = mergeBalanceDrafts(base, local, latest, choices).snapshot!
    expect(chosen.accounts).toEqual([])
    expect(chosen.movements).toEqual(local.movements)
    chosen.movements[0]!.reason = '結果の編集'
    expect(local.movements[0]!.reason).toBe('完成分')
  })
  it('keeps conflicting resolutions intact and rejects duplicate IDs', () => {
    const base = fixture(),
      local = fixture(),
      latest = fixture()
    const p = {
      id: 'p',
      taxUnitId: 'u',
      taxYear: 2026,
      amount: { status: 'known' as const, amountJpy: 0 },
      accountIds: [],
      sourceIds: ['x'],
      reasons: ['相談待ち'],
    }
    local.pendingDecisions = [
      { ...p, resolution: { taxYear: 2027, decisionId: 'd1', reason: '自分の判断' } },
    ]
    latest.pendingDecisions = [
      { ...p, resolution: { taxYear: 2028, decisionId: 'd2', reason: '別の判断' } },
    ]
    const result = mergeBalanceDrafts(base, local, latest)
    expect(result.snapshot).toBeNull()
    expect(
      mergeBalanceDrafts(base, local, latest, { [result.changes[0]!.key]: 'latest' }).snapshot
        ?.pendingDecisions,
    ).toEqual(latest.pendingDecisions)
    local.accounts.push(local.accounts[0]!)
    expect(() => mergeBalanceDrafts(base, local, latest)).toThrow('重複')
  })
})
