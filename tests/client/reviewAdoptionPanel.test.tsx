// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReviewAdoptionPanel from '../../src/client/pages/ReviewAdoptionPanel'
import * as api from '../../src/client/api'
import type { BalancePreview } from '../../src/accounting/balanceWorkspace'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { buildAnnualBalances } from '../../src/core/annualBalances'
import { projectAnnualCosts } from '../../src/core/costProjection'
vi.mock('../../src/client/api', async (original) => ({
  ...(await original<typeof api>()),
  getBalancePreview: vi.fn(),
  getRuntime: vi.fn(),
  adoptReview: vi.fn(),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function fixture(): BalancePreview {
  const snapshot = { version: 1 as const, accounts: [], movements: [], pendingDecisions: [] }
  return {
    snapshot,
    draftRevision: 1,
    currentReviewId: null,
    previousReviewId: null,
    projectionHash: 'a'.repeat(64),
    projection: buildAnnualBalances(snapshot, 2026),
    materials: {
      schemaVersion: 1,
      engineVersion: 'review-materials/1',
      year: 2026,
      workspaceRevision: 4,
      timeZone: 'Asia/Tokyo',
      configuration: {
        charges: { claude: 0, codex: 0 },
        contracts: { claude: {}, codex: {} },
        monthlyCharges: [],
        chargePeriods: [],
        unobservedRatio: null,
      },
      planning: emptyPlanningSnapshot(2026),
      observations: [],
      recentScans: [],
      scanTimeZones: {},
      costs: projectAnnualCosts(
        { version: 1, taxUnits: [], sources: [], bases: [], contributions: [] },
        2026,
      ),
      referenceCheck: { engineVersion: 'balance-references/1', status: 'consistent', issues: [] },
      taxTreatmentVerified: false,
    },
  }
}
describe('year record confirmation', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    root = undefined
    container?.remove()
    vi.resetAllMocks()
    vi.restoreAllMocks()
    localStorage.clear()
  })
  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === name)!
  async function render(blocked = false, revision = 1, datasetId?: string) {
    if (!root) {
      container = document.createElement('div')
      document.body.append(container)
      root = createRoot(container)
    }
    await act(async () =>
      root!.render(
        <ReviewAdoptionPanel
          year="2026"
          draftRevision={revision}
          blocked={blocked}
          datasetId={datasetId}
        />,
      ),
    )
  }
  async function reason(value: string) {
    await act(async () => {
      const field = container.querySelector('textarea')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        value,
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  it('shows the unreflected year before adoption and permits a fresh preview after correction', async () => {
    const preview = fixture()
    preview.previousReviewChainChanged = true
    preview.previousReviewChanges = [
      {
        year: 2024,
        referencingYear: 2025,
        storedReviewId: 'old-2024',
        currentReviewId: 'new-2024',
      },
    ]
    vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
    await render()
    await act(async () => button('保存する年度資料を確認').click())
    await reason('今年の内容を確認')
    expect(container.textContent).toContain('2024年の変更が2025年資料に未反映')
    expect(container.textContent).toContain('old-2024')
    expect(container.textContent).toContain('new-2024')
    expect(button('この内容を年度資料として保存').disabled).toBe(true)
    await act(async () => button('この内容を年度資料として保存').click())
    expect(api.adoptReview).not.toHaveBeenCalled()
    vi.mocked(api.getBalancePreview).mockResolvedValue({
      ...preview,
      previousReviewChainChanged: false,
      previousReviewChanges: [],
    })
    await act(async () => button('保存する年度資料を確認').click())
    expect(container.textContent).not.toContain('2024年の変更が2025年資料に未反映')
    expect(container.querySelector('textarea')!.value).toBe('今年の内容を確認')
    expect(button('この内容を年度資料として保存').disabled).toBe(false)
  })
  it.each(['matched', 'mismatch', 'unavailable'] as const)(
    'shows equipment carry %s and blocks only a known mismatch',
    async (status) => {
      const preview = fixture()
      preview.materials!.equipmentCarryCheck = {
        engineVersion: 'equipment-carry/1',
        previousReviewId: 'prior-review',
        rows: [
          {
            equipmentId: 'pc',
            status,
            enteredJpy: 200000,
            previousClosingJpy: status === 'unavailable' ? null : 210000,
            reason: '前年設備の照合結果',
          },
        ],
      }
      vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
      await render()
      await act(async () => button('保存する年度資料を確認').click())
      await reason('資料の固定理由')
      expect(container.textContent).toContain('前年設備の照合結果')
      expect(container.textContent).toContain('prior-review')
      expect(button('この内容を年度資料として保存').disabled).toBe(status === 'mismatch')
    },
  )
  it.each(['conflict', 'deferred'] as const)(
    'shows the frozen annual status and controls adoption for %s',
    async (status) => {
      const preview = fixture()
      preview.materials!.costPresenceCheck = {
        engineVersion: 'cost-presence/1',
        year: 2026,
        items: [
          {
            category: 'home',
            label: '自宅費用',
            taxYear: 2026,
            status,
            recordIds: ['cost'],
            explanation: '確認内容を見直す',
            declaration: {
              id: 'presence',
              category: 'home',
              taxYear: 2026,
              status: status === 'conflict' ? 'not-applicable' : 'deferred',
              reason: '明細を照合中',
              recordedAt: '2026-09-08T00:00:00Z',
            },
          },
        ],
      }
      vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
      await render()
      await act(async () => button('保存する年度資料を確認').click())
      await reason('資料の固定理由')
      expect(container.textContent).toContain('明細を照合中')
      expect(container.textContent).toContain(status === 'conflict' ? '不一致・採用不可' : '保留')
      expect(button('この内容を年度資料として保存').disabled).toBe(status === 'conflict')
      if (status === 'conflict') {
        await act(async () => button('この内容を年度資料として保存').click())
        expect(api.adoptReview).not.toHaveBeenCalled()
      }
    },
  )

  it.each(['invalid', 'incomplete'] as const)(
    'controls adoption for opening provenance %s',
    async (status) => {
      const preview = fixture()
      preview.materials!.openingLotCarry = {
        engineVersion: 'opening-lot-carry/1',
        year: 2026,
        previousReviewId: 'prior',
        status,
        accounts: [],
        issues: status === 'invalid' ? ['前年原価と期首が不一致'] : [],
      }
      vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
      await render()
      await act(async () => button('保存する年度資料を確認').click())
      await reason('前年原価を確認')
      expect(button('この内容を年度資料として保存').disabled).toBe(status === 'invalid')
      if (status === 'invalid') {
        await act(async () => button('この内容を年度資料として保存').click())
        expect(api.adoptReview).not.toHaveBeenCalled()
        expect(container.textContent).toContain('前年原価と期首が不一致')
      }
    },
  )
  it.each(['invalid', 'incomplete'] as const)(
    'controls adoption for explicit lot trace %s',
    async (status) => {
      const preview = fixture()
      preview.materials!.balanceLotTrace = {
        engineVersion: 'balance-lot-trace/2',
        year: 2026,
        scope: 'explicit-and-unique-cost-lots',
        status,
        movements: [],
        remaining: [],
        issues: status === 'invalid' ? [{ movementId: 'm', message: '原価の重複使用' }] : [],
      }
      vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
      await render()
      await act(async () => button('保存する年度資料を確認').click())
      await reason('原価を確認')
      expect(button('この内容を年度資料として保存').disabled).toBe(status === 'invalid')
      if (status === 'invalid') {
        expect(container.textContent).toContain('原価の重複使用')
        await act(async () => button('この内容を年度資料として保存').click())
        expect(api.adoptReview).not.toHaveBeenCalled()
      }
    },
  )
  it.each(['invalid', 'incomplete'] as const)(
    'shows balance flow issues and controls adoption for %s',
    async (status) => {
      const preview = fixture()
      preview.materials!.balanceFlowCheck = {
        engineVersion: 'balance-flow-links/1',
        year: 2026,
        scope: 'recorded-balance-flows',
        status,
        sources: [],
        uses: [],
        issues:
          status === 'invalid' ? [{ movementId: 'm', message: '対応元の額を超えています' }] : [],
      }
      vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
      await render()
      await act(async () => button('保存する年度資料を確認').click())
      await reason('照合を確認')
      expect(container.textContent).toContain('残高移動の対応元の照合')
      expect(button('この内容を年度資料として保存').disabled).toBe(status === 'invalid')
      if (status === 'invalid') {
        expect(container.textContent).toContain('対応元の額を超えています')
        await act(async () => button('この内容を年度資料として保存').click())
        expect(api.adoptReview).not.toHaveBeenCalled()
      }
    },
  )
  it('requires preview and reason and reuses the request key after an uncertain response', async () => {
    const preview = fixture()
    vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
    vi.mocked(api.getRuntime).mockResolvedValue({ csrfToken: 'token' } as Awaited<
      ReturnType<typeof api.getRuntime>
    >)
    vi.mocked(api.adoptReview).mockRejectedValueOnce(new Error('通信結果を確認できません'))
    await render()
    expect(button('この内容を年度資料として保存')).toBeUndefined()
    await act(async () => button('保存する年度資料を確認').click())
    expect(button('この内容を年度資料として保存').disabled).toBe(true)
    await reason('確認した理由')
    await act(async () => button('この内容を年度資料として保存').click())
    const first = vi.mocked(api.adoptReview).mock.calls[0]!
    expect(first).toEqual([
      'token',
      expect.objectContaining({
        year: 2026,
        expectedDraftRevision: 1,
        projectionHash: preview.projectionHash,
        reason: '確認した理由',
      }),
    ])
    vi.mocked(api.adoptReview).mockResolvedValue({
      review: {
        schemaVersion: 1,
        engineVersion: 'annual-balances/1',
        id: 'saved',
        year: 2026,
        createdAt: '2026-01-01T00:00:00Z',
        draftRevision: 1,
        correctsReviewId: null,
        previousReviewId: null,
        reason: '確認した理由',
        snapshot: preview.snapshot!,
        projection: preview.projection,
        materials: preview.materials,
      },
    })
    await act(async () => button('この内容を年度資料として保存').click())
    expect(vi.mocked(api.adoptReview).mock.calls[1]).toEqual(first)
    expect(container.textContent).toContain('年度資料を保存しました')
    expect(container.querySelector('a')?.getAttribute('href')).toContain(
      '/saved/export?format=markdown',
    )
  })
  it('discards stale confirmation on conflict and resets preview after the draft revision changes', async () => {
    vi.mocked(api.getBalancePreview).mockResolvedValue(fixture())
    vi.mocked(api.getRuntime).mockResolvedValue({ csrfToken: 'token' } as Awaited<
      ReturnType<typeof api.getRuntime>
    >)
    vi.mocked(api.adoptReview).mockRejectedValue(
      new api.ApiRequestError(409, '確認後に更新されています', 'balance_conflict'),
    )
    await render()
    await act(async () => button('保存する年度資料を確認').click())
    await reason('理由')
    await act(async () => button('この内容を年度資料として保存').click())
    expect(button('この内容を年度資料として保存')).toBeUndefined()
    expect(container.textContent).toContain('確認後に更新されています')
    await act(async () => button('保存する年度資料を確認').click())
    expect(container.querySelector('textarea')!.value).toBe('理由')
    await render(false, 2)
    expect(button('この内容を年度資料として保存')).toBeUndefined()
  })
  it('blocks unsaved inputs and previews with unresolved references', async () => {
    await render(true)
    expect(button('保存する年度資料を確認').disabled).toBe(true)
    const preview = fixture()
    preview.materials!.referenceCheck = {
      engineVersion: 'balance-references/1',
      status: 'needs-review',
      issues: [
        {
          recordType: 'movement',
          recordId: 'm',
          referenceId: 'd',
          code: 'missing-decision',
          message: '判断がありません',
        },
      ],
    }
    vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
    await render(false)
    await act(async () => button('保存する年度資料を確認').click())
    await reason('理由')
    expect(button('この内容を年度資料として保存').disabled).toBe(true)
    expect(container.textContent).toContain('判断がありません')
    expect(api.adoptReview).not.toHaveBeenCalled()
  })
  it('recovers the exact uncertain request after remount and keeps it on conflict', async () => {
    const datasetId = crypto.randomUUID()
    vi.mocked(api.getBalancePreview).mockResolvedValue(fixture())
    vi.mocked(api.getRuntime).mockResolvedValue({ csrfToken: 'token', datasetId } as Awaited<
      ReturnType<typeof api.getRuntime>
    >)
    vi.mocked(api.adoptReview).mockRejectedValue(new Error('応答なし'))
    await render(false, 1, datasetId)
    await act(async () => button('保存する年度資料を確認').click())
    await reason('再起動後も残す理由')
    await act(async () => button('この内容を年度資料として保存').click())
    const first = vi.mocked(api.adoptReview).mock.calls[0]!
    expect(first[1].expectedDatasetId).toBe(datasetId)
    expect(localStorage.length).toBe(1)
    await act(async () => root!.unmount())
    root = undefined
    container.remove()
    await render(false, 2, datasetId)
    await act(async () => button('前回の保存要求を確認').click())
    expect(container.textContent).toContain('再起動後も残す理由')
    vi.mocked(api.adoptReview).mockRejectedValueOnce(
      new api.ApiRequestError(409, '版が変わりました', 'balance_conflict'),
    )
    await act(async () => button('同じ保存要求を再試行').click())
    expect(vi.mocked(api.adoptReview).mock.calls[1]).toEqual(first)
    expect(localStorage.length).toBe(1)
    expect(container.textContent).toContain('版が変わりました')
    const preview = fixture()
    vi.mocked(api.adoptReview).mockResolvedValue({
      review: {
        schemaVersion: 1,
        engineVersion: 'annual-balances/1',
        id: 'saved',
        year: 2026,
        createdAt: '2026-09-08T00:00:00Z',
        draftRevision: 1,
        correctsReviewId: null,
        previousReviewId: null,
        reason: first[1].reason,
        snapshot: preview.snapshot!,
        projection: preview.projection,
      },
    })
    await act(async () => button('同じ保存要求を再試行').click())
    expect(vi.mocked(api.adoptReview).mock.calls[2]).toEqual(first)
    expect(localStorage.length).toBe(0)
    expect(container.textContent).toContain('年度資料を保存しました')
  })
  it('does not send when the browser cannot retain the request or the dataset changes', async () => {
    const datasetId = crypto.randomUUID()
    vi.mocked(api.getBalancePreview).mockResolvedValue(fixture())
    vi.mocked(api.getRuntime).mockResolvedValue({ csrfToken: 'token', datasetId } as Awaited<
      ReturnType<typeof api.getRuntime>
    >)
    await render(false, 1, datasetId)
    await act(async () => button('保存する年度資料を確認').click())
    await reason('保持する理由')
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await act(async () => button('この内容を年度資料として保存').click())
    expect(api.adoptReview).not.toHaveBeenCalled()
    expect(container.textContent).toContain('送信していません')
    failure.mockRestore()
    vi.mocked(api.getRuntime).mockResolvedValue({
      csrfToken: 'token',
      datasetId: crypto.randomUUID(),
    } as Awaited<ReturnType<typeof api.getRuntime>>)
    await act(async () => button('この内容を年度資料として保存').click())
    expect(api.adoptReview).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')!.value).toBe('保持する理由')
    expect(container.textContent).toContain('接続先のデータが変わっています')
  })
})
