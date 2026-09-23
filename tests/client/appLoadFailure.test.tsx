import { listWorkspaceAttempts } from '../../src/client/workspaceAttempt'
// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.tsx'
import * as api from '../../src/client/api.ts'
import * as dashboard from '../../src/client/dashboard.ts'
import type { WorkspaceView, WorkspaceImpact } from '../../src/planning/workspace.ts'
import { projectAnnualCosts } from '../../src/core/costProjection.ts'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { listWorkspaceRecovery } from '../../src/client/workspaceRecovery'

vi.mock('../../src/client/api.ts', async (original) => {
  const actual = await original<typeof api>()
  return {
    ...actual,
    getRuntime: vi.fn(),
    getBalanceDraft: vi.fn(),
    getWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
    previewWorkspace: vi.fn(),
    getPlanning: vi.fn(),
    getDiagnosis: vi.fn(),
    getFolders: vi.fn(),
    getHistorySources: vi.fn(),
    getScanProgress: vi.fn(),
    scanHistory: vi.fn(),
  }
})
vi.mock('../../src/client/dashboard.ts', async (original) => {
  const actual = await original<typeof dashboard>()
  return { ...actual, isLocalRuntime: vi.fn(() => true), getDashboardData: vi.fn() }
})

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('local startup failure', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    container?.remove()
    root = undefined
    container = undefined
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('renders the selected year and all-cost basis independently from AI filters', async () => {
    vi.mocked(dashboard.isLocalRuntime).mockReturnValue(true)
    vi.mocked(api.getRuntime).mockResolvedValue({
      csrfToken: 'test',
      providers: { claude: { detected: false }, codex: { detected: false } },
      retention: { claude: { autoDelete: { kind: 'none' } }, codex: {} },
    } as Awaited<ReturnType<typeof api.getRuntime>>)
    const projection = projectAnnualCosts(
      {
        version: 1,
        taxUnits: [],
        sources: [
          {
            id: 'direct',
            kind: 'direct',
            label: '合成費用',
            currency: 'JPY',
            originalAmountJpy: 2000,
            evidenceIds: [],
            origin: 'entered',
          },
        ],
        bases: [
          {
            id: 'basis',
            sourceId: 'direct',
            parentContributionIds: [],
            affectedTaxUnitIds: [],
            period: { startedOn: '2026-01-01', endedOn: '2026-01-01' },
            amount: { status: 'known', amountJpy: 2000 },
            method: { id: 'direct', version: '1', explanation: '合成' },
            warnings: [],
          },
        ],
        contributions: [
          {
            id: 'contribution',
            basisId: 'basis',
            target: { kind: 'general' },
            amountJpy: 2000,
            reason: '合成',
            evidenceIds: [],
          },
        ],
      },
      2026,
    )
    const workspace: WorkspaceView = {
      revision: 1,
      configuration: {
        charges: { claude: 8000, codex: 0 },
        monthlyCharges: [],
        contracts: { claude: {}, codex: {} },
        chargePeriods: [],
        unobservedRatio: 0,
      },
      planning: structuredClone(dashboard.demoPlanning),
      diagnosis: dashboard.demoDiagnosis,
      dashboard: {
        ...dashboard.demoDashboard,
        costProjection: projection,
        meta: { ...dashboard.demoDashboard.meta, source: 'local' },
        months: [
          { monthKey: '2025-12', label: '2025年12月', current: 0, future: 0, review: 999999 },
          { monthKey: '2026-01', label: '2026年1月', current: 3100, future: 0, review: 0 },
        ],
        allocations: [
          {
            ...dashboard.demoDashboard.allocations[0]!,
            provider: 'Claude Code',
            month: '2026年1月',
            monthKey: '2026-01',
            group: 'current',
            amount: 3100,
          },
        ],
      },
    }
    vi.mocked(api.getScanProgress).mockResolvedValue({
      running: false,
      startupPending: false,
      provider: null,
      filesScanned: 0,
    })
    vi.mocked(api.getWorkspace).mockResolvedValue(workspace)
    vi.mocked(api.getFolders).mockResolvedValue({ folders: [] })
    vi.mocked(api.getHistorySources).mockResolvedValue({ sources: [] })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<App />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // The task list is the first page; the annual summary is one navigation away.
    await act(async () => {
      Array.from(container!.querySelectorAll<HTMLButtonElement>('.nav-item'))
        .find((button) => button.textContent?.includes('今年どうなる？'))!
        .click()
    })
    const ai = container.querySelector('[aria-label="対象年のAI分類内訳"]')!
    expect(ai.textContent).toContain('￥3,100')
    expect(ai.textContent).not.toContain('999,999')
    expect(
      container.querySelector('[aria-label="対象年の全費用と未確定の処理"]')!.textContent,
    ).toContain('￥2,000')
    const provider = container.querySelector<HTMLSelectElement>('.filters select')!
    await act(async () => {
      provider.value = 'Codex'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(ai.textContent).not.toContain('￥3,100')
    expect(
      container.querySelector('[aria-label="対象年の全費用と未確定の処理"]')!.textContent,
    ).toContain('￥2,000')
    vi.mocked(api.getBalanceDraft).mockResolvedValue({
      revision: 1,
      snapshot: {
        version: 1,
        accounts: [
          {
            id: 'retained',
            name: '保存前の残高',
            kind: 'asset',
            taxUnitId: workspace.planning.taxUnits[0]!.id,
            openingYear: 2026,
            opening: { status: 'known', amountJpy: 100 },
          },
        ],
        movements: [],
        pendingDecisions: [],
      },
    })
    const navigate = (name: string) =>
      [...container!.querySelectorAll('nav button')].find((b) =>
        b.textContent?.includes(name),
      )! as HTMLButtonElement
    await act(async () => navigate('残高と繰越し').click())
    const nameInput = [...container.querySelectorAll('label')]
      .find((l) => l.textContent?.startsWith('残高名'))!
      .querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        nameInput,
        '移動しても残す入力',
      )
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      navigate('今年どうなる？').click()
    })
    await act(async () => navigate('残高と繰越し').click())
    expect(nameInput.value).toBe('移動しても残す入力')
    expect(api.getBalanceDraft).toHaveBeenCalledOnce()
  })
  it('previews without saving, requires refresh after a stale preview, retries confirmation, and ignores cancelled late responses', async () => {
    vi.mocked(dashboard.isLocalRuntime).mockReturnValue(true)
    const retention = {
      detected: false,
      fileCount: 0,
      autoDelete: { kind: 'none' as const },
      alreadyLosing: false,
    }
    vi.mocked(api.getRuntime).mockResolvedValue({
      csrfToken: 'test-csrf',
      providers: { claude: { detected: true }, codex: { detected: false } },
      retention: { claude: retention, codex: retention },
    })
    const workspace: WorkspaceView = {
      revision: 12,
      dashboard: {
        ...dashboard.demoDashboard,
        meta: { ...dashboard.demoDashboard.meta, source: 'local' },
      },
      configuration: {
        charges: { claude: 8000, codex: 0 },
        monthlyCharges: [],
        contracts: { claude: {}, codex: {} },
        chargePeriods: [],
        unobservedRatio: null,
      },
      planning: structuredClone(dashboard.demoPlanning),
      diagnosis: dashboard.demoDiagnosis,
    }
    vi.mocked(api.getWorkspace).mockResolvedValue(workspace)
    vi.mocked(api.getFolders).mockResolvedValue({ folders: [] })
    vi.mocked(api.getHistorySources).mockResolvedValue({
      sources: [
        {
          id: 'synthetic-source',
          provider: 'claude',
          kind: 'default',
          name: '合成履歴',
          root: 'C:\\synthetic-only',
          enabled: true,
          availability: 'available',
          lastScan: { status: 'never' },
        },
      ],
    })
    vi.mocked(api.getScanProgress).mockResolvedValue({
      running: false,
      provider: null,
      filesScanned: 0,
    })
    const projection = projectAnnualCosts(
      { version: 1, taxUnits: [], sources: [], bases: [], contributions: [] },
      2026,
    )
    const report: WorkspaceImpact = {
      engineVersion: 'workspace-impact/1',
      expectedRevision: 12,
      previewHash: 'a'.repeat(64),
      scope: { fromYear: 2026, toYear: 2026, description: '合成の対象期間' },
      records: [{ key: 'unobservedRatio', label: '捕捉外割合', operation: 'changed' }],
      assignmentChanges: [],
      years: [
        {
          year: 2026,
          changed: false,
          before: projection,
          after: projection,
          aiBefore: { current: 0, future: 0, review: 0 },
          aiAfter: { current: 0, future: 0, review: 0 },
        },
      ],
      limitations: ['合成fixtureの計算結果'],
    }
    vi.mocked(api.previewWorkspace).mockResolvedValue(report)
    vi.mocked(api.saveWorkspace)
      .mockRejectedValueOnce(
        new api.ApiRequestError(409, '利用記録が変わりました', 'preview_changed'),
      )
      .mockRejectedValueOnce(new Error('保存応答が途切れました'))
      .mockImplementation(async (_csrf, request) => ({
        ...workspace,
        revision: 14,
        configuration: request.configuration,
        planning: request.planning,
      }))
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<App />))
    const button = (label: string) =>
      [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent === label,
      )!
    const click = async (label: string) => {
      expect(button(label)).toBeTruthy()
      await act(async () => button(label).click())
    }
    const costs = [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((item) =>
      item.textContent?.includes('支払と配分'),
    )!
    await act(async () => costs.click())
    await click('費用を入力・確認')
    const input = container.querySelector<HTMLInputElement>('[aria-label="未取得利用割合"]')!
    const monthlyInput = container.querySelector<HTMLInputElement>('[aria-label$="claude料金"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '10')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        monthlyInput,
        '7777',
      )
      monthlyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // A rescan may observe another tab's save. It must not adopt that version as
    // the editor's base or replace the fee draft while showing new observed months.
    // Observation alone must not create a saved monthly override.
    vi.mocked(api.getWorkspace).mockResolvedValue({
      ...workspace,
      revision: 13,
      configuration: {
        ...workspace.configuration,
        charges: { claude: 19000, codex: 0 },
        unobservedRatio: 0.2,
      },
      planning: {
        ...workspace.planning,
        profile: { ...workspace.planning.profile, taxYear: 2027 },
      },
      dashboard: {
        ...workspace.dashboard,
        months: [
          ...workspace.dashboard.months,
          { ...workspace.dashboard.months[0]!, label: '2027年1月' },
        ],
      },
    })
    vi.mocked(api.scanHistory).mockResolvedValue({
      completedAt: '2026-09-08T00:00:00.000Z',
      providers: {},
      sources: [],
    })
    await click('戻る')
    await click('戻る')
    await click('戻る')
    await click('履歴を確認して次へ')
    expect(api.scanHistory).toHaveBeenCalled()
    await click('次へ')
    await click('次へ')
    expect(container.querySelector<HTMLInputElement>('[aria-label="未取得利用割合"]')!.value).toBe(
      '10',
    )
    vi.mocked(api.getWorkspace).mockResolvedValue(workspace)
    await click('変更の影響を確認')
    expect(api.previewWorkspace).toHaveBeenLastCalledWith(
      'test-csrf',
      expect.objectContaining({
        expectedRevision: 12,
        configuration: expect.objectContaining({
          unobservedRatio: 0.1,
          monthlyCharges: [expect.objectContaining({ provider: 'claude', amountJpy: 7777 })],
        }),
        planning: expect.objectContaining({ profile: workspace.planning.profile }),
      }),
    )
    expect(api.saveWorkspace).not.toHaveBeenCalled()
    expect(container.textContent).toContain('この表示では保存していません')
    await click('保存せずに戻る')
    expect(input.value).toBe('10')
    await click('変更の影響を確認')
    await click('確認した内容を保存')
    expect(button('確認した内容を保存').disabled).toBe(true)
    expect(container.textContent).toContain('利用記録が変わりました')
    vi.mocked(api.previewWorkspace).mockResolvedValue({ ...report, previewHash: 'b'.repeat(64) })
    await click('影響をもう一度確認')
    expect(button('確認した内容を保存').disabled).toBe(false)
    await click('確認した内容を保存')
    expect(container.textContent).toContain('保存応答が途切れました')
    await click('確認した内容を保存')
    expect(vi.mocked(api.saveWorkspace).mock.calls[1]).toEqual(
      vi.mocked(api.saveWorkspace).mock.calls[2],
    )
    expect(vi.mocked(api.saveWorkspace).mock.calls[2]![1].previewHash).toBe('b'.repeat(64))
    expect(container.textContent).toContain('変更の影響を確認した内容を保存しました')
    expect(input.value).toBe('10')
    let rejectLate: (error: Error) => void = () => {}
    vi.mocked(api.previewWorkspace).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLate = reject
        }),
    )
    await click('変更の影響を確認')
    await click('保存せずに戻る')
    await act(async () =>
      rejectLate(new api.ApiRequestError(409, '遅れて競合', 'workspace_conflict')),
    )
    expect(container.querySelector('#workspace-impact-title')).toBeNull()
    expect(container.querySelector('#workspace-comparison-title')).toBeNull()
    expect(input.value).toBe('10')
    vi.mocked(api.previewWorkspace).mockResolvedValue({
      ...report,
      expectedRevision: 14,
      previewHash: 'c'.repeat(64),
    })
    const savedCount = vi.mocked(api.saveWorkspace).mock.calls.length
    await click('影響を確認して保存')
    expect(api.saveWorkspace).toHaveBeenCalledTimes(savedCount)
    expect(container.querySelector('#workspace-impact-title')).not.toBeNull()
    await click('保存せずに戻る')
    expect(container.textContent).not.toContain('いまの整理結果です')
    expect(input.value).toBe('10')
    await click('影響を確認して保存')
    await click('確認した内容を保存')
    expect(api.saveWorkspace).toHaveBeenCalledTimes(savedCount + 1)
    expect(container.textContent).toContain('いまの整理結果です')
    // The full App flow takes about 0.6s alone but can exceed the 5s default under a parallel run.
  }, 20_000)

  it('shows an actionable failure without synthetic values, and retries the complete load', async () => {
    vi.mocked(dashboard.isLocalRuntime).mockReturnValue(true)
    vi.mocked(api.getRuntime).mockRejectedValueOnce(new Error('接続できません'))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<App />))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('接続できません')
    expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('false')
    expect(container.textContent).not.toContain('Product A')
    expect(dashboard.getDashboardData).not.toHaveBeenCalled()

    const retention = {
      detected: false,
      fileCount: 0,
      autoDelete: { kind: 'none' as const },
      alreadyLosing: false,
    }
    vi.mocked(api.getRuntime).mockResolvedValue({
      csrfToken: 'synthetic-token',
      providers: { claude: { detected: true }, codex: { detected: false } },
      retention: { claude: retention, codex: retention },
    })
    vi.mocked(api.getWorkspace).mockResolvedValue({
      revision: 0,
      dashboard: {
        ...dashboard.demoDashboard,
        meta: { ...dashboard.demoDashboard.meta, source: 'local' },
      },
      configuration: {
        charges: { claude: 8000, codex: 0 },
        monthlyCharges: [],
        contracts: { claude: {}, codex: {} },
        chargePeriods: [],
        unobservedRatio: 0,
      },
      planning: dashboard.demoPlanning,
      diagnosis: dashboard.demoDiagnosis,
    })
    vi.mocked(api.getFolders).mockResolvedValue({ folders: [] })
    vi.mocked(api.getHistorySources).mockResolvedValue({ sources: [] })
    vi.mocked(api.getScanProgress).mockResolvedValue({
      running: false,
      provider: null,
      filesScanned: 0,
    })
    const button = container.querySelector('button')!
    expect(button.textContent).toBe('もう一度読み込む')
    await act(async () => button.click())
    expect(container.textContent).not.toContain('ローカルデータを読み込めませんでした')
    expect(api.getRuntime).toHaveBeenCalledTimes(2)
    expect(api.getWorkspace).toHaveBeenCalledTimes(2)
    expect(dashboard.getDashboardData).not.toHaveBeenCalled()
  })

  it.each([false, true, 'different-dataset', 'conflict'])(
    'retains the save request and retries after remount: %s',
    async (remount) => {
      const datasetId = crypto.randomUUID()
      vi.mocked(dashboard.isLocalRuntime).mockReturnValue(true)
      const retention = {
        detected: false,
        fileCount: 0,
        autoDelete: { kind: 'none' as const },
        alreadyLosing: false,
      }
      vi.mocked(api.getRuntime).mockResolvedValue({
        datasetId,
        csrfToken: 'test-csrf',
        providers: { claude: { detected: true }, codex: { detected: false } },
        retention: { claude: retention, codex: retention },
      })
      const workspace = {
        revision: 12,
        dashboard: {
          ...dashboard.demoDashboard,
          meta: { ...dashboard.demoDashboard.meta, source: 'local' as const },
        },
        configuration: {
          charges: { claude: 8000, codex: 0 },
          monthlyCharges: [],
          contracts: { claude: {}, codex: {} },
          chargePeriods: [],
          unobservedRatio: null,
        },
        planning: dashboard.demoPlanning,
        diagnosis: dashboard.demoDiagnosis,
      }
      vi.mocked(api.getWorkspace).mockResolvedValue(workspace)
      vi.mocked(api.getFolders).mockResolvedValue({ folders: [] })
      vi.mocked(api.getHistorySources).mockResolvedValue({ sources: [] })
      vi.mocked(api.getScanProgress).mockResolvedValue({
        running: false,
        provider: null,
        filesScanned: 0,
      })
      vi.mocked(api.saveWorkspace)
        .mockRejectedValueOnce(new Error('通信が途切れました'))
        .mockResolvedValue({ ...workspace, revision: 14 })
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value: vi.fn(),
      })
      container = document.createElement('div')
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root!.render(<App />))
      const click = async (label: string) => {
        const button = [...container!.querySelectorAll('button')].find(
          (item) => item.textContent === label,
        )!
        expect(button).toBeTruthy()
        await act(async () => button.click())
      }
      const costs = [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((item) =>
        item.textContent?.includes('支払と配分'),
      )!
      await act(async () => costs.click())
      await click('費用を入力・確認')
      await click('ここまで保存')
      expect(container.textContent).toContain('通信が途切れました')
      expect(api.saveWorkspace).toHaveBeenCalledOnce()
      expect(api.saveWorkspace).toHaveBeenLastCalledWith(
        'test-csrf',
        expect.objectContaining({
          expectedRevision: 12,
          requestId: expect.any(String),
          planning: workspace.planning,
          configuration: expect.objectContaining({ unobservedRatio: null }),
        }),
      )
      if (remount) {
        const pending = listWorkspaceAttempts(localStorage, datasetId).records
        expect(pending).toHaveLength(1)
        expect(pending[0]!.request).toEqual(vi.mocked(api.saveWorkspace).mock.calls[0]![1])
        await act(async () => root!.unmount())
        root = createRoot(container)
        await act(async () => root!.render(<App />))
        const close = container.querySelector<HTMLButtonElement>('[aria-label="閉じる"]')
        if (close) await act(async () => close.click())
        await click('料金・計画の保存要求を確認')
        if (remount === 'different-dataset')
          vi.mocked(api.getRuntime).mockResolvedValueOnce({
            ...(await api.getRuntime()),
            datasetId: crypto.randomUUID(),
          })
        if (remount === 'conflict')
          vi.mocked(api.saveWorkspace).mockRejectedValueOnce(
            new api.ApiRequestError(409, '保存元が変わっています', 'workspace_conflict'),
          )
        await click('この料金・計画の保存を再確認する')
        if (remount === 'different-dataset') {
          expect(api.saveWorkspace).toHaveBeenCalledOnce()
          expect(container.textContent).toContain('接続先の資料が変わっています')
          expect(listWorkspaceAttempts(localStorage, datasetId).records).toHaveLength(1)
          return
        }
        if (remount === 'conflict') {
          expect(api.saveWorkspace).toHaveBeenCalledTimes(2)
          expect(container.textContent).toContain('最新との比較で確認してください')
          expect(listWorkspaceAttempts(localStorage, datasetId).records).toHaveLength(1)
          return
        }
        expect(vi.mocked(api.saveWorkspace).mock.calls[1]).toEqual(
          vi.mocked(api.saveWorkspace).mock.calls[0],
        )
        expect(listWorkspaceAttempts(localStorage, datasetId).records).toEqual([])
        expect(container.textContent).toContain('保存結果を確認しました')
        return
      }
      await click('ここまで保存')
      expect(api.saveWorkspace).toHaveBeenCalledTimes(2)
      expect(vi.mocked(api.saveWorkspace).mock.calls[1]).toEqual(
        vi.mocked(api.saveWorkspace).mock.calls[0],
      )
      expect(container.textContent).toContain('ここまでの入力を保存しました')
      await click('ここまで保存')
      expect(vi.mocked(api.saveWorkspace).mock.calls[2]![1].expectedRevision).toBe(14)
      expect(vi.mocked(api.saveWorkspace).mock.calls[2]![1].requestId).not.toBe(
        vi.mocked(api.saveWorkspace).mock.calls[0]![1].requestId,
      )
    },
  )

  it('compares conflicts without losing input, rereads after another conflict, and retries the selected merge', async () => {
    vi.mocked(dashboard.isLocalRuntime).mockReturnValue(true)
    const retention = {
      detected: false,
      fileCount: 0,
      autoDelete: { kind: 'none' as const },
      alreadyLosing: false,
    }
    vi.mocked(api.getRuntime).mockResolvedValue({
      csrfToken: 'test-csrf',
      providers: { claude: { detected: true }, codex: { detected: false } },
      retention: { claude: retention, codex: retention },
    })
    const base: WorkspaceView = {
      revision: 12,
      dashboard: {
        ...dashboard.demoDashboard,
        meta: { ...dashboard.demoDashboard.meta, source: 'local' },
      },
      configuration: {
        charges: { claude: 8000, codex: 0 },
        monthlyCharges: [],
        contracts: { claude: {}, codex: {} },
        chargePeriods: [],
        unobservedRatio: 0,
      },
      planning: structuredClone(dashboard.demoPlanning),
      diagnosis: dashboard.demoDiagnosis,
    }
    const latest = structuredClone(base)
    latest.revision = 14
    latest.configuration.unobservedRatio = 0.2
    latest.planning.profile.notes = '別画面で追加したメモ'
    const newer = structuredClone(latest)
    newer.revision = 16
    newer.configuration.unobservedRatio = 0.25
    newer.planning.profile.notes = 'さらに更新されたメモ'
    vi.mocked(api.getWorkspace).mockResolvedValue(base)
    vi.mocked(api.getFolders).mockResolvedValue({ folders: [] })
    vi.mocked(api.getHistorySources).mockResolvedValue({ sources: [] })
    vi.mocked(api.getScanProgress).mockResolvedValue({
      running: false,
      provider: null,
      filesScanned: 0,
    })
    const conflict = () =>
      new api.ApiRequestError(409, '別の画面で保存されています', 'workspace_conflict')
    vi.mocked(api.saveWorkspace)
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(new Error('応答が途切れました'))
      .mockImplementation(async (_csrf, request) => ({
        ...newer,
        revision: 18,
        configuration: request.configuration,
        planning: request.planning,
      }))
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<App />))
    const button = (label: string) =>
      [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent === label,
      )!
    const click = async (label: string) => {
      expect(button(label)).toBeTruthy()
      await act(async () => button(label).click())
    }
    const costs = [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((item) =>
      item.textContent?.includes('支払と配分'),
    )!
    await act(async () => costs.click())
    await click('費用を入力・確認')
    const input = container.querySelector<HTMLInputElement>('[aria-label="未取得利用割合"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '10')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    vi.mocked(api.getWorkspace)
      .mockRejectedValueOnce(new Error('最新の読込に失敗'))
      .mockResolvedValue(latest)
    await click('ここまで保存')
    expect(container.textContent).toContain('最新の読込に失敗')
    await click('最新の内容をもう一度読む')
    expect(container.textContent).toContain('別画面で追加したメモ')
    expect(button('選んだ内容を保存').disabled).toBe(true)
    await click('入力を保持して戻る')
    expect(input.value).toBe('10')
    expect(vi.mocked(api.saveWorkspace)).toHaveBeenCalledTimes(1)
    await click('ここまで保存')
    expect(vi.mocked(api.saveWorkspace).mock.calls[1]).toEqual(
      vi.mocked(api.saveWorkspace).mock.calls[0],
    )
    const chooseLocal = async () => {
      const group = [...container!.querySelectorAll('fieldset')].find((item) =>
        item.querySelector('legend')?.textContent?.startsWith('捕捉外の利用割合'),
      )!
      const radio = group.querySelector<HTMLInputElement>('input[type="radio"]')!
      await act(async () => radio.click())
    }
    await chooseLocal()
    expect(button('選んだ内容を保存').disabled).toBe(false)
    vi.mocked(api.getWorkspace).mockResolvedValue(newer)
    await click('選んだ内容を保存')
    expect(vi.mocked(api.saveWorkspace).mock.calls[2]![1]).toMatchObject({
      expectedRevision: 14,
      configuration: { unobservedRatio: 0.1 },
      planning: { profile: { notes: '別画面で追加したメモ' } },
    })
    expect(container.textContent).toContain('さらに更新されたメモ')
    expect(button('選んだ内容を保存').disabled).toBe(true)
    await chooseLocal()
    await click('選んだ内容を保存')
    expect(container.textContent).toContain('応答が途切れました')
    await click('選んだ内容を保存')
    expect(vi.mocked(api.saveWorkspace).mock.calls[4]).toEqual(
      vi.mocked(api.saveWorkspace).mock.calls[3],
    )
    expect(vi.mocked(api.saveWorkspace).mock.calls[4]![1]).toMatchObject({
      expectedRevision: 16,
      configuration: { unobservedRatio: 0.1 },
      planning: { profile: { notes: 'さらに更新されたメモ' } },
    })
    expect(container.textContent).toContain('比較して選んだ内容を保存しました')
    expect(container.querySelector('#workspace-comparison-title')).toBeNull()
    expect(input.value).toBe('10')
  })
  it.each([false, true])(
    'recovers workspace input after remount; already saved: %s',
    async (alreadySaved) => {
      const datasetId = crypto.randomUUID()
      vi.mocked(dashboard.isLocalRuntime).mockReturnValue(true)
      vi.mocked(api.getRuntime).mockResolvedValue({
        datasetId,
        csrfToken: 'test',
        providers: { claude: { detected: false }, codex: { detected: false } },
        retention: { claude: { autoDelete: { kind: 'none' } }, codex: {} },
      } as Awaited<ReturnType<typeof api.getRuntime>>)
      const base: WorkspaceView = {
        revision: 1,
        configuration: {
          charges: { claude: 0, codex: 0 },
          monthlyCharges: [],
          contracts: { claude: {}, codex: {} },
          chargePeriods: [],
          unobservedRatio: 0,
        },
        planning: emptyPlanningSnapshot(2026),
        diagnosis: dashboard.demoDiagnosis,
        dashboard: {
          ...dashboard.demoDashboard,
          meta: { ...dashboard.demoDashboard.meta, source: 'local' },
        },
      }
      vi.mocked(api.getWorkspace).mockResolvedValue(base)
      vi.mocked(api.getFolders).mockResolvedValue({ folders: [] })
      vi.mocked(api.getHistorySources).mockResolvedValue({ sources: [] })
      vi.mocked(api.getScanProgress).mockResolvedValue({
        running: false,
        provider: null,
        filesScanned: 0,
      })
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value: vi.fn(),
      })
      async function mount() {
        container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        await act(async () => root!.render(<App />))
        const costs = [...container!.querySelectorAll<HTMLButtonElement>('nav button')].find(
          (item) => item.textContent?.includes('支払と配分'),
        )!
        await act(async () => costs.click())
        await click('費用を入力・確認')
      }
      async function click(label: string) {
        const button = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
          (item) => item.textContent === label,
        )!
        expect(button).toBeTruthy()
        expect(button.disabled).toBe(false)
        await act(async () => button.click())
      }
      await mount()
      const input = container!.querySelector<HTMLInputElement>('[aria-label="未取得利用割合"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          '12.34',
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(
        listWorkspaceRecovery(localStorage, datasetId).records[0]?.input.unobservedPercent,
      ).toBe(12.34)
      await act(async () => root!.unmount())
      root = undefined
      container!.remove()
      const latest = structuredClone(base)
      latest.planning.profile.notes = '別画面で変更した保存内容'
      if (alreadySaved) {
        const recovered = listWorkspaceRecovery(localStorage, datasetId).records[0]!
        latest.configuration.unobservedRatio = 0.1234
        latest.configuration.monthlyCharges = recovered.input.monthlyCharges
        latest.planning = recovered.input.planning
      }
      vi.mocked(api.getWorkspace).mockResolvedValue(latest)
      await mount()
      await click('料金・計画の控えを確認')
      await click('料金・計画を復旧して編集')
      expect(
        container!.querySelector<HTMLInputElement>('[aria-label="未取得利用割合"]')!.value,
      ).toBe('12.34')
      expect(api.saveWorkspace).not.toHaveBeenCalled()
      await click('ここまで保存')
      if (alreadySaved) {
        expect(api.saveWorkspace).not.toHaveBeenCalled()
        expect(listWorkspaceRecovery(localStorage, datasetId).records).toEqual([])
        return
      }
      expect(container!.textContent).toContain('別画面で変更した保存内容')
      expect(container!.textContent).toContain('選んだ内容を保存')
      expect(api.saveWorkspace).not.toHaveBeenCalled()
    },
  )
})
