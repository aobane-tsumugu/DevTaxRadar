// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import RecordStatusPanel from '../../src/client/pages/RecordStatusPanel'
import { emptyPlanningSnapshot } from '../../src/planning/types'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

it.each([false, true])(
  'reports registrations without treating them as verified facts; registered=%s',
  async (registered) => {
    const planning = emptyPlanningSnapshot(2026)
    if (registered) {
      planning.taxUnits = [
        {
          id: 'unit',
          name: '未確認の制作物',
          unitType: 'new-software',
          usageMode: 'undecided',
          revenueModel: 'undecided',
          lifecycleStatus: 'idea',
        },
      ]
      planning.evidence = [
        {
          id: 'evidence',
          evidenceType: 'memo',
          strength: 'self-recorded',
          note: '原本確認前のメモ',
          recordedAt: '2026-01-01T00:00:00Z',
        },
      ]
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const edit = vi.fn()
    try {
      await act(async () =>
        root.render(
          <RecordStatusPanel planning={planning} sessionCount={registered ? 4 : 0} onEdit={edit} />,
        ),
      )
      expect(container.textContent).toContain(registered ? '取込済み 4件' : '取込済みの履歴なし')
      const status = (name: string) =>
        [...container.querySelectorAll('dt')].find((element) => element.textContent === name)!
          .nextElementSibling!.textContent
      expect(status('根拠資料の参照')).toBe(registered ? '登録あり 1件' : '未登録')
      expect(status('設備')).toBe('未登録')
      expect(container.textContent).toContain('「該当なし」と確認した状態ではありません')
      expect(container.textContent).not.toMatch(/✓|確認済み|準備できた|できたこと/)
      await act(async () => container.querySelector('button')!.click())
      expect(edit).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  },
)
