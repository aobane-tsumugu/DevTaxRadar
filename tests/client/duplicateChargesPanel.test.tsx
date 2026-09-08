import { chargeContractStatus, type ProviderChargePeriod } from '../../src/core/chargePeriods.js'
// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import DuplicateChargesPanel from '../../src/client/pages/DuplicateChargesPanel'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
it('identifies the editable invoice rows and clears the warning after a correction', async () => {
  const container = document.createElement('div'),
    root = createRoot(container)
  const invoice = {
    id: 'a',
    provider: 'claude' as const,
    planName: '<script>合成',
    serviceStartedOn: '2026-01-01',
    serviceEndedOn: '2026-01-31',
    amountJpy: 1000,
  }
  try {
    await act(async () =>
      root.render(<DuplicateChargesPanel periods={[invoice, { ...invoice, id: 'b' }]} />),
    )
    expect(container.textContent).toContain('請求1：Claude Code')
    expect(container.textContent).toContain('請求2：Claude Code')
    expect(container.textContent).toContain('各請求を合計に含めています')
    expect(container.querySelector('script')).toBeNull()
    await act(async () =>
      root.render(
        <DuplicateChargesPanel periods={[invoice, { ...invoice, id: 'b', amountJpy: 2000 }]} />,
      ),
    )
    expect(container.textContent).toContain('同じサービスで利用期間が重なる請求')
    expect(container.textContent).not.toContain('同じサービス・利用期間・原額の重複候補')
    await act(async () =>
      root.render(
        <DuplicateChargesPanel
          periods={[
            invoice,
            { ...invoice, id: 'b', serviceStartedOn: '2026-02-01', serviceEndedOn: '2026-02-28' },
          ]}
        />,
      ),
    )
    expect(container.textContent).toBe('')
  } finally {
    await act(async () => root.unmount())
  }
})

it('keeps draft confirmation inputs, records both contracts and reopens after the invoice changes', async () => {
  let latest: ProviderChargePeriod[] = ['a','b'].map((id) => ({id,provider:'claude',planName:'合成',serviceStartedOn:'2026-01-01',serviceEndedOn:'2026-01-31',amountJpy:1000}))
  let replace: (periods: ProviderChargePeriod[]) => void = () => {}
  function Harness() {
    const [periods,setPeriods] = useState(latest)
    latest = periods
    replace = setPeriods
    return <DuplicateChargesPanel periods={periods} onChange={(updated) => setPeriods((rows) => rows.map((row) => row.id === updated.id ? updated : row))} />
  }
  const container = document.createElement('div'), root = createRoot(container)
  document.body.append(container)
  async function fill(label: string, value: string) {
    await act(async () => {
      const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
      const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(field,value)
      field.dispatchEvent(new Event('input',{bubbles:true}))
    })
  }
  try {
    await act(async () => root.render(<Harness />))
    for (const index of [1,2]) {
      await fill(`請求${index} 契約の呼び名`, `契約${index}`)
      expect(chargeContractStatus(latest[index-1]!)).toBe('draft')
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent === `請求${index}の契約対応を確認`)!
      expect(button.disabled).toBe(true)
      await fill(`請求${index} 契約確認の理由`, '<script>明細照合')
      await act(async () => button.click())
      expect(chargeContractStatus(latest[index-1]!)).toBe('confirmed')
    }
    expect(container.textContent).toContain('各請求を異なる契約として確認済み')
    expect(container.querySelector('script')).toBeNull()
    await act(async () => replace(latest.map((row,index) => index === 0 ? {...row,amountJpy:2000} : row)))
    expect(container.textContent).toContain('請求内容が変わりました')
    expect(container.textContent).not.toContain('各請求を異なる契約として確認済み')
    expect(latest[0]!.contractConfirmation!.basis.amountJpy).toBe(1000)
    await act(async () => replace(latest.map((row,index) => index === 0 ? {...row,serviceStartedOn:'2026-02-01',serviceEndedOn:'2026-02-28'} : row)))
    expect(container.querySelector('[aria-label="請求1 契約の呼び名"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
