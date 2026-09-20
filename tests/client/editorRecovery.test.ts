import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { encodeEditorCopy, decodeEditorCopy, retainEditorCopy, listEditorCopies, removeEditorCopy,
  restoreEditorCopy, editorCopyKey, type EditorCopy } from '../../src/client/editorRecovery.js'
import { validSoftwareMethodForm } from '../../src/client/softwareMethodForm.js'
function storage(): Storage {
  const data = new Map<string, string>()
  return { get length() { return data.size }, key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) },
    removeItem: (key) => { data.delete(key) }, clear: () => data.clear() }
}
const valid = (value: unknown): value is { reason: string } => Boolean(value && typeof value === 'object' && 'reason' in value && typeof value.reason === 'string')
const copy = (patch: Partial<EditorCopy<{ reason: string }>> = {}): EditorCopy<{ reason: string }> => ({
  version: 1, datasetId: 'dataset-a', editor: 'cost-treatment', id: 'tab-a', parentRevision: 7,
  updatedAt: '2026-09-20T01:00:00Z', value: { reason: '' }, ...patch,
})
describe('unsent editor recovery', () => {
  it('retains unfinished empty text without producing an HTTP request', () => {
    const db = storage(), c = copy(), before = structuredClone(c)
    const raw = retainEditorCopy(db, c, null)
    assert.deepEqual(decodeEditorCopy(raw, valid), before)
    assert.deepEqual(c, before)
    assert.equal(db.length, 1)
    assert.ok(!raw.includes('requestId'))
  })
  it('keeps the original revision and edit origin when recovering after another save', () => {
    const c = copy({ value: { reason: '入力中' } })
    const restored = restoreEditorCopy(encodeEditorCopy(c), 'dataset-a', 'cost-treatment', valid)
    assert.equal(restored.parentRevision, 7)
    assert.deepEqual(restored.value, c.value)
    restored.value.reason = 'changed'
    assert.equal(c.value.reason, '入力中')
  })
  for (const [dataset, editor] of [['dataset-b','cost-treatment'],['dataset-a','software-method']])
    it(`rejects restoration into ${dataset}/${editor}`, () => {
      assert.throws(() => restoreEditorCopy(encodeEditorCopy(copy()), dataset!, editor!, valid), /別の/)
    })
  it('lists only this dataset and editor without deleting other copies', () => {
    const db = storage()
    retainEditorCopy(db, copy(), null)
    retainEditorCopy(db, copy({ datasetId: 'dataset-b' }), null)
    retainEditorCopy(db, copy({ editor: 'software-method' }), null)
    assert.equal(listEditorCopies(db, 'dataset-a', 'cost-treatment', valid).copies.length, 1)
    assert.equal(db.length, 3)
  })
  it('two tabs use different IDs and cannot silently replace each other', () => {
    const db = storage(), a = copy(), b = copy({ id: 'tab-b' })
    retainEditorCopy(db, a, null); retainEditorCopy(db, b, null)
    assert.equal(db.length, 2)
    assert.throws(() => retainEditorCopy(db, copy({ value: { reason: 'other' } }), null), /別の画面/)
  })
  it('uses the exact previous bytes for update and deletion', () => {
    const db = storage(), a = copy()
    const first = retainEditorCopy(db, a, null)
    const next = copy({ value: { reason: 'next' } })
    const second = retainEditorCopy(db, next, first)
    assert.throws(() => removeEditorCopy(db, a, first), /削除しません/)
    assert.equal(db.getItem(editorCopyKey(a)), second)
    removeEditorCopy(db, next, second); assert.equal(db.length, 0)
  })
  it('keeps the last valid copy and caller input on quota failure', () => {
    const db = storage(), a = copy(), first = retainEditorCopy(db, a, null)
    db.setItem = () => { throw new Error('quota') }
    const pending = copy({ value: { reason: '未送信の続き' } })
    assert.throws(() => retainEditorCopy(db, pending, first), /quota/)
    assert.equal(db.getItem(editorCopyKey(a)), first)
    assert.equal(pending.value.reason, '未送信の続き')
    assert.equal(decodeEditorCopy(encodeEditorCopy(pending), valid).value.reason, pending.value.reason)
  })
  it('counts corrupt and misplaced records but never removes them', () => {
    const db = storage(), a = copy()
    db.setItem(editorCopyKey(a), '{')
    db.setItem(editorCopyKey(copy({ id: 'wrong' })), encodeEditorCopy(a))
    const result = listEditorCopies(db, a.datasetId, a.editor, valid)
    assert.equal(result.unreadable, 2); assert.equal(result.copies.length, 0); assert.equal(db.length, 2)
  })
  for (const patch of [{ parentRevision: -1 }, { datasetId: '../other' }, { version: 2 }, { updatedAt: 'bad' }])
    it('rejects invalid metadata ' + JSON.stringify(patch), () => {
      assert.throws(() => encodeEditorCopy({ ...copy(), ...patch } as EditorCopy<{reason:string}>))
    })
  it('enforces UTF-8 bytes rather than character count', () => {
    assert.throws(() => encodeEditorCopy(copy({ value: { reason: 'あ'.repeat(800000) } })), /容量/)
  })
  it('does not convert an unfinished nonfinite numeric control to null', () => {
    assert.throws(() => encodeEditorCopy({ ...copy(), value: { amount: NaN } }), /数値/)
  })
  it('rejects a structurally different payload rather than treating it as valid', () => {
    assert.throws(() => decodeEditorCopy(JSON.stringify({ ...copy(), value: { reason: 8 } }), valid), /対応しない/)
  })
  it('preserves incomplete method date/year controls as strings', () => {
    const value = { accountId: 'asset', acquisitionMovementId: 'move', method: '', usedOn: '2026-', life: '',
      rental: '', business: false, ordinary: false, rounding: false, evidenceIds: [], reason: '', year: '202',
      decisionId: '', ordinaryYear: false, endYear: '', endReason: '' }
    assert.ok(validSoftwareMethodForm(value))
    const c = { ...copy(), editor: 'software-method', value }
    assert.deepEqual(decodeEditorCopy(encodeEditorCopy(c), validSoftwareMethodForm).value, value)
    assert.equal(validSoftwareMethodForm({ ...value, evidenceIds: null }), false)
  })
})
