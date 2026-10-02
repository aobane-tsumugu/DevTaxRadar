// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SoftwareMethodPanel from '../../src/client/pages/SoftwareMethodPanel'
import * as api from '../../src/client/api'
import type { BalancePreview } from '../../src/accounting/balanceWorkspace'
import type { BalanceSnapshot } from '../../src/accounting/types'
import { balanceSnapshotSchema } from '../../src/accounting/balanceSchema'
import { buildAnnualBalances } from '../../src/core/annualBalances'
import { softwareMethodSchedule } from '../../src/core/softwareMethod'
import { methodFixture } from '../core/helpers/softwareMethodFixture'

vi.mock('../../src/client/api', () => ({
  getBalanceDraft: vi.fn(),
  getBalancePreview: vi.fn(),
  getRuntime: vi.fn(),
  getWorkspace: vi.fn(),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('SoftwareMethodPanel blue-special selection through real React controls', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  let latest: BalanceSnapshot
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    root = undefined
    container?.remove()
    vi.resetAllMocks()
    localStorage.clear()
  })

  function button(name: string) {
    const found = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    )
    expect(found, name).toBeDefined()
    return found!
  }
  function field(label: string) {
    const found = [...container.querySelectorAll('label')]
      .find((item) => item.textContent?.trim().startsWith(label))
      ?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input,select,textarea',
      )
    expect(found, label).toBeDefined()
    return found!
  }
  async function fill(label: string, value: string) {
    const input = field(label)
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
  async function check(label: string) {
    await act(async () => (field(label) as HTMLInputElement).click())
  }
  async function renderEligible() {
    const fixture = methodFixture('blue-special', 350000)
    const original = structuredClone(fixture.unselected)
    const preview = {
      draftRevision: 2,
      snapshot: structuredClone(original),
      projection: buildAnnualBalances(original, 2026),
      materials: {
        year: 2026,
        workspaceRevision: 7,
        costs: fixture.costs[1],
        costLinks: { costs: fixture.costs },
        planning: fixture.planning,
      },
    } as unknown as BalancePreview
    vi.mocked(api.getRuntime).mockResolvedValue({
      csrfToken: 'synthetic',
      datasetId: 'dataset-a',
    } as Awaited<ReturnType<typeof api.getRuntime>>)
    vi.mocked(api.getBalanceDraft).mockResolvedValue({
      datasetId: 'dataset-a',
      revision: 2,
      snapshot: structuredClone(original),
    })
    vi.mocked(api.getBalancePreview).mockResolvedValue(preview)
    vi.mocked(api.getWorkspace).mockResolvedValue({ revision: 7 } as Awaited<
      ReturnType<typeof api.getWorkspace>
    >)
    const edit = vi.fn((change: (value: BalanceSnapshot) => void) => {
      const next = structuredClone(latest)
      change(next)
      latest = next
    })
    function Harness() {
      const [snapshot, setSnapshot] = useState(original)
      latest = snapshot
      return (
        <SoftwareMethodPanel
          datasetId="dataset-a"
          snapshot={snapshot}
          planning={fixture.planning}
          busy={false}
          edit={(change) => {
            edit(change)
            setSnapshot(latest)
          }}
        />
      )
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<Harness />))
    await act(async () => {
      const asset = container.querySelector<HTMLSelectElement>('[aria-label="方法を選ぶ資産"]')!
      asset.value = 'asset'
      asset.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button('同じ保存版から原価と条件を読む').click())
    await fill('方法', 'blue-special')
    await fill('実際の供用日', '2026-07-01')
    await fill('貸付用途', 'none')
    await check('業務専用の資産全体額を確認した')
    await check('個人の通常条件で、転用・特殊調整を含まない')
    await fill('取得時期の事業者要件', 'yes')
    await fill('この資産以外の供用年の特例使用済額', '0')
    await fill('供用年の事業月数', '12')
    await fill('必要な明細等', 'yes')
    await fill('選択理由', '合成の全体取得価額と供用年の特例条件を確認')
    await check('合成の外部原価根拠')
    return { original, edit }
  }

  it('applies the eligible 350000 choice to a schema-valid balance draft without entering its amount again', async () => {
    const { original, edit } = await renderEligible()
    const apply = button('選択方法を未保存の残高入力へ反映')
    expect(apply.disabled).toBe(false)
    await act(async () => button('保存せず方法別の年額を比較').click())
    expect(container.querySelector('tbody')!.textContent).toContain('350,000')
    expect(edit).not.toHaveBeenCalled()
    await act(async () => apply.click())
    expect(edit).toHaveBeenCalledTimes(1)
    const selection = latest.accounts.find((row) => row.id === 'asset')!.softwareMethod!
    expect(selection).toMatchObject({
      method: 'blue-special',
      usefulLifeYears: null,
      roundingConfirmed: false,
      blueSpecial: {
        annualSpecialUsedJpy: 0,
        businessMonths: 12,
        eligibleSmallBusiness: true,
        statementReady: true,
      },
    })
    expect(
      balanceSnapshotSchema.parse(latest).accounts.find((row) => row.id === 'asset')!
        .softwareMethod,
    ).toEqual(selection)
    expect(
      softwareMethodSchedule(latest, 'asset', selection, 2027).map((row) => row.expenseJpy),
    ).toEqual([350000, 0])
    expect(latest.movements).toEqual(original.movements)
    expect(container.textContent).toContain('未保存の残高入力へ反映しました')
    expect(original.accounts.find((row) => row.id === 'asset')!.softwareMethod).toBeUndefined()
  })

  it('accepts surrounding whitespace consistently with the eligibility preview', async () => {
    const { edit } = await renderEligible()
    await fill('この資産以外の供用年の特例使用済額', ' 1000 ')
    await fill('供用年の事業月数', ' 12 ')
    await act(async () => button('選択方法を未保存の残高入力へ反映').click())
    expect(edit).toHaveBeenCalledTimes(1)
    expect(
      latest.accounts.find((row) => row.id === 'asset')!.softwareMethod!.blueSpecial,
    ).toMatchObject({ annualSpecialUsedJpy: 1000, businessMonths: 12 })
  })

  it('keeps invalid numeric inputs visible and cannot apply them as zero or default months', async () => {
    const { original, edit } = await renderEligible()
    for (const value of ['', '-1', '1.5', '1e2', 'NaN', '9007199254740992', '\\ddd']) {
      await fill('この資産以外の供用年の特例使用済額', value)
      expect(field('この資産以外の供用年の特例使用済額').value).toBe(value)
      expect(button('選択方法を未保存の残高入力へ反映').disabled).toBe(true)
      await act(async () => button('選択方法を未保存の残高入力へ反映').click())
    }
    await fill('この資産以外の供用年の特例使用済額', '0')
    for (const value of ['', '0', '13', '-1', '1.5', '1e1', '9007199254740992']) {
      await fill('供用年の事業月数', value)
      expect(field('供用年の事業月数').value).toBe(value)
      expect(button('選択方法を未保存の残高入力へ反映').disabled).toBe(true)
      await act(async () => button('選択方法を未保存の残高入力へ反映').click())
    }
    expect(edit).not.toHaveBeenCalled()
    expect(latest).toEqual(original)
  })

  it('keeps a valid unsent choice when the saved workspace changes before applying it', async () => {
    const { original, edit } = await renderEligible()
    vi.mocked(api.getWorkspace).mockResolvedValue({ revision: 8 } as Awaited<
      ReturnType<typeof api.getWorkspace>
    >)
    await act(async () => button('選択方法を未保存の残高入力へ反映').click())
    expect(edit).not.toHaveBeenCalled()
    expect(latest).toEqual(original)
    expect(container.textContent).toContain('接続先か保存版が変わりました')
    expect(field('供用年の事業月数').value).toBe('12')
    expect(field('この資産以外の供用年の特例使用済額').value).toBe('0')
  })
})
