// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ReceiptCandidateIntake from '../../src/client/pages/ReceiptCandidateIntake'
import OriginalChargeIntake from '../../src/client/pages/OriginalChargeIntake'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import type { WorkspaceDraft } from '../../src/planning/workspace'
import { readReceiptFile } from '../../src/client/receiptFileReader'
vi.mock('../../src/client/receiptFileReader', () => ({ readReceiptFile: vi.fn() }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement
const text =
  'Issuer: Example\nInvoice Number: INV-7\nInvoice Date: 2026-06-01\nCurrency: JPY\nTotal: 1000'
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  container?.remove()
  localStorage.clear()
  vi.resetAllMocks()
})
async function mount(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(element))
}
const field = (label: string) => {
  const found = [...container.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector('input,select')
  if (!found) throw new Error(`Missing ${label}`)
  return found as HTMLInputElement
}
const button = (label: string) => {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === label)
  if (!found) throw new Error(`Missing ${label}`)
  return found
}
async function fill(label: string, value: string) {
  const f = field(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      f.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value',
    )!.set!.call(f, value)
    f.dispatchEvent(new Event(f.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function upload() {
  await act(async () => {
    const f = field('領収書のテキスト・JSON・文字付きPDF')
    Object.defineProperty(f, 'files', {
      configurable: true,
      value: [{ name: 'private-secret.txt', size: 100 }],
    })
    f.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function reviewSelected() {
  await act(async () => field('選んだ候補を原本と照合した').click())
}

it('never preselects extracted values or accounting category and requires explicit review', async () => {
  vi.mocked(readReceiptFile).mockResolvedValue({ text, format: 'text' })
  const onUse = vi.fn()
  await mount(<ReceiptCandidateIntake disabled={false} revision={1} onUse={onUse} />)
  await upload()
  expect(field('原通貨の候補').value).toBe('')
  expect(field('確認して選ぶ支払の種類').value).toBe('')
  expect(button('選んだ候補で支払の入力を始める').disabled).toBe(true)
  await fill('確認して選ぶ支払の種類', 'direct')
  await fill('原通貨の候補', 'JPY')
  await fill('合計額の候補', '1000')
  await reviewSelected()
  await click('選んだ候補で支払の入力を始める')
  expect(onUse).toHaveBeenCalledOnce()
  expect(onUse.mock.calls[0][0]).toMatchObject({
    category: 'direct',
    currency: 'JPY',
    total: '1000',
    sourceKey: expect.stringMatching(/^receipt:[a-f0-9]{64}$/),
  })
  expect(JSON.stringify(onUse.mock.calls)).not.toContain('private-secret')
  expect(JSON.stringify(onUse.mock.calls)).not.toContain(text)
})
it('aborts pending parsing on cancellation and ignores its eventual result', async () => {
  let finish!: (value: { text: string; format: 'text' }) => void
  vi.mocked(readReceiptFile).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const onUse = vi.fn()
  await mount(<ReceiptCandidateIntake disabled={false} revision={1} onUse={onUse} />)
  await upload()
  const signal = vi.mocked(readReceiptFile).mock.calls[0][1]
  await click('領収書の読み取りを取り消す')
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ text, format: 'text' }))
  expect(container.textContent).not.toContain('Example')
  expect(onUse).not.toHaveBeenCalled()
})
it('ignores obsolete results after navigation, revision changes and replacement files', async () => {
  const finish: Array<(value: { text: string; format: 'text' }) => void> = []
  vi.mocked(readReceiptFile).mockImplementation(
    () => new Promise((resolve) => finish.push(resolve)),
  )
  const onUse = vi.fn()
  await mount(<ReceiptCandidateIntake disabled={false} revision={1} onUse={onUse} />)
  await upload()
  await upload()
  expect(vi.mocked(readReceiptFile).mock.calls[0][1].aborted).toBe(true)
  await act(async () => finish[0]({ text, format: 'text' }))
  expect(container.textContent).not.toContain('Example')
  await act(async () => window.dispatchEvent(new PopStateEvent('popstate')))
  expect(vi.mocked(readReceiptFile).mock.calls[1][1].aborted).toBe(true)
  await act(async () => finish[1]({ text, format: 'text' }))
  expect(container.textContent).not.toContain('Example')
  await upload()
  await act(async () =>
    root!.render(<ReceiptCandidateIntake disabled={false} revision={2} onUse={onUse} />),
  )
  expect(vi.mocked(readReceiptFile).mock.calls[2][1].aborted).toBe(true)
})
it('retains a complete manual path when parsing fails and does not reveal parser errors', async () => {
  vi.mocked(readReceiptFile).mockRejectedValue(new Error('secret body /private/file.pdf'))
  const ws: WorkspaceDraft = {
    revision: 1,
    planning: emptyPlanningSnapshot(2026),
    configuration: {
      charges: { claude: null, codex: null },
      unknownChargeReasons: { claude: '不明', codex: '不明' },
      monthlyCharges: [],
      contracts: { claude: {}, codex: {} },
      chargePeriods: [],
      unobservedRatio: null,
    },
  }
  await mount(
    <OriginalChargeIntake workspace={ws} datasetId="receipt-failure" onReview={vi.fn()} />,
  )
  await upload()
  expect(container.textContent).toContain('手入力してください')
  expect(container.textContent).not.toContain('secret body')
  await click('新しい支払を手入力')
  expect(field('支払の種類')).toBeTruthy()
})
it('selected values enter common recovery and preview without inferring adopted yen or incurred date', async () => {
  vi.mocked(readReceiptFile).mockResolvedValue({ text, format: 'text' })
  const ws: WorkspaceDraft = {
    revision: 1,
    planning: emptyPlanningSnapshot(2026),
    configuration: {
      charges: { claude: null, codex: null },
      unknownChargeReasons: { claude: '不明', codex: '不明' },
      monthlyCharges: [],
      contracts: { claude: {}, codex: {} },
      chargePeriods: [],
      unobservedRatio: null,
    },
  }
  const onReview = vi.fn(async () => false)
  await mount(<OriginalChargeIntake workspace={ws} datasetId="receipt-flow" onReview={onReview} />)
  await upload()
  await fill('確認して選ぶ支払の種類', 'direct')
  await fill('原通貨の候補', 'JPY')
  await fill('合計額の候補', '1000')
  await fill('発行元の候補', 'Example')
  await fill('請求書番号の候補', 'INV-7')
  await reviewSelected()
  await click('選んだ候補で支払の入力を始める')
  expect(field('採用する円額（整数円）').value).toBe('')
  expect(field('発生日').value).toBe('')
  expect(field('実際の契約の呼び名・参照').value).toBe('')
  expect(onReview).not.toHaveBeenCalled()
  const recovery = JSON.stringify({ ...localStorage })
  expect(recovery).toContain('INV-7')
  expect(recovery).not.toContain('private-secret')
  expect(recovery).not.toContain('Invoice Number:')
  await fill('採用する円額（整数円）', '1000')
  await fill('発生日', '2026-06-01')
  await click('入力から候補を確認')
  expect(container.textContent).toContain('発行元：Example / 請求書番号：INV-7')
  await act(async () => field('原額・日付・契約・根拠・配分と重複候補を確認した').click())
  await click('変更の影響を確認')
  expect(onReview).toHaveBeenCalledOnce()
  const saved = onReview.mock.calls[0] as unknown as [WorkspaceDraft]
  expect(saved[0].planning.originalCharges?.facts[0].provenance.kind).toBe('receipt')
  expect(saved[0].planning.originalCharges?.facts[0].document).toEqual({
    issuer: 'Example',
    invoiceNumber: 'INV-7',
  })
  expect(ws.planning.originalCharges).toBeUndefined()
})

it('keeps overlength document edits recoverable and restricts normal field entry to 160 chars', async () => {
  const ws: WorkspaceDraft = {
    revision: 1,
    planning: emptyPlanningSnapshot(2026),
    configuration: {
      charges: { claude: null, codex: null },
      unknownChargeReasons: { claude: '不明', codex: '不明' },
      monthlyCharges: [],
      contracts: { claude: {}, codex: {} },
      chargePeriods: [],
      unobservedRatio: null,
    },
  }
  const view = (
    <OriginalChargeIntake workspace={ws} datasetId="receipt-recovery" onReview={vi.fn()} />
  )
  await mount(view)
  await click('新しい支払を手入力')
  expect(field('発行元（原本で確認した値）').maxLength).toBe(160)
  expect(field('請求書番号（契約番号とは別）').maxLength).toBe(160)
  // A restored/externally set invalid draft must remain recoverable, never silently disappear.
  const overlength = 'a'.repeat(161)
  await fill('発行元（原本で確認した値）', overlength)
  await act(async () => root!.unmount())
  root = createRoot(container)
  await act(async () => root!.render(view))
  const restore = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('支払入力を復旧'),
  )
  expect(restore).toBeTruthy()
  await act(async () => restore!.click())
  expect(field('発行元（原本で確認した値）').value).toBe(overlength)
  expect(container.textContent).not.toContain('読めない入力控え')
})
