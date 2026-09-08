// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import type { PendingBalanceDecision } from '../../src/accounting/types'
import ConsultationAnswersEditor from '../../src/client/pages/ConsultationAnswersEditor'
import ConsultationAnswersPanel from '../../src/client/pages/ConsultationAnswersPanel'
import PendingBalanceEditor from '../../src/client/pages/PendingBalanceEditor'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import type { BalanceSnapshot } from '../../src/accounting/types'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

it('requires confirmation of the answers used for resolution and detects a later edit', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const planning = emptyPlanningSnapshot(2026)
  planning.decisions = [
    {
      id: 'd',
      taxUnitId: 'u',
      taxYear: 2026,
      candidate: '確認',
      selectedCandidate: '確認',
      reason: '確認理由',
      engineVersion: 'manual-decision/1',
      status: 'confirmed',
      createdAt: '2026-01-01T00:00:00Z',
      confirmedAt: '2026-01-02T00:00:00Z',
    },
  ]
  function Harness() {
    const [snapshot, setSnapshot] = useState<BalanceSnapshot>({
      version: 1,
      accounts: [],
      movements: [],
      pendingDecisions: [
        {
          id: 'q',
          taxYear: 2026,
          taxUnitId: 'u',
          amount: { status: 'known', amountJpy: 0 },
          accountIds: [],
          sourceIds: [],
          reasons: ['用途を確認'],
          answers: [
            {
              id: 'a',
              taxYear: 2026,
              receivedOn: '2026-02-01',
              kind: 'fact',
              answer: '元の回答',
              source: '本人',
            },
          ],
          resolution: { taxYear: 2026, decisionId: 'd', reason: '回答を確認' },
        },
      ],
    })
    return (
      <PendingBalanceEditor
        snapshot={snapshot}
        planning={planning}
        sources={[]}
        year={2026}
        busy={false}
        edit={(change) =>
          setSnapshot((current) => {
            const next = structuredClone(current)
            change(next)
            return next
          })
        }
      />
    )
  }
  try {
    await act(async () => root.render(<Harness />))
    expect(host.textContent).toContain('現在の回答を使った解消は未確認')
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === 'この回答と判断で解消を確認')!
        .click(),
    )
    expect(host.textContent).not.toContain('現在の回答を使った解消は未確認')
    expect(host.textContent).toContain('2026年から解消として記録')
    await act(async () => {
      const label = [...host.querySelectorAll('label')].find((label) =>
        label.textContent?.startsWith('回答内容'),
      )!
      const input = label.querySelector('textarea')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        '訂正した回答',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).toContain('現在の回答を使った解消は未確認')
    expect(host.textContent).not.toContain('2026年から解消として記録')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it('keeps answers with their question, separates kinds and requires a separate resolution', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function Harness() {
    const [value, setValue] = useState<PendingBalanceDecision>({
      id: 'q',
      taxYear: 2026,
      taxUnitId: 'unit',
      amount: { status: 'unknown', amountJpy: null, reasons: ['不明'] },
      accountIds: [],
      sourceIds: [],
      reasons: ['実際の用途は何か'],
    })
    return (
      <>
        <ConsultationAnswersEditor
          value={value}
          year={2026}
          onChange={(answers) => setValue({ ...value, answers })}
        />
        <ConsultationAnswersPanel
          snapshot={{ version: 1, accounts: [], movements: [], pendingDecisions: [value] }}
          year={2026}
        />
      </>
    )
  }
  try {
    await act(async () => root.render(<Harness />))
    expect(host.textContent).toContain('この対象年までの回答は未収録')
    await act(async () => host.querySelector('button')!.click())
    await act(async () => {
      const date = host.querySelector<HTMLInputElement>('input[type="date"]')!
      date.value = '2026-09-09'
      date.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelector('[aria-label="記録した相談回答"]')!.textContent).toContain(
      '受領日：2026-09-09',
    )
    const fields = host.querySelectorAll('textarea')
    await act(async () => {
      for (const [field, value] of [
        [fields[0]!, '確認した業務用途 <script>'],
        [fields[1]!, '本人の記録'],
      ] as const) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          field,
          value,
        )
        field.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    const panel = host.querySelector('[aria-label="記録した相談回答"]')!
    expect(panel.textContent).toContain('実際の用途は何か')
    expect(panel.textContent).toContain('確認した業務用途 <script>')
    expect(panel.textContent).toContain('事実についての回答')
    expect(panel.textContent).toContain('解消判断は未登録')
    expect(panel.querySelector('script')).toBeNull()
    await act(async () => {
      const select = host.querySelector('select')!
      select.value = 'method'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(panel.textContent).toContain('方法についての回答')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
