// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OriginalChargeIntake, {
  type OriginalChargeIntakeProps,
} from '../../src/client/pages/OriginalChargeIntake'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import type { WorkspaceDraft } from '../../src/planning/workspace'
import {
  ORIGINAL_CHARGE_IMPORT_LIMIT,
  parseOriginalChargeImport,
} from '../../src/core/originalChargeIntake'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const opened: { root: Root; container: HTMLDivElement }[] = []
afterEach(async () => {
  for (const item of opened.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  localStorage.clear()
  vi.restoreAllMocks()
})
function workspace(): WorkspaceDraft {
  return {
    revision: 4,
    planning: emptyPlanningSnapshot(2026),
    configuration: {
      charges: { claude: null, codex: null },
      unknownChargeReasons: { claude: '未確認', codex: '未確認' },
      monthlyCharges: [],
      contracts: { claude: {}, codex: {} },
      chargePeriods: [],
      unobservedRatio: null,
    },
  }
}
async function mount(initial: Partial<OriginalChargeIntakeProps> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const item = { container, root: createRoot(container) }
  opened.push(item)
  let props: OriginalChargeIntakeProps = {
    workspace: workspace(),
    datasetId: 'test-dataset',
    onReview: vi.fn(async (_next: WorkspaceDraft) => false),
    ...initial,
  }
  const render = async (patch: Partial<OriginalChargeIntakeProps> = {}) => {
    props = { ...props, ...patch }
    await act(async () => item.root.render(<OriginalChargeIntake {...props} />))
  }
  await render()
  const button = (name: string) => {
    const found = [...container.querySelectorAll('button')].find((row) => row.textContent === name)
    if (!found) throw new Error(`Missing button: ${name}; ${container.textContent}`)
    return found
  }
  const field = (name: string) => {
    const found = [...container.querySelectorAll('label')]
      .find((row) => row.textContent?.startsWith(name))
      ?.querySelector('input,select')
    if (!found) throw new Error(`Missing field: ${name}; ${container.textContent}`)
    return found as HTMLInputElement | HTMLSelectElement
  }
  const fill = async (name: string, value: string) => {
    const input = field(name)
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value)
      input.dispatchEvent(
        new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
      )
    })
  }
  const click = async (name: string) => {
    await act(async () => button(name).click())
  }
  const check = async (name: string) => {
    await act(async () => field(name).click())
  }
  const file = async (text: () => Promise<string>, name = 'synthetic.json', size = 100) => {
    const input = field('構造化CSV・JSONを読み込む') as HTMLInputElement
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [{ name, size, text }] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  return { container, item, render, button, field, fill, click, check, file, props: () => props }
}
async function directForm(ui: Awaited<ReturnType<typeof mount>>, amount = '0') {
  await ui.click('新しい支払を手入力')
  await ui.fill('支払の種類', 'direct')
  await ui.fill('支払の説明', '合成の素材費')
  await ui.fill('原通貨の金額（十進数）', amount)
  await ui.fill('採用する円額（整数円）', amount)
  await ui.fill('発生日', '2026-06-01')
}
function imported(id = 'synthetic-direct', key = 'invoice-one') {
  return {
    category: 'direct',
    record: {
      id,
      incurredOn: '2026-06-01',
      costType: 'material' as const,
      amountJpy: 1000,
      directlyAttributable: false,
      treatment: 'general' as const,
      note: '合成の素材費',
      evidenceIds: [],
    },
    original: { currency: 'JPY', amount: '1000', amountJpy: 1000 },
    dates: { incurredOn: '2026-06-01' },
    evidenceIds: [],
    sourceKey: key,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}

it('preserves known zero, requires preview acknowledgement, guards repeated review clicks, and retains canceled input', async () => {
  const review = deferred<boolean>(),
    onReview = vi.fn((_next: WorkspaceDraft) => review.promise)
  const ui = await mount({ onReview })
  await directForm(ui)
  await ui.click('入力から候補を確認')
  expect(ui.container.textContent).toContain('新しい事実1件')
  expect(onReview).not.toHaveBeenCalled()
  expect(ui.button('変更の影響を確認').disabled).toBe(true)
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  const submit = ui.button('変更の影響を確認')
  await act(async () => {
    submit.click()
    submit.click()
  })
  expect(onReview).toHaveBeenCalledTimes(1)
  expect(onReview.mock.calls[0][0].planning.directCosts[0].amountJpy).toBe(0)
  expect(onReview.mock.calls[0][0].planning.originalCharges?.facts[0].original.amount).toBe('0')
  await act(async () => review.resolve(false))
  expect(ui.container.textContent).toContain('保存していません。入力と候補を保持しています。')
  expect((ui.field('採用する円額（整数円）') as HTMLInputElement).value).toBe('0')
  await ui.click('この支払入力を取り消す')
  expect(ui.props().workspace.planning.directCosts).toEqual([])
  expect(ui.container.querySelector('[aria-label="元の支払の候補プレビュー"]')).toBeNull()
})

it('does not default unknown or empty amounts to zero, and preserves independent unknown reasons', async () => {
  const onReview = vi.fn(async (_next: WorkspaceDraft) => false),
    ui = await mount({ onReview })
  await directForm(ui, '')
  await ui.click('入力から候補を確認')
  expect(ui.container.textContent).toContain('未確認の金額や割合を0として補いません')
  await ui.check('原通貨の金額が不明')
  await ui.fill('原通貨の金額が不明な理由', '明細待ち')
  await ui.check('採用する円額が不明')
  await ui.fill('採用する円額が不明な理由', '換算未確認')
  await ui.click('入力から候補を確認')
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await ui.click('変更の影響を確認')
  const fact = onReview.mock.calls[0][0].planning.originalCharges!.facts[0]
  expect(fact.original).toEqual({
    currency: 'JPY',
    amount: null,
    amountJpy: null,
    unknownAmountReason: '明細待ち',
    unknownJpyReason: '換算未確認',
  })
  expect(onReview.mock.calls[0][0].planning.directCosts[0].amountJpy).toBeNull()
})

it('uses exact shared FX conversion and retains all dates, contract and conversion evidence separately', async () => {
  const original = workspace()
  original.planning.evidence = [
    {
      id: 'synthetic-evidence',
      evidenceType: 'memo',
      strength: 'self-recorded',
      recordedAt: '2026-01-01T00:00:00Z',
      note: '合成の換算根拠',
    },
  ]
  const onReview = vi.fn(async (_next: WorkspaceDraft) => false),
    ui = await mount({ workspace: original, onReview })
  await directForm(ui, '10')
  await ui.fill('原通貨（JPY', 'USD')
  await ui.fill('原通貨の金額（十進数）', '10.01')
  await ui.fill('1通貨単位あたりの円額', '149.95')
  await ui.fill('換算日', '2026-05-01')
  await ui.fill('換算率の確認先', '合成の銀行明細')
  await ui.fill('円未満の丸め', 'floor-yen')
  await ui.click('この換算額を円額に採用')
  expect((ui.field('採用する円額（整数円）') as HTMLInputElement).value).toBe('1500')
  await ui.fill('請求日', '2026-05-01')
  await ui.fill('支払日', '2026-05-02')
  await ui.fill('取得日', '2026-05-03')
  await ui.fill('利用期間の開始日', '2026-05-04')
  await ui.fill('利用期間の終了日', '2027-04-30')
  await ui.fill('実際の契約の呼び名', '別契約A')
  await ui.click('入力から候補を確認')
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await ui.click('変更の影響を確認')
  const fact = onReview.mock.calls[0][0].planning.originalCharges!.facts[0]
  expect(fact.original.fx).toMatchObject({
    foreignAmount: '10.01',
    jpyPerUnit: '149.95',
    rounding: 'floor-yen',
    reference: '合成の銀行明細',
  })
  expect(fact.dates).toEqual({
    billedOn: '2026-05-01',
    paidOn: '2026-05-02',
    acquiredOn: '2026-05-03',
    incurredOn: '2026-06-01',
  })
  expect(fact.contract?.reference).toBe('別契約A')
  expect(fact.servicePeriod).toEqual({ startedOn: '2026-05-04', endedOn: '2027-04-30' })
})

it('corrects a legacy source with unchanged amount, retains targets, and recovers an unfinished correction', async () => {
  const original = workspace()
  original.planning.directCosts = [imported().record]
  const onReview = vi.fn(async (_next: WorkspaceDraft) => false),
    ui = await mount({ workspace: original, onReview })
  await ui.fill('既存の支払を訂正', 'direct:synthetic-direct')
  await ui.fill('訂正の理由（必須）', '支払日の資料を追加')
  await ui.fill('支払日', '2026-06-05')
  await act(async () => ui.item.root.unmount())
  opened.splice(opened.indexOf(ui.item), 1)
  ui.item.container.remove()
  const restored = await mount({ workspace: original, onReview })
  const restore = [...restored.container.querySelectorAll('button')].find((row) =>
    row.textContent?.startsWith('支払入力を復旧'),
  )!
  await act(async () => restore.click())
  expect((restored.field('訂正の理由（必須）') as HTMLInputElement).value).toBe(
    '支払日の資料を追加',
  )
  await restored.click('入力から候補を確認')
  await restored.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await restored.click('変更の影響を確認')
  const next = onReview.mock.calls[0][0]
  expect(next.planning.directCosts).toEqual(original.planning.directCosts)
  expect(next.planning.originalCharges?.facts[0]).toMatchObject({
    legacySourceId: 'direct:synthetic-direct',
    correctionReason: '支払日の資料を追加',
    dates: { paidOn: '2026-06-05' },
    original: { amountJpy: 1000 },
  })
})

it('imports JSON into the same review path and skips an exact repeated import after confirmed save', async () => {
  let saved: WorkspaceDraft | undefined
  const onReview = vi.fn(async (next: WorkspaceDraft) => {
    saved = { ...next, revision: next.revision + 1 }
    return true
  })
  const ui = await mount({ onReview })
  const raw = JSON.stringify([imported()])
  await ui.file(async () => raw)
  expect(ui.container.textContent).toContain('保存前の候補確認')
  expect(onReview).not.toHaveBeenCalled()
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await ui.click('変更の影響を確認')
  await ui.render({ workspace: saved })
  await ui.file(async () => raw)
  expect(ui.container.textContent).toContain('同じ取込キー・同じ内容で登録済み1件')
  expect(ui.container.textContent).toContain('追加する事実はありません')
  expect(onReview).toHaveBeenCalledTimes(1)
})

it('treats matching charges as duplicate candidates, not deletions or auto-merges', async () => {
  const ui = await mount()
  await ui.file(async () =>
    JSON.stringify([imported(), imported('synthetic-second', 'invoice-two')]),
  )
  expect(ui.container.textContent).toContain('新しい事実2件')
  expect(ui.container.textContent).toContain('重複の可能性')
  expect(ui.props().workspace.planning.directCosts).toEqual([])
})

it('strictly rejects raw unknown payload fields without persisting them and preflights file size', async () => {
  const ui = await mount(),
    text = vi.fn(async () =>
      JSON.stringify([{ ...imported(), rawReceipt: 'PRIVATE_RAW_SYNTHETIC' }]),
    )
  await ui.file(text)
  expect(ui.container.querySelector('[aria-label="元の支払の候補プレビュー"]')).toBeNull()
  expect(JSON.stringify(localStorage)).not.toContain('PRIVATE_RAW_SYNTHETIC')
  const tooLarge = vi.fn(async () => '[]')
  await ui.file(tooLarge, 'large.json', ORIGINAL_CHARGE_IMPORT_LIMIT + 1)
  expect(tooLarge).not.toHaveBeenCalled()
  expect(ui.container.textContent).toContain('512 KiB以内')
})

it('ignores canceled, superseded and back/forward file reads and preserves the newest validated candidate only', async () => {
  const ui = await mount(),
    first = deferred<string>()
  await ui.file(() => first.promise)
  await ui.click('この支払入力を取り消す')
  await act(async () => first.resolve(JSON.stringify([imported()])))
  expect(ui.container.querySelector('[aria-label="元の支払の候補プレビュー"]')).toBeNull()
  const second = deferred<string>(),
    third = deferred<string>()
  await ui.file(() => second.promise)
  await ui.file(() => third.promise)
  await act(async () => third.resolve(JSON.stringify([imported('newest', 'newest-key')])))
  await act(async () => second.resolve(JSON.stringify([imported('obsolete', 'obsolete-key')])))
  expect(ui.container.textContent).toContain('direct:newest')
  expect(ui.container.textContent).not.toContain('obsolete')
  await ui.click('この支払入力を取り消す')
  const fourth = deferred<string>()
  await ui.file(() => fourth.promise)
  await act(async () => window.dispatchEvent(new PopStateEvent('popstate')))
  await act(async () => fourth.resolve(JSON.stringify([imported()])))
  expect(ui.container.querySelector('[aria-label="元の支払の候補プレビュー"]')).toBeNull()
})

it('requires a fresh preview after revision changes and isolates recovery across datasets', async () => {
  const ui = await mount()
  await directForm(ui, '42')
  await ui.click('入力から候補を確認')
  await ui.render({ workspace: { ...ui.props().workspace, revision: 5 } })
  expect(ui.container.querySelector('[aria-label="元の支払の候補プレビュー"]')).toBeNull()
  await ui.click('現在の保存内容で候補を再確認')
  expect(ui.container.textContent).toContain('保存前の候補確認')
  await ui.render({ datasetId: 'other-dataset' })
  expect(ui.container.querySelector('input[value="42"]')).toBeNull()
  expect(ui.container.textContent).not.toContain('支払入力を復旧')
  expect(JSON.stringify(localStorage)).toContain('test-dataset')
})

it('accepts strict structured CSV through the identical validated candidate preview', async () => {
  const item = imported(),
    columns = ['category', 'record', 'original', 'dates', 'evidenceIds', 'sourceKey'] as const
  const cell = (value: unknown) =>
    `"${(typeof value === 'string' ? value : JSON.stringify(value)).replaceAll('"', '""')}"`
  const csv = columns.join(',') + '\n' + columns.map((key) => cell(item[key])).join(',')
  const ui = await mount()
  await ui.file(async () => csv, 'synthetic.csv')
  expect(ui.container.textContent).toContain('新しい事実1件')
  const stored = Object.values(localStorage).join('\n')
  expect(stored).toContain(parseOriginalChargeImport(csv, 'csv')[0].provenance.contentHash)
  expect(stored).not.toContain('synthetic.csv')
})

it('preserves equipment acquisition and method detail during a date-only correction', async () => {
  const original = workspace()
  original.planning.equipment = [
    {
      id: 'synthetic-equipment',
      name: '合成PC',
      equipmentType: 'pc',
      acquisitionCostJpy: 200000,
      acquiredOn: '2025-10-01',
      orderedOn: '2025-09-25',
      deliveredOn: '2025-09-30',
      businessUseStartedOn: '2025-11-01',
      convertedFromPrivate: false,
      openingUnamortizedBalanceJpy: 180000,
      businessUseRatio: 0.75,
      usefulLifeYears: 4,
      role: '開発',
      projectAllocationRatio: 0,
      evidenceIds: [],
    },
  ]
  const onReview = vi.fn(async (_next: WorkspaceDraft) => false),
    ui = await mount({ workspace: original, onReview })
  await ui.fill('既存の支払を訂正', 'equipment:synthetic-equipment')
  await ui.fill('訂正の理由', '請求日の補足')
  await ui.fill('請求日', '2025-09-26')
  const newer = structuredClone(original)
  newer.revision += 1
  newer.planning.equipment[0].businessUseRatio = 0.8
  await ui.render({ workspace: newer })
  await ui.click('現在の保存内容で候補を再確認')
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await ui.click('変更の影響を確認')
  expect(onReview.mock.calls[0][0].planning.equipment).toEqual(newer.planning.equipment)
  expect(onReview.mock.calls[0][0].planning.originalCharges?.facts[0].dates?.billedOn).toBe(
    '2025-09-26',
  )
})

it('creates home-cost category detail through the common candidate without defaulting allocation ratios', async () => {
  const onReview = vi.fn(async (_next: WorkspaceDraft) => false),
    ui = await mount({ onReview })
  await ui.click('新しい支払を手入力')
  await ui.fill('支払の種類', 'home')
  await ui.fill('原通貨の金額（十進数）', '9000')
  await ui.fill('採用する円額（整数円）', '9000')
  await ui.fill('自宅費用の対象月', '2026-06')
  await ui.fill('自宅費用の種類', 'electricity')
  await ui.click('入力から候補を確認')
  expect(ui.container.textContent).toContain('自宅費用の業務利用割合を入力してください')
  await ui.fill('自宅費用の業務利用割合（%）', '20')
  await ui.fill('自宅費用の業務分から制作物への割合（%）', '0')
  await ui.fill('配分の計算根拠', '合成の計測記録')
  await ui.fill('配分方法を選んだ理由', '利用を計測した')
  await ui.click('入力から候補を確認')
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await ui.click('変更の影響を確認')
  expect(onReview.mock.calls[0][0].planning.homeCosts[0]).toMatchObject({
    month: '2026-06',
    category: 'electricity',
    amountJpy: 9000,
    businessUseRatio: 0.2,
    projectAllocationRatio: 0,
  })
})

it('removes an obsolete subscription contract confirmation only when its reference changes', async () => {
  const original = workspace()
  const charge = {
    id: 'synthetic-subscription',
    provider: 'claude' as const,
    planName: '合成年額',
    serviceStartedOn: '2026-01-01',
    serviceEndedOn: '2026-12-31',
    amountJpy: 12000,
    evidenceIds: [],
  }
  original.configuration.chargePeriods = [
    {
      ...charge,
      contractConfirmation: {
        reference: '旧契約',
        reason: '合成の確認',
        confirmedAt: '2026-01-01T00:00:00Z',
        basis: charge,
      },
    },
  ]
  const onReview = vi.fn(async (_next: WorkspaceDraft) => false),
    ui = await mount({ workspace: original, onReview })
  await ui.fill('既存の支払を訂正', 'ai:charge:synthetic-subscription')
  await ui.fill('訂正の理由', '実際の契約を訂正')
  await ui.fill('実際の契約の呼び名', '新契約')
  expect(ui.container.textContent).toContain('以前の契約確認を外します')
  await ui.click('入力から候補を確認')
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await ui.click('変更の影響を確認')
  const next = onReview.mock.calls[0][0]
  expect(next.configuration.chargePeriods[0].contractConfirmation).toBeUndefined()
  expect(next.planning.originalCharges?.facts[0].contract?.reference).toBe('新契約')
  expect(original.configuration.chargePeriods[0].contractConfirmation?.reference).toBe('旧契約')
})

it('merges independently changed category details into a recovered date-only correction', async () => {
  const original = workspace()
  original.planning.directCosts = [imported().record]
  original.planning.taxUnits = [
    {
      id: 'synthetic-unit',
      name: '合成作品',
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'undecided',
      lifecycleStatus: 'developing',
    },
  ]
  const onReview = vi.fn(async (_next: WorkspaceDraft) => false),
    ui = await mount({ workspace: original, onReview })
  await ui.fill('既存の支払を訂正', 'direct:synthetic-direct')
  await ui.fill('訂正の理由', '日付だけを補足')
  await ui.fill('支払日', '2026-06-02')
  const newer = structuredClone(original)
  newer.revision += 1
  newer.planning.directCosts[0].treatment = 'shared'
  newer.planning.directCosts[0].targets = [{ taxUnitId: 'synthetic-unit', shareBps: 6000 }]
  await ui.render({ workspace: newer })
  await ui.click('現在の保存内容で候補を再確認')
  expect(ui.container.textContent).toContain('別の編集で更新された配分情報を候補に引き継ぎました')
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await ui.click('変更の影響を確認')
  expect(onReview.mock.calls[0][0].planning.directCosts[0].treatment).toBe('shared')
  expect(onReview.mock.calls[0][0].planning.directCosts[0].targets).toEqual([
    { taxUnitId: 'synthetic-unit', shareBps: 6000 },
  ])
  expect((ui.field('支払日') as HTMLInputElement).value).toBe('2026-06-02')
  expect(ui.props().workspace.planning.directCosts[0].treatment).toBe('shared')
})

it('retains failed-review input and clears a confirmed save even when parent revision updates before its promise resolves', async () => {
  const confirmation = deferred<boolean>()
  const onReview = vi
    .fn<(next: WorkspaceDraft) => Promise<boolean>>()
    .mockRejectedValueOnce(new Error('合成の通信失敗'))
    .mockImplementationOnce(() => confirmation.promise)
  const ui = await mount({ onReview })
  await directForm(ui, '42')
  await ui.click('入力から候補を確認')
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await ui.click('変更の影響を確認')
  expect(ui.container.textContent).toContain('合成の通信失敗')
  expect((ui.field('採用する円額（整数円）') as HTMLInputElement).value).toBe('42')
  await ui.click('変更の影響を確認')
  await ui.render({ workspace: { ...onReview.mock.calls[1][0], revision: 5 } })
  await act(async () => confirmation.resolve(true))
  expect(ui.container.textContent).toContain('元の支払と入力事実を保存しました')
  expect(ui.container.querySelector('input[value="42"]')).toBeNull()
  expect(localStorage.length).toBe(0)
})

it('does not restore an asynchronous file after unmount or carry a reviewed preview through Back/Forward', async () => {
  const ui = await mount()
  await directForm(ui, '42')
  await ui.click('入力から候補を確認')
  await ui.check('原額・日付・契約・根拠・配分と重複候補を確認した')
  await act(async () => window.dispatchEvent(new PopStateEvent('popstate')))
  expect(ui.container.querySelector('[aria-label="元の支払の候補プレビュー"]')).toBeNull()
  expect((ui.field('採用する円額（整数円）') as HTMLInputElement).value).toBe('42')
  await ui.click('この支払入力を取り消す')
  const pending = deferred<string>()
  await ui.file(() => pending.promise)
  await act(async () => ui.item.root.unmount())
  opened.splice(opened.indexOf(ui.item), 1)
  ui.item.container.remove()
  await act(async () => pending.resolve(JSON.stringify([imported()])))
  expect(localStorage.length).toBe(0)
})

it('blocks conflicting category edits without clearing the input', async () => {
  const original = workspace()
  original.planning.directCosts = [imported().record]
  const ui = await mount({ workspace: original })
  await ui.fill('既存の支払を訂正', 'direct:synthetic-direct')
  await ui.fill('訂正の理由', '今回の配分確認')
  await ui.fill('費用の配分先の種類', 'direct')
  const newer = structuredClone(original)
  newer.revision += 1
  newer.planning.directCosts[0].treatment = 'shared'
  await ui.render({ workspace: newer })
  await ui.click('現在の保存内容で候補を再確認')
  expect(ui.container.textContent).toContain('同じ項目が編集中に双方で変更されています')
  expect(ui.container.querySelector('[aria-label="元の支払の候補プレビュー"]')).toBeNull()
  expect((ui.field('費用の配分先の種類') as HTMLInputElement).value).toBe('direct')
})

it('blocks restored import corrections after a revision change rather than undoing new allocation detail', async () => {
  const original = workspace()
  original.planning.directCosts = [imported().record]
  const item = {
    ...imported(),
    legacySourceId: 'direct:synthetic-direct',
    correctionReason: '日付補足',
    dates: { incurredOn: '2026-06-01', paidOn: '2026-06-03' },
  }
  const ui = await mount({ workspace: original })
  await ui.file(async () => JSON.stringify([item]))
  expect(ui.container.textContent).toContain('保存前の候補確認')
  const newer = structuredClone(original)
  newer.revision += 1
  newer.planning.directCosts[0].treatment = 'shared'
  await ui.render({ workspace: newer })
  await ui.click('現在の保存内容で候補を再確認')
  expect(ui.container.textContent).toContain('以前の配分を上書きする可能性があるため再適用しません')
  expect(ui.container.querySelector('[aria-label="元の支払の候補プレビュー"]')).toBeNull()
  expect(Object.values(localStorage).join('')).toContain('日付補足')
})
