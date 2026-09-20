/** @vitest-environment jsdom */
import assert from 'node:assert/strict'
import { afterEach, describe, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useEditorRecovery } from '../../src/client/useEditorRecovery'
import { retainEditorCopy, listEditorCopies, editorCopyKey } from '../../src/client/editorRecovery'

const valid = (value: unknown): value is { note: string } => Boolean(value && typeof value === 'object' && 'note' in value && typeof value.note === 'string')
type Controller = ReturnType<typeof useEditorRecovery<{ note: string }>>
const mounted: Array<{ root: Root; element: HTMLDivElement }> = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
function view(dataset = 'dataset-a', revision = 1) {
  let current!: Controller
  function Harness() { current = useEditorRecovery(dataset, 'test', revision, valid); return null }
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element); mounted.push({ root, element })
  act(() => root.render(createElement(Harness)))
  return { get current() { return current }, root }
}
function seed() {
  const record = { version: 1 as const, datasetId: 'dataset-a', editor: 'test', id: 'seed', parentRevision: 1,
    updatedAt: '2026-09-20T01:00:00Z', value: { note: 'unfinished' } }
  return { record, raw: retainEditorCopy(localStorage, record, null) }
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const { root, element } of mounted.splice(0)) { act(() => root.unmount()); element.remove() }
  localStorage.clear()
})
describe('C04 real React recovery hook lifecycle', () => {
  it('does not automatically restore a saved copy; restores only after explicit selection', () => {
    const { raw } = seed(), page = view('dataset-a', 2)
    assert.equal(page.current.value, null); assert.equal(page.current.copies.length, 1)
    act(() => { assert.equal(page.current.restore(raw), true) })
    assert.equal(page.current.value!.note, 'unfinished'); assert.equal(page.current.parentRevision, 1)
    assert.ok(page.current.warning.includes('保存元1版'))
  })
  it('forks two tabs recovering the same source and preserves both independent edits', () => {
    const { record, raw } = seed(), a = view(), b = view()
    act(() => { a.current.restore(raw); b.current.restore(raw) })
    act(() => { a.current.change({ note: 'a' }); b.current.change({ note: 'b' }) })
    const copies = listEditorCopies(localStorage, 'dataset-a', 'test', valid).copies
    assert.equal(copies.length, 3); assert.deepEqual(new Set(copies.map(({ copy }) => copy.value.note)), new Set(['unfinished', 'a', 'b']))
    act(() => { a.current.close() })
    assert.equal(localStorage.getItem(editorCopyKey(record)), null)
    assert.ok(listEditorCopies(localStorage, 'dataset-a', 'test', valid).copies.some(({ copy }) => copy.value.note === 'b'))
  })
  it('keeps the form and last good local copy when quota fails', () => {
    const page = view(); act(() => page.current.change({ note: 'before' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    act(() => page.current.change({ note: 'after' }))
    assert.equal(page.current.value!.note, 'after'); assert.ok(page.current.warning.includes('画面に保持'))
    assert.equal(listEditorCopies(localStorage, 'dataset-a', 'test', valid).copies[0]!.copy.value.note, 'before')
  })
  it('does not let a stale asynchronous continuation write after unmount', () => {
    const page = view(), stale = page.current
    act(() => page.root.unmount()); mounted.splice(0)
    stale.change({ note: 'too late' })
    assert.equal(localStorage.length, 0)
  })
  it('does not apply another dataset or replace an actively edited form', () => {
    const { raw } = seed(), page = view('dataset-b')
    act(() => { assert.equal(page.current.restore(raw), false) })
    assert.equal(page.current.value, null)
    act(() => page.current.change({ note: 'own' }))
    act(() => { assert.equal(page.current.restore(raw), false) })
    assert.equal(page.current.value!.note, 'own')
  })
  it('leaves changed copies untouched after a successful edit completion', () => {
    const page = view(); act(() => page.current.change({ note: 'own' }))
    const row = listEditorCopies(localStorage, 'dataset-a', 'test', valid).copies[0]!
    const replacement = row.raw.replace('own', 'other')
    localStorage.setItem(editorCopyKey(row.copy), replacement)
    act(() => { assert.equal(page.current.close(), true) })
    assert.equal(page.current.value, null); assert.equal(localStorage.getItem(editorCopyKey(row.copy)), replacement)
    assert.ok(page.current.warning.includes('削除せず'))
  })
})
