// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import EquipmentMethodsEditor from '../../src/client/pages/EquipmentMethodsEditor'
import { emptyPlanningSnapshot } from '../../src/planning/types'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
it('records explicit annual conditions, previews the whole asset and preserves other years', async () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits = [
    {
      id: 'u',
      name: '当年の制作物',
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'efficiency',
      lifecycleStatus: 'developing',
    },
  ]
  planning.equipment = [
    {
      id: 'pc',
      name: 'PC',
      equipmentType: 'pc',
      acquisitionCostJpy: 240000,
      acquiredOn: '2026-01-01',
      businessUseStartedOn: '2026-07-31',
      convertedFromPrivate: false,
      businessUseRatio: 0.5,
      projectAllocationRatio: 0.6,
      evidenceIds: [],
      role: '制作',
    },
  ]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = () =>
    root.render(
      <EquipmentMethodsEditor
        planning={planning}
        onChange={(rows) => {
          planning.equipmentMethods = rows
          render()
        }}
      />,
    )
  try {
    await act(async () => render())
    await act(async () => container.querySelector('button')!.click())
    expect(planning.equipmentMethods![0]!.method).toBe('unknown')
    expect(container.textContent).toContain('未算定')
    for (const [label, value] of [
      ['納税者区分', 'individual'],
      ['資産の区分', 'tangible-equipment'],
      ['償却方法', 'straight-line'],
      ['対象年末までの利用', 'confirmed'],
      ['特別な調整', 'confirmed'],
    ]) {
      const field = container.querySelector<HTMLSelectElement>(`select[aria-label="PCの${label}"]`)!
      await act(async () => {
        field.value = value!
        field.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    const life = container.querySelector<HTMLInputElement>('[aria-label="PCの年度別耐用年数"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(life, '4')
      life.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const reason = container.querySelector<HTMLTextAreaElement>('[aria-label="PCの方法根拠"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        reason,
        '確認した設備区分と方法',
      )
      reason.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('普通償却額 30000円、償却後残高 210000円')
    expect(planning.equipmentMethods![0]!.usefulLifeYears).toBe(4)
    expect(planning.equipmentMethods![0]!.allocation).toEqual({
      taxUnitId: null,
      businessUseRatio: null,
      projectAllocationRatio: null,
      reason: '',
    })
    const business = container.querySelector<HTMLInputElement>('[aria-label="PCの年度別業務割合"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        business,
        '80',
      )
      business.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(planning.equipmentMethods![0]!.allocation!.businessUseRatio).toBe(0.8)
    const destination = container.querySelector<HTMLSelectElement>(
      '[aria-label="PCの年度別制作物対応先"]',
    )!
    await act(async () => {
      destination.value = 'u'
      destination.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(planning.equipmentMethods![0]!.allocation!.taxUnitId).toBe('u')
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '制作物別に配分を入力し直す')!
        .click(),
    )
    expect(planning.equipmentMethods![0]!.allocation).toMatchObject({
      targets: [],
      taxUnitId: null,
      projectAllocationRatio: null,
      businessUseRatio: 0.8,
    })
    const addTarget = container.querySelector<HTMLSelectElement>('[aria-label="PCの配分先を追加"]')!
    await act(async () => {
      addTarget.value = 'u'
      addTarget.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(planning.equipmentMethods![0]!.allocation!.targets).toEqual([
      { taxUnitId: 'u', shareBps: null },
    ])
    const share = container.querySelector<HTMLInputElement>('[aria-label="PCの制作物uへの割合"]')!
    for (const [value, expected] of [
      ['33.33', 3333],
      ['0', 0],
      ['', null],
    ] as const) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          share,
          value,
        )
        share.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(planning.equipmentMethods![0]!.allocation!.targets![0]!.shareBps).toBe(expected)
    }
    // A native input event must work even when React's value tracker already saw the value.
    await act(async () => {
      share.value = '50'
      share.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(planning.equipmentMethods![0]!.allocation!.targets![0]!.shareBps).toBe(5000)
    await act(async () => {
      share.value = ''
      share.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(planning.equipmentMethods![0]!.allocation!.targets![0]!.shareBps).toBeNull()
    await act(async () => {
      share.value = '50'
      share.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="PCの制作物uへの割合を未確認に戻す"]')!
        .click(),
    )
    expect(planning.equipmentMethods![0]!.allocation!.targets![0]!.shareBps).toBeNull()
    planning.profile.taxYear = 2027
    await act(async () => render())
    expect(container.textContent).toContain('計算条件は未登録')
    await act(async () => container.querySelector('button')!.click())
    expect(planning.equipmentMethods).toHaveLength(2)
    const remove = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'この年度の計算条件を取り除く',
    )!
    await act(async () => remove.click())
    expect(planning.equipmentMethods!.map((row) => row.taxYear)).toEqual([2026])
    expect(planning.equipmentMethods![0]!.allocation!.businessUseRatio).toBe(0.8)
    expect(planning.equipment[0]!.acquisitionCostJpy).toBe(240000)
    expect(planning.equipmentMethods![0]!.allocation!.targets).toEqual([
      { taxUnitId: 'u', shareBps: null },
    ])
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
