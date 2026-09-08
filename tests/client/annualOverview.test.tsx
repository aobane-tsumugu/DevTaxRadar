// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import AnnualOverview from '../../src/client/pages/AnnualOverview'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts'
import { emptyPlanningSnapshot } from '../../src/planning/types'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
describe('annual overview', () => {
  it('shows non-AI costs and unknown bases without claiming adopted expenses or carry-forward balances', async () => {
    const planning = emptyPlanningSnapshot(2026)
    planning.directCosts = [
      {
        id: 'known',
        incurredOn: '2026-01-01',
        costType: 'domain',
        amountJpy: 2000,
        directlyAttributable: false,
        treatment: 'general',
        evidenceIds: [],
      },
      {
        id: 'unknown',
        incurredOn: '2026-02-01',
        costType: 'cloud',
        amountJpy: null,
        unknownAmountReason: '確認待ち',
        directlyAttributable: false,
        treatment: 'general',
        evidenceIds: [],
      },
    ]
    const projection = projectWorkspaceCosts(planning, [])
    const container = document.createElement('div')
    const root = createRoot(container)
    const open = vi.fn()
    try {
      await act(async () =>
        root.render(<AnnualOverview year={2026} projection={projection} onOpenCosts={open} />),
      )
      const entries = Object.fromEntries(
        [...container.querySelectorAll('dl > div')].map((row) => [
          row.querySelector('dt')!.textContent,
          row.querySelector('dd')!.textContent,
        ]),
      )
      expect(entries['算定済みの費用基礎']).toBe('￥2,000')
      expect(entries['通常業務に対応する算定済み分']).toBe('￥2,000')
      expect(entries['費用基礎が未算定']).toBe('1件（小計に含めない）')
      expect(entries['税務上の当年費用']).toBe('未算定')
      expect(entries['全費用の処理から算定する翌期残高']).toBe('未算定')
      await act(async () => container.querySelector('button')!.click())
      expect(open).toHaveBeenCalledOnce()
      await act(async () =>
        root.render(<AnnualOverview year={2027} projection={projection} onOpenCosts={open} />),
      )
      expect(container.textContent).toContain('2027年の全費用資料が取得できていません')
      expect(container.textContent).not.toContain('￥2,000')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
