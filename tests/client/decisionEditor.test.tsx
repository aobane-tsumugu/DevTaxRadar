// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import DecisionEditor from '../../src/client/pages/DecisionEditor'
import { decisionIsConfirmed, reviseDecision } from '../../src/core/decisionConfirmation'
import type { DecisionRecord } from '../../src/planning/types'
import { demoPlanning } from '../../src/client/dashboard'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
describe('decision confirmation', () => {
  it('requires the selected treatment, reason and chronological confirmation even for legacy confirmed records', () => {
    const row: DecisionRecord = {
      id: 'd',
      taxUnitId: 'u',
      taxYear: 2026,
      engineVersion: 'old',
      candidate: '検討',
      status: 'confirmed',
      createdAt: '2026-01-01T00:00:00Z',
    }
    expect(decisionIsConfirmed(row)).toBe(false)
    const confirmed = {
      ...row,
      selectedCandidate: '扱い',
      reason: '確認先と根拠',
      confirmedAt: '2026-01-02T00:00:00Z',
    }
    expect(decisionIsConfirmed(confirmed)).toBe(true)
    expect(decisionIsConfirmed({ ...confirmed, confirmedAt: '2025-12-31T00:00:00Z' })).toBe(false)
    expect(reviseDecision(confirmed, { reason: '根拠を訂正' })).toMatchObject({
      status: 'pending',
      confirmedAt: undefined,
      reason: '根拠を訂正',
    })
  })
  it('records an explicit confirmation and clears it when any decision content changes', async () => {
    let latest: DecisionRecord[] = []
    function Harness() {
      const [rows, setRows] = useState<DecisionRecord[]>([])
      latest = rows
      return (
        <DecisionEditor value={rows} units={demoPlanning.taxUnits} year={2026} onChange={setRows} />
      )
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === name)!
    async function fill(label: string, value: string) {
      const input = [...container.querySelectorAll('label')]
        .find((l) => l.textContent?.trim().startsWith(label))!
        .querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input,select,textarea',
        )!
      await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(
          input,
          value,
        )
        input.dispatchEvent(
          new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
        )
      })
    }
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => button('判断記録を追加').click())
      expect(button('この判断内容を確認した').disabled).toBe(true)
      await fill('判断する制作物', demoPlanning.taxUnits[0]!.id)
      await fill('検討した扱い', '候補')
      await fill('確認した扱い', '確認した処理')
      await fill('判断の根拠・確認先', '合成の相談回答')
      await act(async () => button('この判断内容を確認した').click())
      expect(decisionIsConfirmed(latest[0]!)).toBe(true)
      expect(latest[0]!.status).toBe('overridden')
      await fill('判断の対象年', '2027')
      expect(latest[0]).toMatchObject({ taxYear: 2027, status: 'pending', confirmedAt: undefined })
      expect(decisionIsConfirmed(latest[0]!)).toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
