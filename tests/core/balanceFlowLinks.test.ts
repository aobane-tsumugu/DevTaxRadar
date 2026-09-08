import { expect, it } from 'vitest'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { checkBalanceFlowLinks } from '../../src/core/balanceFlowLinks.js'
import { balanceSnapshotSchema } from '../../src/accounting/balanceSchema.js'
function fixture(): BalanceSnapshot {
  const base = {
    occurredOn: '2026-01-01',
    amountJpy: 100,
    sourceIds: ['e'],
    decisionId: 'd',
    reason: '合成',
  }
  return {
    version: 1,
    accounts: [
      {
        id: 'a',
        taxUnitId: 'u',
        name: '制作中',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 100 },
      },
      {
        id: 'b',
        taxUnitId: 'u',
        name: '資産',
        kind: 'asset',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    pendingDecisions: [],
    movements: [
      { ...base, id: 'add', kind: 'addition', accountId: 'a' },
      {
        ...base,
        id: 'transfer',
        kind: 'transfer',
        fromAccountId: 'a',
        toAccountId: 'b',
        balanceAllocations: [{ sourceKind: 'movement', sourceId: 'add', amountJpy: 100 }],
      },
      {
        ...base,
        id: 'expense',
        kind: 'expense',
        accountId: 'b',
        amountJpy: 40,
        balanceAllocations: [{ sourceKind: 'movement', sourceId: 'transfer', amountJpy: 40 }],
      },
    ],
  }
}
it('retains explicit source balances across transfer and expense without consuming the addition twice', () => {
  const s = fixture()
  expect(balanceSnapshotSchema.safeParse(s).success).toBe(true)
  const result = checkBalanceFlowLinks(s, 2026)
  expect(result.status).toBe('consistent')
  expect(result.sources.find((row) => row.sourceId === 'add')).toMatchObject({
    claimedJpy: 100,
    remainingJpy: 0,
  })
  expect(result.sources.find((row) => row.sourceId === 'transfer')).toMatchObject({
    claimedJpy: 40,
    remainingJpy: 60,
  })
  s.movements.reverse()
  expect(checkBalanceFlowLinks(s, 2026).sources).toEqual(expect.arrayContaining(result.sources))
  s.movements.find((row) => row.id === 'expense')!.balanceAllocations = []
  expect(checkBalanceFlowLinks(s, 2026).status).toBe('incomplete')
})
it('rejects double claims even when unlinked account money hides an overall overdraft', () => {
  const s = fixture()
  s.movements.push({
    ...s.movements[2]!,
    id: 'twice',
    kind: 'expense',
    accountId: 'a',
    amountJpy: 50,
    balanceAllocations: [{ sourceKind: 'movement', sourceId: 'add', amountJpy: 50 }],
  })
  expect(
    checkBalanceFlowLinks(s, 2026).issues.some((row) => row.message.includes('元の額を超え')),
  ).toBe(true)
})
it('rejects wrong accounts, future sources, unknown openings and same-day circular links', () => {
  const s = fixture()
  s.movements[2]!.balanceAllocations = [{ sourceKind: 'opening', sourceId: 'a', amountJpy: 40 }]
  expect(checkBalanceFlowLinks(s, 2026).status).toBe('invalid')
  s.movements[2]!.balanceAllocations = [
    { sourceKind: 'movement', sourceId: 'transfer', amountJpy: 40 },
  ]
  s.movements[0]!.occurredOn = '2026-02-01'
  expect(
    checkBalanceFlowLinks(s, 2026).issues.some((row) => row.message.includes('移動日より後')),
  ).toBe(true)
  s.movements[0]!.occurredOn = '2026-01-01'
  s.accounts[0]!.opening = { status: 'unknown', amountJpy: null, reasons: ['未確認'] }
  s.movements[1]!.balanceAllocations = [{ sourceKind: 'opening', sourceId: 'a', amountJpy: 100 }]
  expect(
    checkBalanceFlowLinks(s, 2026).issues.some((row) => row.message.includes('不明な期首')),
  ).toBe(true)
  s.movements[1]!.balanceAllocations = [
    { sourceKind: 'movement', sourceId: 'back', amountJpy: 100 },
  ]
  s.movements.push({
    ...s.movements[1]!,
    id: 'back',
    kind: 'transfer',
    fromAccountId: 'b',
    toAccountId: 'a',
    balanceAllocations: [{ sourceKind: 'movement', sourceId: 'transfer', amountJpy: 100 }],
  })
  s.accounts[1]!.opening = { status: 'known', amountJpy: 100 }
  expect(checkBalanceFlowLinks(s, 2026).issues.some((row) => row.message.includes('循環'))).toBe(
    true,
  )
})
