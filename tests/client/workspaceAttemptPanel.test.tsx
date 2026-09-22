// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import WorkspaceAttemptPanel from '../../src/client/pages/WorkspaceAttemptPanel'
import { writeWorkspaceAttempt, type WorkspaceAttempt } from '../../src/client/workspaceAttempt'
import { emptyPlanningSnapshot } from '../../src/planning/types'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

it('explains retained changes without sending them and removes only the selected attempt', async () => {
  const configuration = {
    charges: { claude: 0, codex: 0 },
    monthlyCharges: [],
    contracts: { claude: {}, codex: {} },
    chargePeriods: [],
    unobservedRatio: null,
  }
  const base = { revision: 3, configuration, planning: emptyPlanningSnapshot(2026) }
  base.planning.taxUnits.push({
    id: 'unit',
    name: '制作アプリ',
    unitType: 'new-software',
    usageMode: 'internal',
    revenueModel: 'efficiency',
    lifecycleStatus: 'developing',
  })
  const record: WorkspaceAttempt = {
    version: 1,
    datasetId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    base,
    request: {
      requestId: crypto.randomUUID(),
      expectedRevision: 3,
      configuration: {
        ...configuration,
        monthlyCharges: [
          {
            provider: 'claude',
            month: '2026-07',
            amountJpy: null,
            unknownAmountReason: '<img src=x>請求書を確認中',
          },
        ],
      },
      planning: {
        ...base.planning,
        homeCosts: [
          {
            id: 'home',
            month: '2026-07',
            category: 'rent',
            amountJpy: 4000,
            method: 'area',
            businessUseRatio: 0.5,
            basis: '床面積',
            rationale: '仕事部屋',
            projectAllocationRatio: 0,
            treatment: 'shared',
            targets: [{ taxUnitId: 'unit', shareBps: 2500 }],
            evidenceIds: [],
          },
        ],
      },
    },
  }
  localStorage.clear()
  writeWorkspaceAttempt(localStorage, record)
  localStorage.setItem('unrelated', 'keep')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onRetry = vi.fn()
  try {
    await act(async () =>
      root.render(
        <WorkspaceAttemptPanel datasetId={record.datasetId} disabled={false} onRetry={onRetry} />,
      ),
    )
    const button = (text: string) =>
      [...container.querySelectorAll('button')].find((item) => item.textContent === text)!
    await act(async () => button('料金・計画の保存要求を確認').click())
    expect(container.textContent).toContain('対象年 2026年')
    expect(container.textContent).toContain('現在の保存内容との差分ではありません')
    expect(container.textContent).toContain('送信した変更を確認（2件）')
    expect(container.textContent).toContain('月別料金（Claude Code）：2026-07')
    expect(container.textContent).toContain('金額が不明な理由')
    expect(container.textContent).toContain('<img src=x>請求書を確認中')
    expect(container.textContent).toContain('4,000円')
    expect(container.textContent).toContain('50%')
    expect(container.textContent).toContain('業務分に対する割合')
    expect(container.textContent).toContain('25%')
    expect(container.querySelector('img')).toBeNull()
    expect(onRetry).not.toHaveBeenCalled()
    await act(async () => button('この送信控えだけを削除').click())
    expect(container.textContent).toContain(
      'ブラウザの控えと一覧から取り除きました。端末上のファイル控えは削除していません。',
    )
    expect(container.querySelector('article')).toBeNull()
    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem('unrelated')).toBe('keep')
    expect(onRetry).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
  }
})
