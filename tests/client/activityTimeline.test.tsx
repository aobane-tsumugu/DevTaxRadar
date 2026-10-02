// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ActivityFactsEditor from '../../src/client/pages/ActivityFactsEditor'
import ProductTimelinePanel from '../../src/client/pages/ProductTimelinePanel'
import ProductTimelinePage from '../../src/client/pages/ProductTimelinePage'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { projectProductTimeline } from '../../src/core/productTimeline'
import { getProductTimeline } from '../../src/client/api'
vi.mock('../../src/client/api', () => ({ getProductTimeline: vi.fn() }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
})
async function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('registers multiple zero-history products, retains partial fact edits on remount, and cancels without adding facts', async () => {
  const planning = emptyPlanningSnapshot(2026),
    container = document.createElement('div')
  document.body.append(container)
  let root = createRoot(container)
  const render = () =>
    root.render(
      <ActivityFactsEditor
        planning={planning}
        onChange={(ledger) => {
          planning.activityLedger = ledger
          render()
        }}
        datasetId="synthetic-dataset"
        revision={1}
      />,
    )
  const button = (text: string) =>
    [...container.querySelectorAll('button')].find((button) => button.textContent === text)!
  try {
    await act(async () => render())
    const productInput = () =>
      [...container.querySelectorAll('label')]
        .find((label) => label.textContent?.startsWith('作っているものの名前'))!
        .querySelector('input')!
    await change(productInput(), '作品A')
    await act(async () => button('制作物を計画へ追加').click())
    await change(productInput(), '作品B')
    await act(async () => button('制作物を計画へ追加').click())
    expect(planning.activityLedger?.products.map((product) => product.name)).toEqual([
      '作品A',
      '作品B',
    ])
    expect(new Set(planning.activityLedger?.products.map((product) => product.id)).size).toBe(2)
    const scope = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.startsWith('範囲'))!
      .querySelector('input')!
    await change(scope, '入力途中の機能')
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => render())
    const restore = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('入力控えを復旧'),
    )!
    await act(async () => restore.click())
    expect(
      container.querySelector<HTMLInputElement>('input[value="入力途中の機能"]'),
    ).not.toBeNull()
    await act(async () => button('この入力を取り消す').click())
    expect(planning.activityLedger?.facts).toEqual([])
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
it('shows contradictory parallel facts, exact correction anchors and bounded stored cost coverage', async () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.activityLedger = {
    version: 1,
    products: [{ id: 'p', name: '作品' }],
    unitLinks: [],
    facts: [
      {
        id: 'a',
        productId: 'p',
        kind: 'internal-use',
        purpose: 'ordinary-operation',
        state: 'estimated',
        time: { kind: 'date', occurredOn: '2025-01-01' },
        scope: '旧版',
        reason: '記録から推定',
        recordedAt: '2026-01-01T00:00:00Z',
        evidenceIds: [],
      },
      {
        id: 'b',
        productId: 'p',
        kind: 'internal-use',
        purpose: 'ordinary-operation',
        state: 'conflicted',
        time: { kind: 'unknown' },
        scope: '旧版',
        reason: '資料が矛盾',
        recordedAt: '2026-01-02T00:00:00Z',
        evidenceIds: [],
        correctsId: 'a',
        correctionReason: '日時を再確認',
      },
    ],
  }
  const container = document.createElement('div'),
    root = createRoot(container)
  try {
    await act(async () =>
      root.render(<ProductTimelinePanel products={projectProductTimeline(planning)} />),
    )
    expect(container.textContent).toContain('矛盾あり')
    expect(container.textContent).toContain('収録年以外の費用がないという意味ではありません')
    expect(container.querySelector('a[href="#activity-a"]')).not.toBeNull()
    expect(container.querySelector('a[href="#activity-b"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
  }
})
it('rejects a changed dataset and allows retry after a network failure without showing stale data', async () => {
  const container = document.createElement('div'),
    root = createRoot(container)
  const planning = emptyPlanningSnapshot()
  vi.mocked(getProductTimeline)
    .mockRejectedValueOnce(new Error('通信失敗'))
    .mockResolvedValueOnce({ datasetId: 'other' } as Awaited<ReturnType<typeof getProductTimeline>>)
  try {
    await act(async () =>
      root.render(
        <ProductTimelinePage
          planning={planning}
          local
          datasetId="current"
          onEdit={() => {}}
          onCosts={() => {}}
          onBalances={() => {}}
        />,
      ),
    )
    expect(container.textContent).toContain('通信失敗')
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '再読込')!
        .click(),
    )
    expect(container.textContent).toContain('接続先が変わりました')
    expect(container.querySelector('.product-timeline')).toBeNull()
  } finally {
    await act(async () => root.unmount())
  }
})
