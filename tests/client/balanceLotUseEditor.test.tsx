// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import BalanceLotUseEditor from '../../src/client/pages/BalanceLotUseEditor'
import type { BalanceCostAllocation, BalanceSnapshot } from '../../src/accounting/types'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
it('selects upstream lots, leaves amounts blank, retains missing references and explicitly clears the override', async () => {
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [],
    pendingDecisions: [],
    movements: [
      {
        id: 'a',
        kind: 'addition',
        accountId: 'x',
        occurredOn: '2026-01-01',
        amountJpy: 100,
        sourceIds: ['s'],
        decisionId: 'd',
        reason: '合成',
        costAllocations: [{ costYear: 2026, contributionId: 'c', amountJpy: 100 }],
      },
      {
        id: 't',
        kind: 'transfer',
        fromAccountId: 'x',
        toAccountId: 'y',
        occurredOn: '2026-02-01',
        amountJpy: 100,
        sourceIds: ['s'],
        decisionId: 'd',
        reason: '合成',
        balanceAllocations: [{ sourceKind: 'movement', sourceId: 'a', amountJpy: 100 }],
      },
    ],
  }
  let latest: BalanceCostAllocation[] | undefined
  function Harness() {
    const [lots, set] = useState<BalanceCostAllocation[] | undefined>([
      { costYear: 2026, contributionId: 'missing', amountJpy: 5 },
    ])
    latest = lots
    return (
      <BalanceLotUseEditor
        snapshot={snapshot}
        descriptions={[
          { costYear: 2026, contributionId: 'c', label: '当時の設備 / 2026-01-01〜2026-12-31' },
        ]}
        link={{ sourceKind: 'movement', sourceId: 't', amountJpy: 40, costAllocations: lots }}
        label="合成"
        onChange={set}
      />
    )
  }
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  try {
    await act(async () => root.render(<Harness />))
    expect(node.textContent).toContain('現在の上流候補にはありません')
    expect(node.textContent).toContain('当時の設備 / 2026-01-01〜2026-12-31')
    const select = node.querySelector('select')!
    await act(async () => {
      select.value = JSON.stringify([2026, 'c'])
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(latest![1]!.amountJpy).toBeNaN()
    const input = node.querySelector<HTMLInputElement>('[aria-label="合成の原価cの使用額"]')!
    expect(input.value).toBe('')
    await act(async () => {
      input.value = '35'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(latest![1]!.amountJpy).toBe(35)
    await act(async () =>
      node.querySelector<HTMLButtonElement>('[aria-label="合成の原価missingを外す"]')!.click(),
    )
    expect(latest).toEqual([{ costYear: 2026, contributionId: 'c', amountJpy: 35 }])
    await act(async () =>
      node.querySelector<HTMLButtonElement>('[aria-label="合成の原価指定を解除"]')!.click(),
    )
    expect(latest).toBeUndefined()
    await act(async () =>
      node.querySelector<HTMLButtonElement>('[aria-label="合成の使用原価を指定"]')!.click(),
    )
    expect(latest).toEqual([])
  } finally {
    await act(async () => root.unmount())
    node.remove()
  }
})
