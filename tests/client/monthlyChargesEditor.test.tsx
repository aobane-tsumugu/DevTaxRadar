// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import MonthlyChargesEditor from '../../src/client/pages/MonthlyChargesEditor'
import type { LocalConfiguration } from '../../src/client/types'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('edits saved months outside observations and adds only explicit overrides, including confirmed zero', async () => {
  let latest: LocalConfiguration['monthlyCharges'] = [
    { provider: 'codex', month: '2030-01', amountJpy: 4567 },
  ]
  const initial = structuredClone(latest)
  function Harness() {
    const [charges, setCharges] = useState(latest)
    latest = charges
    return (
      <MonthlyChargesEditor charges={charges} observedMonths={['2026-07']} onChange={setCharges} />
    )
  }
  const container = document.createElement('div'),
    root = createRoot(container)
  document.body.append(container)
  const fill = async (label: string, value: string) =>
    act(async () => {
      const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  try {
    await act(async () => root.render(<Harness />))
    expect(container.textContent).toContain('2030年1月')
    expect(latest).toEqual(initial)
    await fill('2030年1月 codex料金', '5000')
    expect(latest).toEqual([{ provider: 'codex', month: '2030-01', amountJpy: 5000 }])
    await act(async () => {
      const field = container.querySelector<HTMLInputElement>(
        'input[aria-label="追加する月別料金の月"]',
      )!
      field.value = '2027-03'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector('button')!.click())
    expect(container.textContent).toContain('2027年3月')
    expect(latest).toHaveLength(1)
    await fill('2027年3月 claude料金', '0')
    expect(latest).toContainEqual({ provider: 'claude', month: '2027-03', amountJpy: 0 })
    await fill('2027年3月 claude料金', '')
    expect(latest).toEqual([{ provider: 'codex', month: '2030-01', amountJpy: 5000 }])
    await fill('2030年1月 codex料金', '')
    expect(latest).toEqual([])
    const unknown = container.querySelector<HTMLInputElement>(
      'input[aria-label="2027年3月 claude料金不明"]',
    )!
    await act(async () => unknown.click())
    expect(latest).toEqual([
      { provider: 'claude', month: '2027-03', amountJpy: null, unknownAmountReason: '' },
    ])
    await fill('2027年3月 claude料金不明の理由', '請求書を確認中')
    expect(latest[0]).toMatchObject({ amountJpy: null, unknownAmountReason: '請求書を確認中' })
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="2027年3月 claude料金"]')!
        .disabled,
    ).toBe(true)
    await act(async () => unknown.click())
    expect(latest).toEqual([])
    await fill('2027年3月 claude料金', '0')
    expect(latest).toEqual([{ provider: 'claude', month: '2027-03', amountJpy: 0 }])
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
