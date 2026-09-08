// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import BalanceCostLinksEditor from '../../src/client/pages/BalanceCostLinksEditor'
import type { BalanceMovement } from '../../src/accounting/types'
import { projectAnnualCosts } from '../../src/core/costProjection'
import * as api from '../../src/client/api'
vi.mock('../../src/client/api', async (original) => ({
  ...(await original<typeof api>()),
  getCostProjection: vi.fn(),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
it('selects final allocations for the same unit, preserves entered links on failure, and keeps source evidence when removing a link', async () => {
  let current: Extract<BalanceMovement, { kind: 'addition' }> = {
    id: 'm',
    kind: 'addition',
    accountId: 'a',
    occurredOn: '2026-01-01',
    amountJpy: 100,
    sourceIds: ['evidence'],
    decisionId: 'd',
    reason: '合成',
  }
  const row = {
    id: 'c',
    basisId: 'b',
    target: { kind: 'tax-unit' as const, taxUnitId: 'u' },
    amountJpy: 100,
    reason: '合成配分',
    evidenceIds: [],
    sourceIds: ['s'],
  }
  vi.mocked(api.getCostProjection).mockResolvedValue({
    ...projectAnnualCosts(
      { version: 1, taxUnits: [], sources: [], bases: [], contributions: [] },
      2026,
    ),
    year: 2026,
    sources: [
      {
        id: 's',
        label: '合成支払',
        kind: 'direct',
        originalAmountJpy: 100,
        currency: 'JPY',
        evidenceIds: [],
        origin: 'entered',
      },
    ],
    contributions: [
      row,
      { ...row, id: 'used', consumedByBasisId: 'child' },
      { ...row, id: 'private', target: { kind: 'private' } },
    ],
  })
  function Harness() {
    const [movement, setMovement] = useState(current)
    current = movement
    return (
      <BalanceCostLinksEditor
        movement={movement}
        taxUnitId="u"
        onChange={(costAllocations, sourceIds) =>
          setMovement({ ...movement, costAllocations, sourceIds })
        }
      />
    )
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const button = (text: string) =>
    [...container.querySelectorAll('button')].find((row) => row.textContent === text)!
  try {
    await act(async () => root.render(<Harness />))
    await act(async () => button('この年の費用配分を確認').click())
    expect(container.textContent).toContain('最終配分 1件')
    await act(async () => button('この配分との金額対応を追加').click())
    expect(current.sourceIds).toEqual(['evidence', 's'])
    expect(current.costAllocations).toEqual([{ costYear: 2026, contributionId: 'c', amountJpy: 0 }])
    const amount = container.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '60')
      amount.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(current.costAllocations![0]!.amountJpy).toBe(60)
    vi.mocked(api.getCostProjection).mockRejectedValueOnce(new Error('通信失敗'))
    await act(async () => button('この年の費用配分を確認').click())
    expect(container.textContent).toContain('通信失敗')
    expect(current.costAllocations![0]!.amountJpy).toBe(60)
    await act(async () => button('この金額対応を外す').click())
    expect(current.costAllocations).toEqual([])
    expect(current.sourceIds).toEqual(['evidence', 's'])
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.resetAllMocks()
  }
})
