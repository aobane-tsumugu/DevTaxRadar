// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { demoDashboard, demoPlanning } from '../../src/client/dashboard.ts'
import Onboarding from '../../src/client/pages/Onboarding.tsx'
import type { LocalConfiguration, RuntimeData } from '../../src/client/types.ts'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts'

const configuration: LocalConfiguration = {
  charges: { claude: 0, codex: 0 },
  monthlyCharges: [{ provider: 'codex', month: '2030-01', amountJpy: 4567 }],
  contracts: { claude: {}, codex: {} },
  chargePeriods: [
    {
      id: 'charge-preview',
      provider: 'claude',
      planName: 'Preview plan',
      serviceStartedOn: '2026-07-01',
      serviceEndedOn: '2026-07-31',
      amountJpy: 31_000,
    },
  ],
  unobservedRatio: 0,
}

const runtime = {
  providers: {
    claude: { detected: true },
    codex: { detected: false },
  },
  retention: { claude: {}, codex: {} },
} as RuntimeData

describe('onboarding result refresh', () => {
  let container: HTMLDivElement | undefined

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    container?.remove()
    container = undefined
  })
  it('keeps retained-history warnings visible after advancing past the scan step', async () => {
    container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const scan = vi.fn(async () => ({
      completedAt: '2026-09-01T00:00:00Z',
      providers: {
        codex: {
          events: 3,
          diagnostics: { filesMissingRetained: 1, sessionsUnverifiedRetained: 2, filesDeferred: 1 },
        },
      },
      sources: [],
    }))
    function Harness() {
      const [step, setStep] = useState(0)
      return (
        <Onboarding
          step={step}
          onStep={setStep}
          data={demoDashboard}
          runtime={runtime}
          runtimeLoading={false}
          historySources={(['claude', 'codex'] as const).map((provider) => ({
            id: `synthetic-${provider}`,
            provider,
            kind: 'configured' as const,
            name: provider,
            root: `/synthetic/${provider}`,
            enabled: true,
            availability: 'available' as const,
            lastScan: { status: 'never' as const },
          }))}
          configuration={configuration}
          planning={demoPlanning}
          unassignedFolderCount={0}
          onScan={scan}
          onSaveHistorySource={async () => {}}
          onTestHistorySource={async () => ({ availability: 'available', filesDiscovered: 0 })}
          onRemoveHistorySource={async () => {}}
          onSaveRetention={async (days) => ({ days })}
          onSaveWorkspace={vi.fn()}
          onClose={vi.fn()}
        />
      )
    }
    try {
      await act(async () => root.render(<Harness />))
      const start = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === '履歴を確認して次へ',
      )!
      await act(async () => start.click())
      expect(scan).toHaveBeenCalledOnce()
      expect(container.querySelector('.setup-progress')?.getAttribute('aria-label')).toBe(
        '2/5まで進みました',
      )
      const warnings = container.querySelector('[aria-label="履歴の取得状態"]')!.textContent
      expect(warnings).toContain('見つからなかった原本1ファイルの取込済み数値を保持')
      expect(warnings).toContain('原本との対応を確認できない2セッション')
      expect(warnings).toContain('取り込み前に削除された履歴は復元できません')
      expect(warnings).toContain('初回のものは未取得')
      expect(container.querySelector('.setup-notice')!.textContent).toContain(
        '原本を確認できない保存済み数値を含みます',
      )
      expect(container.querySelector('.setup-notice.success')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('carries the question into the correct unit and year without saving or confirming a decision', async () => {
    container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const save = vi.fn(),
      close = vi.fn()
    const unit = demoPlanning.taxUnits[0]!
    const testPlanning = structuredClone(demoPlanning)
    testPlanning.decisions = []
    function Harness() {
      const [step, setStep] = useState(2)
      return (
        <Onboarding
          step={step}
          onStep={setStep}
          data={demoDashboard}
          runtime={runtime}
          runtimeLoading={false}
          historySources={[]}
          configuration={configuration}
          planning={testPlanning}
          unassignedFolderCount={0}
          consultation={{
            pendingId: 'question',
            taxUnitId: unit.id,
            question: '用途の確認',
            answer: {
              id: 'answer',
              taxYear: 2027,
              receivedOn: '2027-02-01',
              kind: 'fact',
              answer: '相談回答 <script>',
              source: '確認先',
            },
          }}
          onScan={async () => ({ completedAt: '2026-07-31T00:00:00Z', providers: {}, sources: [] })}
          onSaveHistorySource={async () => {}}
          onTestHistorySource={async () => ({ availability: 'available', filesDiscovered: 0 })}
          onRemoveHistorySource={async () => {}}
          onSaveRetention={async (days) => ({ days })}
          onSaveWorkspace={save}
          onClose={close}
        />
      )
    }
    const click = async (name: string) =>
      act(async () =>
        [...container!.querySelectorAll('button')]
          .find((button) => button.textContent === name)!
          .click(),
      )
    try {
      await act(async () => root.render(<Harness />))
      expect(container.querySelector('[aria-label="見直し元の相談回答"]')!.textContent).toContain(
        '相談回答 <script>',
      )
      expect(container.querySelector('script')).toBeNull()
      await click('対象の制作物・利用状況へ移動')
      expect(
        document.activeElement
          ?.closest('[data-consultation-unit]')
          ?.getAttribute('data-consultation-unit'),
      ).toBe(unit.id)
      await click('対象年の判断記録へ移動')
      await click('この回答の対象に判断記録を追加')
      const target = [...container.querySelectorAll('[data-consultation-decision]')].find(
        (row) => row.getAttribute('data-consultation-decision') === unit.id + ':2027',
      )!
      expect(target).toBeTruthy()
      const confirm = [...target.querySelectorAll('button')].find(
        (button) => button.textContent === 'この判断内容を確認した',
      )!
      expect(confirm.disabled).toBe(true)
      expect(save).not.toHaveBeenCalled()
      await click('回答と解消の入力へ戻る')
      expect(close).toHaveBeenCalledOnce()
      expect(testPlanning.decisions).toEqual([])
    } finally {
      await act(async () => root.unmount())
    }
  })

  it.each([
    { unobservedRatio: null, clear: false, mode: 'result' },
    { unobservedRatio: null, clear: false, mode: 'progress' },
    { unobservedRatio: null, clear: false, mode: 'presence' },
    { unobservedRatio: null, clear: false, mode: 'equipment-date-input' },
    { unobservedRatio: null, clear: false, mode: 'equipment-date-clear' },
    { unobservedRatio: null, clear: false, mode: 'failed-progress' },
    { unobservedRatio: 0, clear: false, mode: 'result' },
    { unobservedRatio: 0.1234, clear: false, mode: 'result' },
    { unobservedRatio: 0.1234, clear: true, mode: 'result' },
    { unobservedRatio: null, clear: false, mode: 'unknown-charge' },
    { unobservedRatio: null, clear: false, mode: 'missing-monthly-reason' },
    { unobservedRatio: null, clear: false, mode: 'unknown-default' },
    { unobservedRatio: null, clear: false, mode: 'empty-default' },
    { unobservedRatio: null, clear: false, mode: 'invoice-evidence' },
    { unobservedRatio: null, clear: false, mode: 'zero-charge' },
    { unobservedRatio: null, clear: false, mode: 'unknown-direct' },
    { unobservedRatio: null, clear: false, mode: 'zero-direct' },
    { unobservedRatio: null, clear: false, mode: 'unknown-home' },
    { unobservedRatio: null, clear: false, mode: 'zero-home' },
    { unobservedRatio: null, clear: false, mode: 'multi-home' },
    { unobservedRatio: null, clear: false, mode: 'multi-direct' },
    { unobservedRatio: null, clear: false, mode: 'unknown-equipment' },
    { unobservedRatio: null, clear: false, mode: 'zero-equipment' },
  ])(
    'preserves or clears the unobserved ratio $unobservedRatio (clear=$clear)',
    async ({ unobservedRatio, clear, mode }) => {
      const testPlanning = structuredClone(demoPlanning)
      if (mode === 'invoice-evidence')
        testPlanning.evidence = [
          {
            id: 'invoice-proof',
            evidenceType: 'memo',
            strength: 'self-recorded',
            recordedAt: '2026-01-01T00:00:00Z',
            note: '合成の請求確認',
            localReference: 'C:\\private\\invoice.pdf',
          },
        ]
      if (mode.endsWith('-home'))
        testPlanning.homeCosts = [
          {
            id: 'home-rent',
            category: 'rent',
            month: '2026-07',
            amountJpy: 4000,
            method: 'area-time',
            businessUseRatio: 0.5,
            projectAllocationRatio: 0.6,
            basis: '面積と時間',
            rationale: '同じ方法で継続',
            treatment: 'shared',
            evidenceIds: [],
          },
        ]
      if (mode.endsWith('-direct'))
        testPlanning.directCosts = [
          {
            id: 'entered-cost',
            incurredOn: '2026-01-01',
            costType: 'cloud',
            amountJpy: 2000,
            directlyAttributable: false,
            treatment: 'general',
            evidenceIds: [],
          },
        ]
      const savedWorkspace = vi.fn(
        async (_configuration: LocalConfiguration, _planning: typeof demoPlanning) => {},
      )

      if (mode === 'failed-progress')
        savedWorkspace.mockRejectedValueOnce(new Error('別の保存で内容が変わっています'))

      const previewWorkspace = vi.fn(async () => {})
      function Harness() {
        const [step, setStep] = useState(3)
        const [data, setData] = useState({
          ...demoDashboard,
          meta: { ...demoDashboard.meta, source: 'local' as const },
        })
        return (
          <Onboarding
            step={step}
            data={data}
            runtime={runtime}
            runtimeLoading={false}
            historySources={[]}
            configuration={{
              ...configuration,
              unobservedRatio,
              ...(mode === 'missing-monthly-reason'
                ? {
                    monthlyCharges: [
                      {
                        provider: 'codex' as const,
                        month: '2030-01',
                        amountJpy: null,
                        unknownAmountReason: '',
                      },
                    ],
                  }
                : {}),
            }}
            planning={testPlanning}
            unassignedFolderCount={0}
            onStep={setStep}
            onScan={async () => ({
              completedAt: '2026-07-31T00:00:00.000Z',
              providers: {},
              sources: [],
            })}
            onSaveHistorySource={async () => {}}
            onTestHistorySource={async () => ({ availability: 'available', filesDiscovered: 0 })}
            onRemoveHistorySource={async () => {}}
            onSaveRetention={async (days) => ({ days })}
            onPreviewWorkspace={previewWorkspace}
            onSaveWorkspace={async (configuration, planning) => {
              await savedWorkspace(configuration, planning)
              setData((current) => ({
                ...current,
                months: [{ label: '2026年7月', current: 12_345, future: 18_000, review: 655 }],
                costProjection: projectWorkspaceCosts(
                  {
                    ...emptyPlanningSnapshot(2026),
                    directCosts: [
                      {
                        id: 'result-cost',
                        incurredOn: '2026-07-01',
                        costType: 'domain',
                        amountJpy: 22222,
                        directlyAttributable: false,
                        treatment: 'general',
                        evidenceIds: [],
                      },
                    ],
                  },
                  [],
                ),
              }))
            }}
            onClose={() => {}}
          />
        )
      }

      container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => root.render(<Harness />))

      if (mode === 'multi-home' || mode === 'multi-direct') {
        const direct = mode === 'multi-direct'
        const name = direct ? 'direct-entered-cost' : '2026-07 rent'
        await act(async () =>
          [...container!.querySelectorAll('button')]
            .find(
              (button) =>
                button.textContent ===
                (direct ? '直接費を制作物別に配分し直す' : '制作物別に配分を入力し直す'),
            )!
            .click(),
        )
        const unitId = testPlanning.taxUnits[0]!.id
        const select = container.querySelector<HTMLSelectElement>(
          'select[aria-label="' + name + 'の配分先を追加"]',
        )!
        await act(async () => {
          select.value = unitId
          select.dispatchEvent(new Event('change', { bubbles: true }))
        })
        const input = container.querySelector<HTMLInputElement>(
          `input[aria-label="${name}の制作物${unitId}への割合"]`,
        )!
        await act(async () => {
          input.value = '25'
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await act(async () =>
          [...container!.querySelectorAll('button')]
            .find((button) => button.textContent === 'ここまで保存')!
            .click(),
        )
        if (direct)
          expect(savedWorkspace.mock.calls[0]![1].directCosts[0]).toMatchObject({
            amountJpy: 2000,
            treatment: 'shared',
            directlyAttributable: false,
            targets: [{ taxUnitId: unitId, shareBps: 2500 }],
          })
        else
          expect(savedWorkspace.mock.calls[0]![1].homeCosts[0]).toMatchObject({
            amountJpy: 4000,
            businessUseRatio: 0.5,
            projectAllocationRatio: 0,
            targets: [{ taxUnitId: unitId, shareBps: 2500 }],
          })
        expect(container.textContent).not.toContain('設備年額の業務分')
        await act(async () => root.unmount())
        return
      }
      if (mode === 'invoice-evidence') {
        const fieldset = [...container.querySelectorAll('fieldset')].find(
          (row) => row.querySelector('legend')?.textContent === 'この請求の根拠',
        )!
        expect(fieldset.textContent).toContain('合成の請求確認')
        expect(fieldset.textContent).not.toContain('invoice.pdf')
        const input = fieldset.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        await act(async () => input.click())
        expect(input.checked).toBe(true)
        await act(async () => input.click())
        expect(input.checked).toBe(false)
        await act(async () =>
          [...container!.querySelectorAll('button')]
            .find((row) => row.textContent === 'ここまで保存')!
            .click(),
        )
        expect(savedWorkspace.mock.calls[0]![0].chargePeriods?.[0]?.evidenceIds).toEqual([])
        await act(async () => input.click())
        await act(async () =>
          [...container!.querySelectorAll('button')]
            .find((row) => row.textContent === 'ここまで保存')!
            .click(),
        )
        expect(savedWorkspace.mock.calls[1]![0].chargePeriods?.[0]?.evidenceIds).toEqual([
          'invoice-proof',
        ])
        await act(async () => root.unmount())
        return
      }
      if (mode === 'empty-default') {
        const input = container.querySelector<HTMLInputElement>(
          'input[aria-label="Claude Code 月額"]',
        )!
        expect(input.value).toBe('0')
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await act(async () =>
          [...container!.querySelectorAll('button')]
            .find((row) => row.textContent === 'ここまで保存')!
            .click(),
        )
        expect(savedWorkspace.mock.calls[0]![0].charges).toEqual({ claude: null, codex: 0 })
        expect(savedWorkspace.mock.calls[0]![0].unknownChargeReasons).toEqual({
          claude: '既定月額が未入力です。',
        })
        await act(async () => root.unmount())
        return
      }
      if (mode === 'unknown-default') {
        const click = async (label: string) =>
          act(async () =>
            [...container!.querySelectorAll('button')]
              .find((item) => item.textContent === label)!
              .click(),
          )
        await click('Claude Codeの既定月額を不明にする')
        await click('ここまで保存')
        expect(savedWorkspace).not.toHaveBeenCalled()
        expect(container.textContent).toContain('既定月額が不明な理由を入力してください')
        const field = container.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Claude Codeの既定月額が不明な理由"]',
        )!
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
            field,
            '請求書の確認待ち',
          )
          field.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await click('ここまで保存')
        expect(savedWorkspace.mock.calls[0]![0].charges.claude).toBeNull()
        expect(savedWorkspace.mock.calls[0]![0].unknownChargeReasons).toEqual({
          claude: '請求書の確認待ち',
        })
        const amount = container.querySelector<HTMLInputElement>(
          'input[aria-label="Claude Code 月額"]',
        )!
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            amount,
            '0',
          )
          amount.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await click('ここまで保存')
        expect(savedWorkspace.mock.calls[1]![0].charges.claude).toBe(0)
        expect(savedWorkspace.mock.calls[1]![0].unknownChargeReasons).toBeUndefined()
        await act(async () => root.unmount())
        return
      }
      if (mode === 'missing-monthly-reason') {
        for (const label of ['ここまで保存', '変更の影響を確認', '保存して結果を見る']) {
          const button = [...container.querySelectorAll('button')].find(
            (item) => item.textContent === label,
          )!
          await act(async () => button.click())
          expect(container.textContent).toContain(
            '2030年1月のCodex料金が不明な理由を入力してください。',
          )
          expect(savedWorkspace).not.toHaveBeenCalled()
          expect(previewWorkspace).not.toHaveBeenCalled()
        }
        const field = container.querySelector<HTMLInputElement>(
          'input[aria-label="2030年1月 codex料金不明の理由"]',
        )!
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            field,
            '請求書を確認中',
          )
          field.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await act(async () =>
          [...container!.querySelectorAll('button')]
            .find((item) => item.textContent === 'ここまで保存')!
            .click(),
        )
        expect(savedWorkspace).toHaveBeenCalledOnce()
        expect(savedWorkspace.mock.calls[0]![0].monthlyCharges).toEqual([
          {
            provider: 'codex',
            month: '2030-01',
            amountJpy: null,
            unknownAmountReason: '請求書を確認中',
          },
        ])
        await act(async () => root.unmount())
        return
      }

      if (mode === 'equipment-date-input' || mode === 'equipment-date-clear') {
        const input = [...container.querySelectorAll('input')].find(
          (item) => item.closest('label')?.textContent === '業務で使い始めた日',
        )!
        await act(async () => {
          input.value = mode === 'equipment-date-clear' ? '' : '2026-07-31'
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }

      if (mode === 'presence') {
        const state = container.querySelector<HTMLSelectElement>(
          'select[aria-label="自宅費用の確認状態"]',
        )!
        await act(async () => {
          state.value = 'deferred'
          state.dispatchEvent(new Event('change', { bubbles: true }))
        })
        const reason = container.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="自宅費用の確認理由"]',
        )!
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
            reason,
            '請求明細との照合待ち',
          )
          reason.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }

      const ratioInput = container.querySelector<HTMLInputElement>(
        'input[aria-label="未取得利用割合"]',
      )!
      if (mode.endsWith('-direct')) {
        const costInput = container.querySelector<HTMLInputElement>(
          'input[aria-label="直接費の金額"]',
        )!
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
            costInput,
            '',
          )
          costInput.dispatchEvent(new Event('input', { bubbles: true }))
        })
        expect(container.querySelector('input[aria-label="直接費の金額が不明な理由"]')).toBeTruthy()
        if (mode === 'zero-direct')
          await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              costInput,
              '0',
            )
            costInput.dispatchEvent(new Event('input', { bubbles: true }))
          })
      }
      if (mode.endsWith('-charge')) {
        const clearAmount = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === '請求額を不明に戻す',
        )!
        await act(async () => clearAmount.click())
        const label = [...container.querySelectorAll('label')].find(
          (label) => label.querySelector('span')?.textContent === '実際の請求額',
        )!
        const amount = label.querySelector('input')!
        expect(amount.value).toBe('')
        expect(container.querySelector('[aria-label="AI請求額が不明な理由"]')).toBeTruthy()
        if (mode === 'zero-charge')
          await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              amount,
              '0',
            )
            amount.dispatchEvent(new Event('input', { bubbles: true }))
          })
      }
      expect(ratioInput).toBeTruthy()
      if (mode.endsWith('-equipment')) {
        const clearAmount = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === '購入額を不明に戻す',
        )!
        await act(async () => clearAmount.click())
        const amount = container.querySelector<HTMLInputElement>('[aria-label="設備の購入額"]')!
        expect(amount.value).toBe('')
        expect(container.querySelector('[aria-label="設備の購入額が不明な理由"]')).toBeTruthy()
        if (mode === 'zero-equipment')
          await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              amount,
              '0',
            )
            amount.dispatchEvent(new Event('input', { bubbles: true }))
          })
      }
      if (mode.endsWith('-home')) {
        const clearAmount = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === '支払額を不明に戻す',
        )!
        await act(async () => clearAmount.click())
        const amount = container.querySelector<HTMLInputElement>('[aria-label="自宅費用の支払額"]')!
        expect(amount.value).toBe('')
        expect(container.querySelector('[aria-label="自宅費用の支払額が不明な理由"]')).toBeTruthy()
        if (mode === 'zero-home')
          await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              amount,
              '0',
            )
            amount.dispatchEvent(new Event('input', { bubbles: true }))
          })
      }
      if (unobservedRatio === null) expect(ratioInput.value).toBe('')
      else expect(ratioInput.valueAsNumber).toBeCloseTo(unobservedRatio * 100)
      if (clear) {
        const clearButton = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === '割合を不明に戻す',
        )!
        await act(async () => clearButton.click())
        expect(ratioInput.value).toBe('')
      }

      const resultButton = [...container.querySelectorAll('button')].find(
        (button) =>
          button.textContent === (mode === 'result' ? '保存して結果を見る' : 'ここまで保存'),
      )
      expect(resultButton).toBeTruthy()
      await act(async () => {
        resultButton!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(savedWorkspace).toHaveBeenCalledOnce()
      if (unobservedRatio === null || clear)
        expect(savedWorkspace.mock.calls[0]![0].unobservedRatio).toBeNull()
      else expect(savedWorkspace.mock.calls[0]![0].unobservedRatio).toBeCloseTo(unobservedRatio)
      const expectedPlanning = structuredClone(testPlanning)
      if (mode === 'equipment-date-input')
        expectedPlanning.equipment[0]!.businessUseStartedOn = '2026-07-31'
      if (mode === 'equipment-date-clear')
        expectedPlanning.equipment[0]!.businessUseStartedOn = undefined
      if (mode === 'presence')
        expectedPlanning.costPresence = [
          {
            id: expect.any(String),
            taxYear: testPlanning.profile.taxYear,
            category: 'home',
            status: 'deferred',
            reason: '請求明細との照合待ち',
            recordedAt: expect.any(String),
          },
        ]
      if (mode.endsWith('-equipment')) {
        expectedPlanning.equipment[0]!.acquisitionCostJpy = mode === 'unknown-equipment' ? null : 0
        if (mode === 'unknown-equipment')
          expectedPlanning.equipment[0]!.unknownAmountReason = '購入額をまだ確認していません。'
      }
      if (mode.endsWith('-home')) {
        expectedPlanning.homeCosts[0]!.amountJpy = mode === 'unknown-home' ? null : 0
        if (mode === 'unknown-home')
          expectedPlanning.homeCosts[0]!.unknownAmountReason = '支払額をまだ確認していません。'
      }
      if (mode.endsWith('-direct')) {
        expectedPlanning.directCosts[0]!.amountJpy = mode === 'unknown-direct' ? null : 0
        if (mode === 'unknown-direct')
          expectedPlanning.directCosts[0]!.unknownAmountReason = '金額をまだ確認していません。'
      }
      expect(savedWorkspace.mock.calls[0]![1]).toEqual(expectedPlanning)
      const expectedCharges = structuredClone(configuration.chargePeriods)
      if (mode.endsWith('-charge')) {
        expectedCharges[0]!.amountJpy = mode === 'unknown-charge' ? null : 0
        if (mode === 'unknown-charge')
          expectedCharges[0]!.unknownAmountReason = '請求額をまだ確認していません。'
      }
      expect(savedWorkspace.mock.calls[0]![0].chargePeriods).toEqual(expectedCharges)
      expect(savedWorkspace.mock.calls[0]![0].monthlyCharges).toContainEqual(
        configuration.monthlyCharges[0],
      )
      expect(savedWorkspace.mock.calls[0]![0].monthlyCharges).toEqual(configuration.monthlyCharges)
      if (mode === 'result') {
        expect(container.textContent).toContain('いまの整理結果です')
        expect(container.textContent).toContain('￥22,222')
        expect(container.textContent).not.toContain('￥12,345')
        expect(container.textContent).not.toContain('￥18,000')
        expect(container.textContent).not.toContain('￥655')
        expect(container.querySelector('[aria-label="申告区分ごとの結果"]')).toBeNull()
        expect(container.textContent).toContain(
          '費用基礎は、採用済みの当年費用・資産残高とは別です',
        )
        expect(container.textContent).toContain('原額や費用基礎をそのまま将来残高へ写しません')
        const details = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === '原額・配分・未算定理由を見る',
        )!
        await act(async () => details.click())
        expect(container.textContent).toContain('支払・購入の原額 ￥22,222')
      } else {
        expect(container.textContent).not.toContain('いまの整理結果です')
        if (mode === 'failed-progress') {
          expect(container.textContent).toContain('別の保存で内容が変わっています')
          expect(ratioInput.value).toBe('')
          await act(async () => resultButton!.click())
          expect(savedWorkspace).toHaveBeenCalledTimes(2)
          expect(savedWorkspace.mock.calls[1]).toEqual(savedWorkspace.mock.calls[0])
        }
        expect(container.textContent).toContain('ここまでの入力を保存しました')
      }
      await act(async () => root.unmount())
    },
  )
})
