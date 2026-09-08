// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import RestoreSourcesPanel from '../../src/client/pages/RestoreSourcesPanel'
import * as api from '../../src/client/api'
vi.mock('../../src/client/api', async (original) => ({
  ...(await original<typeof api>()),
  getRestoreSources: vi.fn(),
  getRuntime: vi.fn(),
  saveRestoreSources: vi.fn(),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  vi.resetAllMocks()
})
const fixture = (): api.RestoreSourcePreview => ({
  plan: {
    version: 1,
    baseHash: 'a'.repeat(64),
    sources: [{ sourceId: 's', root: 'C:\\old', enabled: true }],
  },
  descriptions: [{ sourceId: 's', provider: 'claude', name: '元PC', kind: 'default' }],
  message: '確認',
})
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!
async function render() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.mocked(api.getRestoreSources).mockResolvedValue(fixture())
  vi.mocked(api.getRuntime).mockResolvedValue({ csrfToken: 'token' } as Awaited<
    ReturnType<typeof api.getRuntime>
  >)
  const completed = vi.fn()
  await act(async () => root.render(<RestoreSourcesPanel onComplete={completed} />))
  await act(async () => button('復元した読み取り元を確認').click())
  return completed
}
async function confirm() {
  await act(async () =>
    container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]!.click(),
  )
}
async function fill(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type=text]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('requires explicit confirmation, clears it after editing, and replays unchanged plans after a lost response', async () => {
  const completed = await render()
  expect(button('この接続先を保存して走査保留を解除').disabled).toBe(true)
  await confirm()
  await fill('C:\\moved')
  expect(button('この接続先を保存して走査保留を解除').disabled).toBe(true)
  await confirm()
  vi.mocked(api.saveRestoreSources)
    .mockRejectedValueOnce(new Error('応答不明'))
    .mockResolvedValueOnce({ reconnected: true, scanStarted: false })
  await act(async () => button('この接続先を保存して走査保留を解除').click())
  const first = vi.mocked(api.saveRestoreSources).mock.calls[0]
  expect(container.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe('C:\\moved')
  await act(async () => button('この接続先を保存して走査保留を解除').click())
  expect(vi.mocked(api.saveRestoreSources).mock.calls[1]).toEqual(first)
  expect(completed).toHaveBeenCalledOnce()
})
it('keeps edits after conflict and read failure, then retains a copy when loading a new plan', async () => {
  await render()
  await fill('C:\\my-input')
  await confirm()
  vi.mocked(api.saveRestoreSources).mockRejectedValueOnce(
    new api.ApiRequestError(409, '別更新', 'restore_conflict'),
  )
  await act(async () => button('この接続先を保存して走査保留を解除').click())
  vi.mocked(api.getRestoreSources).mockRejectedValueOnce(new Error('読取失敗'))
  await act(async () => button('入力を控えて最新の接続情報を読み直す').click())
  expect(container.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe('C:\\my-input')
  const next = fixture()
  next.plan.baseHash = 'b'.repeat(64)
  next.plan.sources[0]!.root = 'C:\\latest'
  vi.mocked(api.getRestoreSources).mockResolvedValue(next)
  await act(async () => button('入力を控えて最新の接続情報を読み直す').click())
  expect(container.textContent).toContain('C:\\my-input')
  expect(container.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe('C:\\latest')
  expect(button('この接続先を保存して走査保留を解除').disabled).toBe(true)
})
