// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import CostPresenceEditor from '../../src/client/pages/CostPresenceEditor'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { costPresenceRecordsSchema } from '../../src/planning/costPresence'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

it('edits annual declarations, preserves other years and costs, and requires a reason', async () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.costPresence = [
    {
      id: 'old',
      taxYear: 2025,
      category: 'home',
      status: 'not-applicable',
      reason: '前年の記録',
      recordedAt: '2025-01-01T00:00:00Z',
    },
  ]
  planning.directCosts = [
    {
      id: 'cost',
      incurredOn: '2026-01-01',
      costType: 'other',
      amountJpy: 0,
      directlyAttributable: false,
      treatment: 'general',
      evidenceIds: [],
    },
  ]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = () =>
    root.render(
      <CostPresenceEditor
        planning={planning}
        onChange={(records) => {
          planning.costPresence = records
          render()
        }}
      />,
    )
  const select = (category: string) =>
    container.querySelector<HTMLSelectElement>(`select[aria-label="${category}の確認状態"]`)!
  try {
    await act(async () => render())
    expect(select('自宅費用').value).toBe('unreviewed')
    await act(async () => {
      select('直接費').value = 'not-applicable'
      select('直接費').dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(planning.costPresence).toHaveLength(2)
    expect(costPresenceRecordsSchema.safeParse(planning.costPresence).success).toBe(false)
    expect(container.textContent).toContain('空欄のままでは保存できません')
    const reason = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="直接費の確認理由"]',
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        reason,
        '今回の確認理由',
      )
      reason.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(costPresenceRecordsSchema.safeParse(planning.costPresence).success).toBe(true)
    expect(container.textContent).toContain('不一致:')
    expect(container.textContent).toContain('対象記録: cost')
    await act(async () => {
      select('直接費').value = 'unreviewed'
      select('直接費').dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(planning.costPresence).toHaveLength(1)
    expect(planning.costPresence![0]!.id).toBe('old')
    expect(planning.directCosts[0]!.amountJpy).toBe(0)
    planning.profile.taxYear = NaN
    await act(async () => render())
    expect(container.querySelectorAll('select')).toHaveLength(0)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
