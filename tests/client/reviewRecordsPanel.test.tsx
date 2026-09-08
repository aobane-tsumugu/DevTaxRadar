// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReviewRecordsPanel from '../../src/client/pages/ReviewRecordsPanel'
import {
  getBalanceReview,
  getBalanceReviews,
  getReviewComparison,
  getReviewImpact,
} from '../../src/client/api'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace'
import { buildAnnualBalances } from '../../src/core/annualBalances'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { projectAnnualCosts } from '../../src/core/costProjection'
vi.mock('../../src/client/api', () => ({
  getBalanceReviews: vi.fn(),
  getBalanceReview: vi.fn(),
  getReviewComparison: vi.fn(),
  getReviewImpact: vi.fn(),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
describe('stored year record downloads', () => {
  it('reads the requested immutable record, preserves unknowns and rejects a mismatched response', async () => {
    const snapshot: BalanceReview['snapshot'] = {
      version: 1,
      accounts: [
        {
          id: 'a',
          name: '当時の資産',
          taxUnitId: 'u',
          kind: 'asset',
          openingYear: 2026,
          opening: { status: 'unknown', amountJpy: null, reasons: ['当時の未確認'] },
        },
      ],
      movements: [],
      pendingDecisions: [],
    }
    const review: BalanceReview = {
      schemaVersion: 1,
      engineVersion: 'annual-balances/1',
      id: 'fixed',
      createdAt: '2026-09-08T00:00:00Z',
      year: 2026,
      draftRevision: 1,
      correctsReviewId: null,
      previousReviewId: null,
      reason: '当時の採用理由',
      snapshot,
      projection: buildAnnualBalances(snapshot, 2026),
    }
    vi.mocked(getBalanceReviews).mockResolvedValue({
      reviews: [{ id: 'fixed', year: 2026, active: false, previousYearChanged: false }],
    })
    vi.mocked(getBalanceReview).mockResolvedValue({ review })
    await render()
    await load()
    expect(getBalanceReview).not.toHaveBeenCalled()
    const open = () =>
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'この保存版を読む',
      )!
    await act(async () => open().click())
    expect(getBalanceReview).toHaveBeenCalledWith('fixed')
    const saved = container.querySelector('[aria-label="保存版の内容"]')!
    expect(saved.textContent).toContain('当時の採用理由')
    expect(saved.textContent).toContain('期末: 不明（当時の未確認）')
    expect(saved.textContent).toContain('旧版のため当時の費用・判断・利用量は含まれません')
    expect(getReviewComparison).not.toHaveBeenCalled()
    vi.mocked(getBalanceReview).mockResolvedValue({ review: { ...review, id: 'wrong' } })
    await act(async () => open().click())
    expect(container.querySelector('[aria-label="保存版の内容"]')).toBeNull()
    expect(container.textContent).toContain('資料IDが一致しません')
    vi.mocked(getBalanceReview).mockResolvedValue({ review })
    await act(async () => open().click())
    expect(container.querySelector('[aria-label="保存版の内容"]')).not.toBeNull()
    const planning = emptyPlanningSnapshot(2026)
    planning.equipmentMethods = [
      {
        id: 'method',
        equipmentId: 'pc',
        taxYear: 2026,
        taxpayer: 'unknown',
        assetKind: 'unknown',
        method: 'unknown',
        methodReason: '',
        usefulLifeYears: null,
        useThroughYearEnd: 'unknown',
        ordinaryTreatment: 'unknown',
        priorClosing: null,
        recordedAt: '2026-09-08T00:00:00Z',
        allocation: {
          businessUseRatio: 0.8,
          projectAllocationRatio: null,
          reason: '保存時の配分根拠',
          targets: [
            { taxUnitId: 'u', shareBps: 2500 },
            { taxUnitId: 'v', shareBps: null },
          ],
        },
      },
    ]
    planning.equipmentMethods.push({
      ...planning.equipmentMethods[0]!,
      id: 'future',
      taxYear: 2027,
      allocation: { ...planning.equipmentMethods[0]!.allocation!, reason: '翌年だけの根拠' },
    })
    planning.homeCosts = [
      {
        id: 'home',
        month: '2026-07',
        category: 'rent',
        amountJpy: null,
        unknownAmountReason: '当時の支払確認待ち',
        method: 'area',
        businessUseRatio: 0.5,
        basis: '当時の面積',
        rationale: '当時の理由',
        projectAllocationRatio: 0.8,
        treatment: 'shared',
        evidenceIds: [],
        targets: [
          { taxUnitId: 'u', shareBps: 2500 },
          { taxUnitId: 'v', shareBps: null },
        ],
      },
      {
        id: 'future-home',
        month: '2027-01',
        category: 'rent',
        amountJpy: 100,
        method: 'area',
        businessUseRatio: 0.5,
        basis: '翌年の面積',
        rationale: '翌年の理由',
        projectAllocationRatio: 1,
        treatment: 'general',
        evidenceIds: [],
      },
    ]
    planning.directCosts = [
      {
        id: 'direct',
        incurredOn: '2026-07-01',
        costType: 'cloud',
        amountJpy: null,
        unknownAmountReason: '当時の直接費確認待ち',
        treatment: 'shared',
        directlyAttributable: false,
        note: '配分のメモ',
        evidenceIds: [],
        targets: [
          { taxUnitId: 'u', shareBps: 2500 },
          { taxUnitId: 'v', shareBps: null },
        ],
      },
    ]
    planning.directCosts.push({
      ...planning.directCosts[0]!,
      id: 'future-direct',
      incurredOn: '2027-07-01',
      note: '翌年の直接費メモ',
    })
    review.materials = {
      schemaVersion: 1,
      engineVersion: 'review-materials/1',
      year: 2026,
      workspaceRevision: 1,
      timeZone: 'Asia/Tokyo',
      planning,
      configuration: {
        charges: { claude: 0, codex: 0 },
        contracts: { claude: {}, codex: {} },
        monthlyCharges: [],
        chargePeriods: [],
        unobservedRatio: null,
      },
      observations: [],
      recentScans: [],
      scanTimeZones: {},
      costs: projectAnnualCosts(
        { version: 1, taxUnits: [], sources: [], bases: [], contributions: [] },
        2026,
      ),
      referenceCheck: { engineVersion: 'balance-references/1', status: 'consistent', issues: [] },
      taxTreatmentVerified: false,
    }
    vi.mocked(getBalanceReview).mockResolvedValue({ review })
    await act(async () => open().click())
    const allocation = container.querySelector('[aria-label="設備の年度別配分根拠"]')!
    expect(allocation.textContent).toContain('保存時の配分根拠')
    expect(allocation.textContent).toContain('業務分の割合: 25%')
    expect(allocation.textContent).toContain('制作物ID v / 業務分の割合: 未確認')
    expect(allocation.textContent).not.toContain('翌年だけの根拠')
    expect(allocation.textContent).toContain('名称未収録 / 制作物ID v')
    planning.taxUnits = [
      {
        id: 'u',
        name: '保存時の制作物<img>',
        unitType: 'new-software',
        usageMode: 'internal',
        revenueModel: 'efficiency',
        lifecycleStatus: 'developing',
      },
    ]
    planning.equipment = [
      {
        id: 'pc',
        name: '保存時のPC<img>',
        equipmentType: 'pc',
        acquisitionCostJpy: 100,
        acquiredOn: '2026-01-01',
        convertedFromPrivate: false,
        businessUseRatio: 1,
        role: '',
        projectAllocationRatio: 1,
        evidenceIds: [],
      },
    ]
    await act(async () => open().click())
    const named = container.querySelector('[aria-label="設備の年度別配分根拠"]')!
    expect(named.textContent).toContain('保存時のPC<img> / 2026年 / 設備ID pc')
    expect(named.textContent).toContain('保存時の制作物<img> / 制作物ID u')
    expect(named.textContent).toContain('名称未収録 / 制作物ID v')
    expect(named.querySelector('img')).toBeNull()
    const home = container.querySelector('[aria-label="自宅費用の配分根拠"]')!
    expect(home.textContent).toContain('支払原額: 不明 / 理由: 当時の支払確認待ち')
    expect(home.textContent).toContain('保存時の制作物<img> / 制作物ID u / 業務分の割合: 25%')
    expect(home.textContent).toContain('名称未収録 / 制作物ID v / 業務分の割合: 未確認')
    expect(home.textContent).not.toContain('翌年の理由')
    expect(home.querySelector('input,button,img')).toBeNull()
    const direct = container.querySelector('[aria-label="直接費の配分根拠"]')!
    expect(direct.textContent).toContain('記録額: 不明 / 理由: 当時の直接費確認待ち')
    expect(direct.textContent).toContain('保存時の制作物<img> / 制作物ID u / 割合: 25%')
    expect(direct.textContent).toContain('名称未収録 / 制作物ID v / 割合: 未確認')
    expect(direct.textContent).not.toContain('翌年の直接費メモ')
    expect(direct.querySelector('input,button,img')).toBeNull()

    expect(container.querySelector('[aria-label="全費用の原額と配分"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="全費用の原額と配分"]')!.textContent).toContain(
      '指定した保存版に固定された配分資料',
    )
    expect(container.querySelector('[aria-label="全費用の原額と配分"]')!.textContent).not.toContain(
      '作業中の配分資料',
    )
    expect(getReviewComparison).not.toHaveBeenCalled()
  })
  it('shows each saved year impact and keeps unknown balances out of numerical deltas', async () => {
    vi.mocked(getReviewImpact).mockResolvedValue({
      kind: 'current-input-vs-saved-years',
      years: [
        {
          engineVersion: 'review-comparison/1',
          reviewId: 'later',
          year: 2027,
          beforeDraftRevision: 1,
          currentDraftRevision: 2,
          currentWorkspaceRevision: 3,
          currentPreviewHash: 'hash',
          currentReviewId: 'later',
          previousReviewChanged: true,
          priorChainChanged: true,
          materialCoverage: 'both',
          changes: [],
          balanceImpact: [
            {
              accountId: 'a',
              name: '合成資産',
              opening: {
                before: { status: 'known', amountJpy: 90 },
                after: { status: 'known', amountJpy: 80 },
                deltaJpy: -10,
              },
              closing: {
                before: { status: 'unknown', amountJpy: null, reasons: ['確認待ち'] },
                after: null,
                deltaJpy: null,
              },
            },
          ],
        },
      ],
    })
    await render()
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '保存済み各年への影響を確認')!
        .click(),
    )
    expect(container.textContent).toContain('2027年は過年度の訂正が未反映')
    expect(container.textContent).toContain('-10円')
    expect(container.textContent).toContain('未算定（不明または片方に記録なし）')
    expect(container.textContent).toContain('保存済み資料を自動更新しません')
  })
  let root: Root | undefined
  let container: HTMLDivElement
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    container?.remove()
    vi.resetAllMocks()
  })
  async function render() {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<ReviewRecordsPanel />))
  }
  async function load() {
    await act(async () => container.querySelector('button')!.click())
  }
  it('loads exact record download links and distinguishes current, past and affected prior-year records', async () => {
    vi.mocked(getBalanceReviews).mockResolvedValue({
      reviews: [
        { id: 'current', year: 2026, active: true, previousYearChanged: true },
        { id: 'old', year: 2026, active: false, previousYearChanged: false },
      ],
    })
    await render()
    expect(getBalanceReviews).not.toHaveBeenCalled()
    await load()
    expect(container.textContent).toContain('読込時の現行版')
    expect(container.textContent).toContain('過去の保存版')
    expect(container.textContent).toContain('前年資料の変更が未反映')
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/api/balances/reviews/current/export?format=markdown',
      '/api/balances/reviews/current/export?format=json',
      '/api/balances/reviews/old/export?format=markdown',
      '/api/balances/reviews/old/export?format=json',
    ])
    expect([...container.querySelectorAll('a')].every((a) => a.hasAttribute('download'))).toBe(true)
  })
  it('does not turn a failed read into an empty collection and allows retry', async () => {
    vi.mocked(getBalanceReviews).mockRejectedValueOnce(new Error('読取失敗'))
    await render()
    await load()
    expect(container.textContent).toContain('読取失敗')
    expect(container.textContent).not.toContain('保存済みの年度資料はありません')
    vi.mocked(getBalanceReviews).mockResolvedValue({ reviews: [] })
    await load()
    expect(container.textContent).toContain('保存済みの年度資料はありません')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('compares the chosen saved record and shows unknown and zero without a false complete comparison', async () => {
    vi.mocked(getBalanceReviews).mockResolvedValue({
      reviews: [{ id: 'saved', year: 2026, active: true, previousYearChanged: false }],
    })
    vi.mocked(getReviewComparison).mockResolvedValue({
      engineVersion: 'review-comparison/1',
      reviewId: 'saved',
      year: 2026,
      beforeDraftRevision: 1,
      currentDraftRevision: 2,
      currentWorkspaceRevision: 3,
      currentPreviewHash: 'hash',
      currentReviewId: 'saved',
      previousReviewChanged: true,
      materialCoverage: 'missing-stored',
      balanceImpact: [],
      changes: [
        {
          path: ['balanceInputs', 'accounts', 'a', 'opening', 'amountJpy'],
          operation: 'changed',
          before: null,
          after: 0,
        },
      ],
    })
    await render()
    await load()
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '現在の保存入力との差を確認')!
        .click(),
    )
    expect(getReviewComparison).toHaveBeenCalledWith('saved')
    expect(container.textContent).toContain('この画面の未保存入力は含みません')
    expect(container.textContent).toContain('この部分は比較できません')
    expect(container.textContent).toContain('それ以前の訂正が前年資料に未反映')
    expect(container.textContent).toContain('年度をさかのぼって引継ぎを確認')
    expect([...container.querySelectorAll('pre')].map((p) => p.textContent)).toEqual([
      '不明・未設定',
      '0',
    ])
  })
})
