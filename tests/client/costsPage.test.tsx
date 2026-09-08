// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CostsPage from '../../src/client/pages/CostsPage.tsx'
import type { EvidenceExplanation } from '../../src/client/pages/EvidenceReferences'
import { recordedTime } from '../../src/client/recordedTime'
import { getCostProjection } from '../../src/client/api.ts'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts.ts'
import { emptyPlanningSnapshot } from '../../src/planning/types.ts'

vi.mock('../../src/client/api.ts', () => ({ getCostProjection: vi.fn() }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function fixture() {
  const planning = emptyPlanningSnapshot(2026)
  planning.equipment = [
    {
      id: 'pc',
      name: '合成PC',
      equipmentType: 'pc',
      acquisitionCostJpy: 240000,
      acquiredOn: '2026-01-01',
      convertedFromPrivate: false,
      businessUseRatio: 1,
      role: '開発',
      projectAllocationRatio: 0,
      evidenceIds: [],
    },
  ]
  planning.directCosts = [
    {
      id: 'domain',
      incurredOn: '2026-07-01',
      costType: 'domain',
      amountJpy: 2000,
      directlyAttributable: false,
      treatment: 'general',
      evidenceIds: [],
    },
  ]
  return projectWorkspaceCosts(planning, [])
}
describe('all costs page', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    container?.remove()
    vi.resetAllMocks()
  })
  async function render(initial = fixture(), evidence?: readonly EvidenceExplanation[]) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const edit = vi.fn()
    await act(async () =>
      root!.render(<CostsPage initial={initial} evidence={evidence} local onEdit={edit} />),
    )
    return edit
  }
  it('explains referenced evidence and distinguishes missing records without exposing original paths or executing text', async () => {
    const projection = fixture()
    projection.sources[0]!.evidenceIds = ['receipt', 'missing', 'ambiguous']
    const records = [
      {
        id: 'receipt',
        note: '請求確認 <img src=x onerror=alert(1)>',
        strength: 'external' as const,
        occurredOn: '2026-01-01',
        recordedAt: '2026-02-01T00:00:00Z',
        localReference: 'C:\\private\\receipt.pdf',
      },
      {
        id: 'ambiguous',
        note: '一つ目',
        strength: 'self-recorded' as const,
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'ambiguous',
        note: '二つ目',
        strength: 'self-recorded' as const,
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ]
    await render(projection, records)
    expect(container.textContent).toContain('請求確認 <img src=x onerror=alert(1)>')
    expect(container.textContent).toContain('出所：外部の資料')
    expect(container.textContent).toContain(
      '資料の対象日：2026-01-01 / 記録日時：' + recordedTime('2026-02-01T00:00:00Z'),
    )
    expect(container.textContent).toContain('対応する根拠の記録がありません。')
    expect(container.textContent).toContain('同じ参照IDの記録が複数あり、根拠を特定できません。')
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('receipt.pdf')
    await act(async () =>
      root!.render(
        <CostsPage
          initial={projection}
          local={false}
          readOnly
          recordState="recorded"
          onEdit={() => {}}
        />,
      ),
    )
    expect(container.textContent).toContain('この表示には根拠の説明が未収録です。')
    expect(container.textContent).not.toContain('請求確認')
    expect(getCostProjection).not.toHaveBeenCalled()
  })
  it('shows an unknown original and the missing evidence instead of formatting null as zero', async () => {
    const projection = fixture()
    const equipment = projection.sources.find((source) => source.kind === 'equipment')!
    equipment.originalAmountJpy = null
    equipment.unknownOriginalAmountReasons = ['請求書の再発行を待っている']
    await render(projection)
    const card = [...container.querySelectorAll('.cost-source')].find((element) =>
      element.textContent?.includes('合成PC'),
    )!
    expect(card.textContent).toContain('支払・購入の原額 不明')
    expect(card.textContent).toContain('請求書の再発行を待っている')
    expect(card.textContent).not.toContain('￥0')
    expect(container.textContent).toContain('算定済みの費用基礎￥2,000')
  })
  it('lets the user trace a selected amount or unknown basis using only the displayed projection', async () => {
    const projection = fixture()
    await render(projection)
    const panel = container.querySelector('[aria-label="金額の由来をたどる"]')!
    const select = panel.querySelector('select')!
    const contribution = projection.contributions.find((item) => !item.consumedByBasisId)!
    await act(async () => {
      select.value = `contribution:${contribution.id}`
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const route = () => panel.querySelector('[aria-label="支払から対応額までの参照経路"]')!
    expect(route().textContent).toContain('原額 ￥2,000')
    expect(route().textContent).toContain('対応の理由')
    expect(route().textContent).not.toContain('合成PC')
    const unknown = projection.bases.find((basis) => basis.amount.status === 'unknown')!
    await act(async () => {
      select.value = `basis:${unknown.id}`
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(route().textContent).toContain('合成PC')
    expect(route().textContent).toContain('未算定')
    expect(route().textContent).not.toContain('￥0')
    expect(getCostProjection).not.toHaveBeenCalled()
  })
  it('shows the source amount separately from unknown basis and routes editing back to inputs', async () => {
    const edit = await render()
    expect(container.textContent).toContain('支払・購入の原額 ￥240,000')
    expect(container.textContent).toContain('費用基礎が未算定1件')
    expect(container.textContent).toContain('算定済みの費用基礎￥2,000')
    expect(container.textContent).not.toContain('￥242,000')
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '費用を入力・確認',
    )!
    await act(async () => button.click())
    expect(edit).toHaveBeenCalledOnce()
  })
  it('retains the explicitly named old year when loading a different year fails', async () => {
    await render()
    vi.mocked(getCostProjection).mockRejectedValueOnce(new Error('接続できません'))
    const input = container.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2025')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'この年を表示',
    )!
    await act(async () => button.click())
    expect(getCostProjection).toHaveBeenCalledWith(2025)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('更新されていません')
    expect(container.querySelector('h2')?.textContent).toContain('2026年')
    vi.mocked(getCostProjection).mockResolvedValueOnce(
      projectWorkspaceCosts(emptyPlanningSnapshot(2025), []),
    )
    await act(async () => button.click())
    expect(container.querySelector('h2')?.textContent).toContain('2025年')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
