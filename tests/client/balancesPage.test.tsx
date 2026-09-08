// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BalancesPage from '../../src/client/pages/BalancesPage'
import * as api from '../../src/client/api'
import type { BalanceDraft } from '../../src/accounting/balanceWorkspace'
import { demoPlanning } from '../../src/client/dashboard'
import { listRecoveries } from '../../src/client/balanceRecovery'

vi.mock('../../src/client/api', async (original) => ({
  ...(await original<typeof api>()),
  getBalanceDraft: vi.fn(),
  saveBalanceDraft: vi.fn(),
  getRuntime: vi.fn(),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function fixture(): BalanceDraft {
  return {
    revision: 3,
    snapshot: {
      version: 1,
      accounts: [
        {
          id: 'a',
          name: '制作中のアプリ',
          taxUnitId: 'unit',
          kind: 'construction',
          openingYear: 2026,
          opening: { status: 'known', amountJpy: 100 },
        },
        {
          id: 'b',
          name: '利用開始したアプリ',
          taxUnitId: 'unit',
          kind: 'asset',
          openingYear: 2026,
          opening: { status: 'known', amountJpy: 0 },
        },
      ],
      movements: [],
      pendingDecisions: [],
    },
  }
}
const planning = structuredClone(demoPlanning)
planning.profile.taxYear = 2026
planning.taxUnits = [{ ...planning.taxUnits[0]!, id: 'unit', name: '合成アプリ' }]
planning.decisions = [
  {
    id: 'decision',
    taxUnitId: 'unit',
    taxYear: 2026,
    engineVersion: 'synthetic/1',
    candidate: '合成の判断',
    selectedCandidate: '合成の判断',
    status: 'confirmed',
    createdAt: '2026-01-01T00:00:00Z',
    confirmedAt: '2026-01-01T00:00:00Z',
    reason: '合成の確認',
  },
]
planning.directCosts = [
  {
    id: 'source',
    incurredOn: '2026-01-01',
    costType: 'domain',
    amountJpy: 100,
    directlyAttributable: true,
    treatment: 'direct',
    taxUnitId: 'unit',
    evidenceIds: [],
  },
]

describe('balance editor', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    root = undefined
    container?.remove()
    vi.resetAllMocks()
    localStorage.clear()
  })
  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === name)!
  const field = (name: string) =>
    [...container.querySelectorAll('label')]
      .find((l) => l.textContent?.trim().startsWith(name))!
      .querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input,select,textarea',
      )!
  async function fill(name: string, value: string) {
    const input = field(name)
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(
        input,
        value,
      )
      input.dispatchEvent(
        new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
      )
    })
  }
  async function render(
    datasetId?: string,
    onReviewAnswer?: import('react').ComponentProps<typeof BalancesPage>['onReviewAnswer'],
  ) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    vi.mocked(api.getRuntime).mockResolvedValue({ csrfToken: 'test', datasetId } as Awaited<
      ReturnType<typeof api.getRuntime>
    >)
    vi.mocked(api.saveBalanceDraft).mockImplementation(async (_token, snapshot, revision) => ({
      snapshot,
      revision: revision + 1,
      ...(datasetId ? { datasetId } : {}),
    }))
    await act(async () =>
      root!.render(
        <BalancesPage
          onReviewAnswer={onReviewAnswer}
          datasetId={datasetId}
          planning={planning}
          configuration={null}
          local
          onManageUnits={() => {}}
        />,
      ),
    )
  }
  it('opens the answer context without saving or discarding the balance draft', async () => {
    const draft = fixture()
    draft.snapshot.pendingDecisions = [
      {
        id: 'q',
        taxYear: 2026,
        taxUnitId: 'unit',
        amount: { status: 'known', amountJpy: 0 },
        accountIds: [],
        sourceIds: [],
        reasons: ['用途の確認'],
        answers: [
          {
            id: 'a',
            taxYear: 2027,
            receivedOn: '2027-02-01',
            kind: 'method',
            answer: '元の回答',
            source: '確認先',
          },
        ],
      },
    ]
    vi.mocked(api.getBalanceDraft).mockResolvedValue(draft)
    const open = vi.fn()
    await render(undefined, open)
    await fill('記録開始年の期首額', '200')
    await fill('回答内容', '未保存の回答')
    await act(async () => button('この回答を見ながら事実・判断を見直す').click())
    expect(open).toHaveBeenCalledWith({
      pendingId: 'q',
      taxUnitId: 'unit',
      question: '用途の確認',
      answer: expect.objectContaining({
        id: 'a',
        taxYear: 2027,
        kind: 'method',
        answer: '未保存の回答',
      }),
    })
    expect((field('記録開始年の期首額') as HTMLInputElement).value).toBe('200')
    expect((field('回答内容') as HTMLTextAreaElement).value).toBe('未保存の回答')
    expect(api.saveBalanceDraft).not.toHaveBeenCalled()
    expect(api.getBalanceDraft).toHaveBeenCalledTimes(1)
    expect(draft.snapshot.pendingDecisions[0]!.answers![0]!.answer).toBe('元の回答')
  })
  it('opens the requested overview year while retaining edits and avoiding another data load', async () => {
    vi.mocked(api.getBalanceDraft).mockResolvedValue(fixture())
    await render()
    await fill('記録開始年の期首額', '200')
    await fill('残高を確認する年', '2028')
    const navigate = async (request: number, datasetId?: string) =>
      act(async () =>
        root!.render(
          <BalancesPage
            planning={planning}
            configuration={null}
            local
            onManageUnits={() => {}}
            navigation={{ year: 2027, request, datasetId }}
          />,
        ),
      )
    await navigate(1)
    expect(field('残高を確認する年').value).toBe('2027')
    expect(field('記録開始年の期首額').value).toBe('200')
    expect(button('作業中の残高を保存').disabled).toBe(false)
    expect(api.getBalanceDraft).toHaveBeenCalledOnce()
    expect(api.saveBalanceDraft).not.toHaveBeenCalled()
    await fill('残高を確認する年', '2028')
    await navigate(1)
    expect(field('残高を確認する年').value).toBe('2028')
    await navigate(2, 'another-dataset')
    expect(field('残高を確認する年').value).toBe('2028')
    await navigate(3)
    expect(field('残高を確認する年').value).toBe('2027')
    expect(field('記録開始年の期首額').value).toBe('200')
  })
  it.each([3, 4])(
    'recovers unfinished input and compares changed saved contents even at revision %s',
    async (latestRevision) => {
      const datasetId = crypto.randomUUID()
      const base = { ...fixture(), datasetId }
      vi.mocked(api.getBalanceDraft).mockResolvedValue(base)
      await render(datasetId)
      await fill('残高名', '復旧する入力')
      await fill('記録開始年の期首額', '')
      await fill('記録開始年', '')
      expect(
        Number.isNaN(
          listRecoveries(localStorage, datasetId).records[0]!.snapshot.accounts[0]!.openingYear,
        ),
      ).toBe(true)
      await act(async () => root!.unmount())
      root = undefined
      container.remove()
      const latest = structuredClone(base)
      latest.revision = latestRevision
      latest.snapshot.accounts[0]!.name = '別画面で保存'
      vi.mocked(api.getBalanceDraft).mockResolvedValue(latest)
      await render(datasetId)
      await act(async () => button('復旧できる入力を確認').click())
      await act(async () => button('この入力を復旧して確認').click())
      expect(container.textContent).toContain('復旧する入力')
      expect(container.textContent).toContain('別画面で保存')
      expect(field('記録開始年の期首額').value).toBe('')
      expect(api.saveBalanceDraft).not.toHaveBeenCalled()
      expect(button('作業中の残高を保存').disabled).toBe(true)
    },
  )
  it('reuses the durable request id after closing on a failed save and removes only the recovered copies on success', async () => {
    const datasetId = crypto.randomUUID()
    vi.mocked(api.getBalanceDraft).mockResolvedValue({ ...fixture(), datasetId })
    await render(datasetId)
    await fill('残高名', '応答待ちの入力')
    vi.mocked(api.saveBalanceDraft).mockRejectedValueOnce(new Error('通信失敗'))
    await act(async () => button('作業中の残高を保存').click())
    const requestId = vi.mocked(api.saveBalanceDraft).mock.calls[0]![3]
    expect(listRecoveries(localStorage, datasetId).records[0]!.saveAttempt?.requestId).toBe(
      requestId,
    )
    await act(async () => root!.unmount())
    root = undefined
    container.remove()
    await render(datasetId)
    await act(async () => button('復旧できる入力を確認').click())
    await act(async () => button('この入力を復旧して確認').click())
    await act(async () => button('作業中の残高を保存').click())
    expect(vi.mocked(api.saveBalanceDraft).mock.lastCall![3]).toBe(requestId)
    expect(listRecoveries(localStorage, datasetId).records).toEqual([])
  })
  it('reports unavailable recovery storage without losing input and refuses to save into a changed dataset', async () => {
    const datasetId = crypto.randomUUID()
    vi.mocked(api.getBalanceDraft).mockResolvedValue({ ...fixture(), datasetId })
    await render(datasetId)
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      await fill('残高名', '画面に保持する入力')
      expect(container.textContent).toContain('復旧用の控えを保存できません')
      expect(field('残高名').value).toBe('画面に保持する入力')
    } finally {
      storage.mockRestore()
    }
    vi.mocked(api.getRuntime).mockResolvedValue({
      csrfToken: 'other',
      datasetId: crypto.randomUUID(),
    } as Awaited<ReturnType<typeof api.getRuntime>>)
    await act(async () => button('作業中の残高を保存').click())
    expect(api.saveBalanceDraft).not.toHaveBeenCalled()
    expect(container.textContent).toContain('接続中の保存資料が変わっています')
    expect(field('残高名').value).toBe('画面に保持する入力')
  })
  it('preserves unknown openings and reasons, distinguishes confirmed zero, and shows the selected year', async () => {
    vi.mocked(api.getBalanceDraft).mockResolvedValue(fixture())
    await render()
    await act(async () => button('期首額を不明に戻す').click())
    await fill('期首額が不明な理由', '前年度の資料確認待ち')
    await fill('残高を確認する年', '2027')
    expect(container.textContent).toContain('2027年の残高増減')
    expect(container.textContent).toContain('不明：前年度の資料確認待ち')
    await act(async () => button('作業中の残高を保存').click())
    expect(api.saveBalanceDraft).toHaveBeenLastCalledWith(
      'test',
      expect.objectContaining({
        accounts: expect.arrayContaining([
          expect.objectContaining({
            id: 'a',
            opening: { status: 'unknown', amountJpy: null, reasons: ['前年度の資料確認待ち'] },
          }),
        ]),
      }),
      3,
      expect.any(String),
    )
    await fill('記録開始年の期首額', '0')
    await act(async () => button('作業中の残高を保存').click())
    expect(vi.mocked(api.saveBalanceDraft).mock.calls[1]![1].accounts[0]!.opening).toEqual({
      status: 'known',
      amountJpy: 0,
    })
    expect(container.textContent).toContain('保存済みの入力による計算')
  })
  it('records an unknown question, resolves it with a reason, and keeps the original question in the saved payload', async () => {
    vi.mocked(api.getBalanceDraft).mockResolvedValue(fixture())
    await render()
    await act(async () => button('未判断を追加').click())
    await fill('未判断の制作物', 'unit')
    await fill('判断できない理由・確認すること', '完成時期を確認する')
    await fill('対象額が不明な理由', '請求明細の到着待ち')
    const source = [...container.querySelectorAll('label')]
      .find((l) => l.textContent?.includes('直接費 / 2026-01-01 / domain'))!
      .querySelector<HTMLInputElement>('input')!
    await act(async () => source.click())
    await act(async () => button('作業中の残高を保存').click())
    expect(vi.mocked(api.saveBalanceDraft).mock.calls[0]![1].pendingDecisions[0]!.amount).toEqual({
      status: 'unknown',
      amountJpy: null,
      reasons: ['請求明細の到着待ち'],
    })
    await act(async () => button('判断結果を記録して解消する').click())
    expect(button('作業中の残高を保存').disabled).toBe(true)
    await fill('解消の判断記録', 'decision')
    await fill('解消とする理由', '請求対象と完成時期を確認した')
    await act(async () => button('作業中の残高を保存').click())
    expect(vi.mocked(api.saveBalanceDraft).mock.calls[1]![1]).toMatchObject({
      movements: [],
      pendingDecisions: [
        {
          reasons: ['完成時期を確認する'],
          resolution: {
            taxYear: 2026,
            decisionId: 'decision',
            reason: '請求対象と完成時期を確認した',
          },
        },
      ],
    })
    expect(container.textContent).toContain('2026年から解消として記録')
  })
  it('saves transfers as one movement and retains local edits on conflict until explicit reload', async () => {
    vi.mocked(api.getBalanceDraft).mockResolvedValue(fixture())
    await render()
    await act(async () => button('増減を追加').click())
    await fill('増減の種類', 'transfer')
    await fill('振替元', 'a')
    await fill('振替先', 'a')
    await fill('増減額', '40')
    await fill('判断記録', 'decision')
    await fill('増減の理由', '完成した部分を振替')
    const source = [...container.querySelectorAll('label')]
      .find((l) => l.textContent?.includes('直接費 / 2026-01-01 / domain'))!
      .querySelector<HTMLInputElement>('input')!
    await act(async () => source.click())
    expect(container.textContent).toContain('同じ残高への振替はできません')
    expect(button('作業中の残高を保存').disabled).toBe(true)
    await fill('振替先', 'b')
    expect(container.textContent).toContain('￥60')
    expect(container.textContent).toContain('￥40')
    expect(
      [...container.querySelectorAll('button')]
        .filter((b) => b.textContent === 'この残高を削除')
        .every((b) => b.disabled),
    ).toBe(true)
    await act(async () => button('作業中の残高を保存').click())
    const sent = vi.mocked(api.saveBalanceDraft).mock.calls[0]![1].movements[0]!
    expect(sent).toMatchObject({
      kind: 'transfer',
      fromAccountId: 'a',
      toAccountId: 'b',
      amountJpy: 40,
      sourceIds: ['direct:source'],
      decisionId: 'decision',
    })
    expect(sent).not.toHaveProperty('accountId')
    await fill('残高を確認する年', '2027')
    expect(container.textContent).toContain('2027年の残高増減')
    await fill('増減の理由', '編集中の振替理由')
    vi.mocked(api.saveBalanceDraft).mockRejectedValueOnce(
      new api.ApiRequestError(409, '別の画面で更新されています', 'balance_conflict'),
    )
    await act(async () => button('作業中の残高を保存').click())
    expect(field('増減の理由').value).toBe('編集中の振替理由')
    expect(button('作業中の残高を保存').disabled).toBe(true)
    expect(container.textContent).toContain('この入力を上書き保存できません')
    vi.mocked(api.getBalanceDraft).mockResolvedValue({ ...fixture(), revision: 9 })
    await act(async () => button('入力を破棄して保存済みを読み直す').click())
    expect(container.textContent).toContain('保存版 9')
    expect(container.textContent).not.toContain('編集中の振替理由')
  })
  it('does not fabricate balances after a read failure and allows a deliberate retry', async () => {
    vi.mocked(api.getBalanceDraft).mockRejectedValueOnce(new Error('DBを確認できません'))
    await render()
    expect(container.textContent).toContain('DBを確認できません')
    expect(container.textContent).not.toContain('既知の期首小計')
    vi.mocked(api.getBalanceDraft).mockResolvedValue(fixture())
    await act(async () => button('残高を再読込').click())
    expect(container.textContent).toContain('制作中のアプリ')
  })
  it('compares a conflict without discarding input, applies whole-record choices, and handles another conflict', async () => {
    vi.mocked(api.getBalanceDraft).mockResolvedValue(fixture())
    await render()
    await fill('残高名', '自分の変更')
    vi.mocked(api.saveBalanceDraft).mockRejectedValueOnce(
      new api.ApiRequestError(409, '別更新', 'balance_conflict'),
    )
    await act(async () => button('作業中の残高を保存').click())
    vi.mocked(api.getBalanceDraft).mockRejectedValueOnce(new Error('比較資料を取得できません'))
    await act(async () => button('入力を保持して最新と比較').click())
    expect(field('残高名').value).toBe('自分の変更')
    expect(container.textContent).toContain('比較資料を取得できません')
    const latest = fixture()
    latest.revision = 4
    latest.snapshot.accounts[0]!.name = '最新の名称'
    latest.snapshot.accounts[1]!.name = '別の残高の更新'
    vi.mocked(api.getBalanceDraft).mockResolvedValue(latest)
    await act(async () => button('入力を保持して最新と比較').click())
    expect(button('選択結果を編集へ戻す').disabled).toBe(true)
    await act(async () => button('比較を閉じて元の入力へ戻る').click())
    expect(field('残高名').value).toBe('自分の変更')
    await act(async () => button('入力を保持して最新と比較').click())
    const localChoice = [...container.querySelectorAll('label')]
      .find((l) => l.textContent === 'この画面の入力を残す')!
      .querySelector<HTMLInputElement>('input')!
    await act(async () => localChoice.click())
    await act(async () => button('選択結果を編集へ戻す').click())
    expect(api.saveBalanceDraft).toHaveBeenCalledTimes(1)
    expect(field('残高名').value).toBe('自分の変更')
    vi.mocked(api.saveBalanceDraft).mockRejectedValueOnce(
      new api.ApiRequestError(409, '再び別更新', 'balance_conflict'),
    )
    await act(async () => button('作業中の残高を保存').click())
    const sent = vi.mocked(api.saveBalanceDraft).mock.calls[1]!
    expect(sent[2]).toBe(4)
    expect(sent[1].accounts.map((a) => a.name)).toEqual(['自分の変更', '別の残高の更新'])
    const newer = structuredClone(latest)
    newer.revision = 5
    newer.snapshot.accounts[0]!.name = 'さらに新しい名称'
    vi.mocked(api.getBalanceDraft).mockResolvedValue(newer)
    await act(async () => button('入力を保持して最新と比較').click())
    expect(container.textContent).toContain('最新の名称')
    expect(container.textContent).toContain('さらに新しい名称')
    expect(button('選択結果を編集へ戻す').disabled).toBe(true)
  })
  it('reuses the save request after a lost response and issues a different request after editing', async () => {
    vi.mocked(api.getBalanceDraft).mockResolvedValue(fixture())
    await render()
    await fill('残高名', '応答を確認する入力')
    vi.mocked(api.saveBalanceDraft).mockRejectedValueOnce(new Error('応答が途切れました'))
    await act(async () => button('作業中の残高を保存').click())
    const first = vi.mocked(api.saveBalanceDraft).mock.calls[0]!
    expect(first[3]).toMatch(/^[0-9a-f-]{36}$/)
    expect(field('残高名').value).toBe('応答を確認する入力')
    await act(async () => button('作業中の残高を保存').click())
    expect(vi.mocked(api.saveBalanceDraft).mock.calls[1]).toEqual(first)
    await fill('残高名', '保存後の別の入力')
    vi.mocked(api.saveBalanceDraft).mockRejectedValueOnce(new Error('応答が途切れました'))
    await act(async () => button('作業中の残高を保存').click())
    const second = vi.mocked(api.saveBalanceDraft).mock.calls[2]!
    expect(second[3]).not.toBe(first[3])
    await fill('残高名', '通信失敗後に編集した入力')
    await act(async () => button('作業中の残高を保存').click())
    expect(vi.mocked(api.saveBalanceDraft).mock.calls[3]![3]).not.toBe(second[3])
  })
  it('shows the saved reference audit and its workspace version, and refreshes without rewriting the draft', async () => {
    vi.mocked(api.getBalanceDraft).mockResolvedValue({
      ...fixture(),
      referenceCheck: {
        engineVersion: 'balance-references/1',
        workspaceRevision: 8,
        status: 'needs-review',
        issues: [
          {
            recordType: 'account',
            recordId: 'a',
            referenceId: 'unit',
            code: 'missing-unit',
            message: '制作物が現在の計画にありません。',
          },
        ],
      },
    })
    await render()
    expect(container.textContent).toContain('料金・計画の版 8')
    expect(container.textContent).toContain(
      '残高「制作中のアプリ」：制作物が現在の計画にありません。',
    )
    vi.mocked(api.getBalanceDraft).mockResolvedValue({
      ...fixture(),
      referenceCheck: {
        engineVersion: 'balance-references/1',
        workspaceRevision: 9,
        status: 'consistent',
        issues: [],
      },
    })
    await act(async () => button('保存済みを読み直す').click())
    expect(container.textContent).toContain('料金・計画の版 9')
    expect(container.textContent).toContain('不一致は見つかりませんでした')
    expect(api.saveBalanceDraft).not.toHaveBeenCalled()
  })
})
