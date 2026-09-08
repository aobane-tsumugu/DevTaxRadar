// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import BalanceFlowEditor from '../../src/client/pages/BalanceFlowEditor'
import type { BalanceSnapshot } from '../../src/accounting/types'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
it('selects matching sources, preserves unfinished amounts and retains references outside current candidates', async () => {
  const initial: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'a',
        taxUnitId: 'u',
        name: '合成残高',
        kind: 'asset',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 100 },
      },
    ],
    pendingDecisions: [],
    movements: [
      {
        id: 'expense',
        kind: 'expense',
        accountId: 'a',
        occurredOn: '2026-07-01',
        amountJpy: 50,
        sourceIds: ['e'],
        decisionId: 'd',
        reason: '使用',
        balanceAllocations: [{ sourceKind: 'movement', sourceId: 'missing', amountJpy: 10 }],
      },
      {
        id: 'future',
        kind: 'addition',
        accountId: 'a',
        occurredOn: '2027-01-01',
        amountJpy: 100,
        sourceIds: ['e'],
        decisionId: 'd',
        reason: '未来',
      },
    ],
  }
  let latest = initial
  function Harness() {
    const [snapshot, set] = useState(initial)
    latest = snapshot
    return (
      <BalanceFlowEditor
        snapshot={snapshot}
        movement={snapshot.movements[0]!}
        onChange={(links) =>
          set({
            ...snapshot,
            movements: snapshot.movements.map((m, i) =>
              i === 0 ? { ...m, balanceAllocations: links } : m,
            ),
          })
        }
      />
    )
  }
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  try {
    await act(async () => root.render(<Harness />))
    expect(node.textContent).toContain('現在の候補外')
    expect(node.textContent).not.toContain('未来')
    const select = node.querySelector('select')!
    await act(async () => {
      select.value = JSON.stringify(['opening', 'a'])
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(latest.movements[0]!.balanceAllocations).toHaveLength(2)
    expect(latest.movements[0]!.balanceAllocations![1]!.amountJpy).toBeNaN()
    const input = node.querySelector<HTMLInputElement>('[aria-label="expenseの対応元aの使用額"]')!
    await act(async () => {
      input.value = '40'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(latest.movements[0]!.balanceAllocations![1]!.amountJpy).toBe(40)
    await act(async () =>
      node.querySelector<HTMLButtonElement>('[aria-label="expenseの対応元missingを外す"]')!.click(),
    )
    expect(latest.movements[0]!.balanceAllocations).toEqual([
      { sourceKind: 'opening', sourceId: 'a', amountJpy: 40 },
    ])
    expect(latest.movements[0]!.amountJpy).toBe(50)
  } finally {
    await act(async () => root.unmount())
    node.remove()
  }
})
