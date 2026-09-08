// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import PreviousEquipmentBalancePicker from '../../src/client/pages/PreviousEquipmentBalancePicker'
import * as api from '../../src/client/api'
vi.mock('../../src/client/api', () => ({ getBalanceReviews: vi.fn(), getBalanceReview: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it.each([false, true])(
  'requires explicit application and rechecks the current prior head (changed=%s)',
  async (changed) => {
    vi.mocked(api.getBalanceReviews)
      .mockReset()
      .mockResolvedValue({
        reviews: [{ id: 'prior', year: 2026, active: true, previousYearChanged: false }],
      })
    vi.mocked(api.getBalanceReview)
      .mockReset()
      .mockResolvedValue({
        review: {
          id: 'prior',
          year: 2026,
          materials: {
            equipmentCalculations: [
              {
                equipmentId: 'pc',
                taxYear: 2026,
                result: { calculation: { closingBasisJpy: 210000 } },
              },
            ],
          },
        },
      } as Awaited<ReturnType<typeof api.getBalanceReview>>)
    const onUse = vi.fn(),
      container = document.createElement('div'),
      root = createRoot(container)
    document.body.append(container)
    try {
      await act(async () =>
        root.render(<PreviousEquipmentBalancePicker year={2027} equipmentId="pc" onUse={onUse} />),
      )
      expect(api.getBalanceReviews).not.toHaveBeenCalled()
      await act(async () => container.querySelector('button')!.click())
      expect(container.textContent).toContain('210,000円')
      expect(onUse).not.toHaveBeenCalled()
      if (changed)
        vi.mocked(api.getBalanceReviews).mockResolvedValue({
          reviews: [{ id: 'corrected', year: 2026, active: true, previousYearChanged: false }],
        })
      await act(async () => container.querySelectorAll('button')[1]!.click())
      if (changed) {
        expect(onUse).not.toHaveBeenCalled()
        expect(container.textContent).toContain('変更されています')
      } else
        expect(onUse).toHaveBeenCalledWith(
          {
            taxYear: 2026,
            amountJpy: 210000,
            reference: '年度資料 prior / 設備 pc',
          },
          'prior',
        )
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  },
)
