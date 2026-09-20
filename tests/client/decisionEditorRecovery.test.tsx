// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DecisionEditor from '../../src/client/pages/DecisionEditor'
import { listEditorCopies } from '../../src/client/editorRecovery'
import { validDecisionEditorValue } from '../../src/client/decisionEditorValue'
import { demoPlanning } from '../../src/client/dashboard'
import type { DecisionRecord } from '../../src/planning/types'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('DecisionEditor unsent recovery', () => {
  let container: HTMLDivElement
  let root: Root
  let latest: DecisionRecord[] = []

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
  })

  function button(name: string) {
    return [...container.querySelectorAll('button')].find((item) => item.textContent === name)!
  }
  function field(label: string) {
    return [...container.querySelectorAll('label')]
      .find((item) => item.textContent?.trim().startsWith(label))!
      .querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input,select,textarea',
      )!
  }
  async function fill(label: string, value: string) {
    const input = field(label)
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value)
      input.dispatchEvent(
        new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
      )
    })
  }
  async function render(saved: DecisionRecord[] = [], datasetId = 'dataset-a', revision = 7) {
    function Harness() {
      const [rows, setRows] = useState<DecisionRecord[]>(structuredClone(saved))
      latest = rows
      return (
        <DecisionEditor
          value={rows}
          savedValue={saved}
          units={demoPlanning.taxUnits}
          year={2026}
          datasetId={datasetId}
          parentRevision={revision}
          onChange={setRows}
        />
      )
    }
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  }
  async function unmount() {
    await act(async () => root.unmount())
    container.remove()
  }

  it('recovers unfinished text and year with the original revision without saving or confirming', async () => {
    await render()
    await act(async () => button('判断記録を追加').click())
    await fill('判断する制作物', demoPlanning.taxUnits[0]!.id)
    await fill('検討した扱い', '入力途中')
    await fill('判断の対象年', '202')
    const copies = listEditorCopies(
      localStorage,
      'dataset-a',
      'decision-records',
      validDecisionEditorValue,
    ).copies
    expect(copies).toHaveLength(1)
    expect(copies[0]!.copy.parentRevision).toBe(7)
    expect(copies[0]!.copy.value.yearInputs[0]!.raw).toBe('202')
    expect(copies[0]!.copy.value.decisions[0]).toMatchObject({
      taxYear: 2026,
      candidate: '入力途中',
      status: 'pending',
    })
    await unmount()

    container = document.createElement('div')
    document.body.append(container)
    await render()
    await act(async () => button('この内容を復旧').click())
    expect((field('判断の対象年') as HTMLInputElement).value).toBe('202')
    expect((field('検討した扱い') as HTMLInputElement).value).toBe('入力途中')
    expect(latest[0]).toMatchObject({ taxYear: 2026, status: 'pending' })
    expect(container.textContent).toContain('まだworkspaceへ保存・送信・本人確認していません')
    await unmount()
  })

  it('does not offer another dataset copy for restoration', async () => {
    await render()
    await act(async () => button('判断記録を追加').click())
    await fill('検討した扱い', 'dataset-a only')
    await unmount()

    container = document.createElement('div')
    document.body.append(container)
    await render([], 'dataset-b')
    expect(container.textContent).not.toContain('未送信の判断案を再開')
    expect(
      listEditorCopies(
        localStorage,
        'dataset-b',
        'decision-records',
        validDecisionEditorValue,
      ).copies,
    ).toEqual([])
    await unmount()
  })

  it('keeps screen input when localStorage quota prevents updating the copy', async () => {
    await render()
    await act(async () => button('判断記録を追加').click())
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      await fill('検討した扱い', '画面に残る入力')
      expect((field('検討した扱い') as HTMLInputElement).value).toBe('画面に残る入力')
      expect(container.textContent).toContain('入力は画面に保持しています')
    } finally {
      storage.mockRestore()
    }
    await unmount()
  })

  it('shows a same-record conflict and requires explicit rebase instead of overwriting it', async () => {
    const saved: DecisionRecord[] = [{
      id: 'decision:2026',
      taxUnitId: demoPlanning.taxUnits[0]!.id,
      taxYear: 2026,
      engineVersion: 'manual-decision/1',
      candidate: '候補',
      selectedCandidate: '扱い',
      status: 'overridden',
      reason: '保存元',
      createdAt: '2026-01-01T00:00:00Z',
      confirmedAt: '2026-01-01T01:00:00Z',
    }]
    await render(saved)
    await fill('判断の根拠・確認先', '編集中')
    await unmount()

    const changed = structuredClone(saved)
    changed[0]!.reason = '別タブで保存済み'
    container = document.createElement('div')
    document.body.append(container)
    await render(changed, 'dataset-a', 8)
    await act(async () => button('この内容を復旧').click())
    expect(container.textContent).toContain('勝手に上書きしません')
    expect((field('判断の根拠・確認先') as HTMLTextAreaElement).value).toBe('編集中')
    expect(button('この判断内容を確認した').disabled).toBe(true)
    await act(async () =>
      button('現在の保存を比較元にして、この判断案を続ける').click(),
    )
    expect(container.textContent).not.toContain('勝手に上書きしません')
    expect(container.textContent).toContain('この操作だけではworkspaceへ保存しません')
    await unmount()
  })
})
