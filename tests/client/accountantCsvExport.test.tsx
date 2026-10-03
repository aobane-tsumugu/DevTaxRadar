// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace'
import { buildAnnualBalances } from '../../src/core/annualBalances'
import {
  accountantCsvFiles,
  accountantCsvPreview,
  accountantCsvZip,
} from '../../src/core/accountantCsv'
import ExportPreviewButton from '../../src/client/pages/ExportPreviewButton'
import StoredReviewPanel from '../../src/client/pages/StoredReviewPanel'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement
const createObjectURL = vi.fn((_blob: Blob) => 'blob:review-export')
const revokeObjectURL = vi.fn()
let downloads: Array<{ filename: string; href: string }>

beforeEach(() => {
  vi.useFakeTimers()
  // jsdom's Blob lacks text/arrayBuffer; use the standards-compatible Node implementation.
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  vi.stubGlobal('fetch', vi.fn())
  downloads = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ filename: this.download, href: this.href })
  })
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  container?.remove()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function render(node: ReactNode) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root!.render(node))
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  expect(found).toBeDefined()
  return found!
}
async function click(label: string) {
  await act(async () => button(label).click())
}

function reviewFixture(): BalanceReview {
  const snapshot: BalanceReview['snapshot'] = {
    version: 1,
    accounts: [
      {
        id: 'unknown-account',
        name: '保存時の名称<img>',
        kind: 'asset',
        taxUnitId: 'saved-product',
        openingYear: 2026,
        opening: { status: 'unknown', amountJpy: null, reasons: ['外部資料待ち'] },
      },
    ],
    movements: [],
    pendingDecisions: [],
  }
  return {
    schemaVersion: 1,
    engineVersion: 'annual-balances/1',
    id: 'fixed-review',
    year: 2026,
    createdAt: '2026-09-01T00:00:00Z',
    draftRevision: 1,
    reason: '保存時の相談内容',
    previousReviewId: null,
    correctsReviewId: null,
    snapshot,
    projection: buildAnnualBalances(snapshot, 2026),
  }
}

describe('saved accountant CSV preview', () => {
  it('shows every archive file before saving and downloads exactly the previewed saved version offline', async () => {
    const review = reviewFixture()
    const expectedZip = accountantCsvZip(review)
    const expectedPreview = accountantCsvPreview(review)
    await render(<StoredReviewPanel review={review} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()

    await click('税理士相談用CSV一式を確認')
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.querySelector('pre')!.textContent).toBe(expectedPreview)
    for (const file of accountantCsvFiles(review)) {
      expect(dialog.querySelector('pre')!.textContent).toContain(file.name)
      expect(dialog.querySelector('pre')!.textContent).toContain(file.content)
    }
    expect(dialog.textContent).toContain('保存時の相談内容')
    expect(dialog.textContent).toContain('外部資料待ち')
    expect(dialog.querySelector('img')).toBeNull()
    expect(downloads).toEqual([])
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()

    // A later render must not regenerate the blob while the user is reviewing its contents.
    await render(<StoredReviewPanel review={{ ...review, reason: '後から変わった入力' }} />)
    expect(dialog.querySelector('pre')!.textContent).toBe(expectedPreview)
    await click('確認した内容を保存する')
    const savedBlob = createObjectURL.mock.calls[0]![0]
    expect(savedBlob.type).toBe('application/zip')
    expect(new Uint8Array(await savedBlob.arrayBuffer())).toEqual(expectedZip)
    expect(downloads).toEqual([
      { filename: 'devtax-2026-fixed-review-accountant-csv.zip', href: 'blob:review-export' },
    ])
    expect(fetch).not.toHaveBeenCalled()
    vi.runOnlyPendingTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:review-export')
  })

  it('closes without downloading, restores focus, and drops a preview when a different saved record opens', async () => {
    const review = reviewFixture()
    await render(<StoredReviewPanel review={review} />)
    const opener = button('税理士相談用CSV一式を確認')
    opener.focus()
    await click('税理士相談用CSV一式を確認')
    const save = button('確認した内容を保存する')
    expect(document.activeElement).toBe(save)
    button('閉じる').focus()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })))
    expect(document.activeElement).toBe(save)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    await click('税理士相談用CSV一式を確認')
    await click('閉じる')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await click('税理士相談用CSV一式を確認')
    await render(<StoredReviewPanel review={{ ...review, id: 'other-saved-review' }} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(downloads).toEqual([])
  })
})

describe('shared export preview compatibility', () => {
  it('still previews plain Blob exports, waits for explicit save, and downloads without a second load', async () => {
    const blob = new Blob(['既存のMarkdown <script>'], { type: 'text/markdown' })
    const load = vi.fn(async () => blob)
    await render(<ExportPreviewButton label="Markdown" filename="review.md" load={load} />)
    await click('Markdown')
    expect(container.querySelector('[role="dialog"] pre')!.textContent).toBe(
      '既存のMarkdown <script>',
    )
    expect(container.querySelector('script')).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
    await click('確認した内容を保存する')
    await click('確認した内容を保存する')
    expect(load).toHaveBeenCalledOnce()
    expect(createObjectURL.mock.calls.map(([downloaded]) => downloaded)).toEqual([blob, blob])
    expect(downloads.map((entry) => entry.filename)).toEqual(['review.md', 'review.md'])
  })

  it('shows a load failure, allows retry and disables repeated loads while pending', async () => {
    let finish!: (blob: Blob) => void
    const load = vi
      .fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(new Error('合成の読込失敗'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
    await render(<ExportPreviewButton label="Markdown" filename="review.md" load={load} />)
    await click('Markdown')
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('合成の読込失敗')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await click('Markdown')
    expect(button('出力内容を読込中').disabled).toBe(true)
    await click('出力内容を読込中')
    expect(load).toHaveBeenCalledTimes(2)
    await act(async () => finish(new Blob(['retry content'])))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[role="dialog"] pre')!.textContent).toBe('retry content')
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('ignores a pending result after unmount without creating a download', async () => {
    let finish!: (blob: Blob) => void
    const load = () =>
      new Promise<Blob>((resolve) => {
        finish = resolve
      })
    await render(<ExportPreviewButton label="Markdown" filename="review.md" load={load} />)
    await click('Markdown')
    await render(<p>別の画面</p>)
    await act(async () => finish(new Blob(['late content'])))
    expect(container.textContent).toBe('別の画面')
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
