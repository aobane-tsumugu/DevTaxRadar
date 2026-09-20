import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { encodeEditorCopy, decodeEditorCopy, retainEditorCopy, listEditorCopies, removeEditorCopy, restoreEditorCopy, editorCopyKey, EDITOR_FILE_LIMIT, type EditorCopy } from '../../src/client/editorRecovery.js'
import { validTreatmentEditorValue, editTreatmentMethodNumber, assertTreatmentEditorSave, type TreatmentEditorValue } from '../../src/client/treatmentEditorValue.js'
function storage(): Storage {
  const values = new Map<string, string>()
  return { get length() { return values.size }, key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) }, clear: () => values.clear() }
}
const valid = (value: unknown): value is { reason: string } => Boolean(value && typeof value === 'object' && 'reason' in value && typeof value.reason === 'string')
const copy = (patch: Partial<EditorCopy<{ reason: string }>> = {}): EditorCopy<{ reason: string }> => ({
  version: 1, datasetId: 'dataset-a', editor: 'cost-treatment', id: 'tab-a', parentRevision: 7,
  updatedAt: '2026-09-20T01:00:00Z', value: { reason: '' }, ...patch,
})
function value(): TreatmentEditorValue {
  return { previous: null, draft: {
    id: 'facts', costYear: 2026, contributionId: 'part', costBasis: '{}', recordedAt: '2026-09-20T00:00:00Z',
    workPurpose: 'unknown', placedInService: 'unknown', assetKind: 'unknown', directlyAttributable: null,
    serviceProvidedInCurrentPeriod: null, paidByYearEnd: null, workInProgressAtPeriodEnd: null,
    liabilityFixedAtYearEnd: null, reason: '', evidenceIds: [], methodComparison: {
      assetKind: 'unknown', contributionIds: ['part'], scopeBasis: '', completeCostConfirmed: null,
      businessOnly: null, acquiredOn: null, usedOn: null, usefulLifeYears: null, taxpayer: 'unknown',
      ordinaryConditions: null, rentalUse: 'unknown', throughYear: 2030, eligibleSmallBusiness: null,
      annualSpecialUsedJpy: null, businessMonths: null, statementReady: null, roundingConfirmed: null, reason: '',
    },
  } }
}
describe('C04 unsent copy boundary and unfinished numeric controls', () => {
  it('retains incomplete text, exact identity and original revision without creating a request', () => {
    const db = storage(), c = copy(), before = structuredClone(c), raw = retainEditorCopy(db, c, null)
    assert.deepEqual(decodeEditorCopy(raw, valid), before); assert.deepEqual(c, before)
    assert.equal(db.length, 1); assert.ok(!raw.includes('requestId'))
    const restored = restoreEditorCopy(raw, c.datasetId, c.editor, valid)
    restored.value.reason = 'edited'; assert.equal(c.value.reason, ''); assert.equal(restored.parentRevision, 7)
  })
  for (const [dataset, editor] of [['dataset-b', 'cost-treatment'], ['dataset-a', 'software-method']])
    it(`does not restore into ${dataset}/${editor}`, () => {
      assert.throws(() => restoreEditorCopy(encodeEditorCopy(copy()), dataset!, editor!, valid), /別の/)
    })
  it('lists only the specified dataset and editor, without deleting others', () => {
    const db = storage()
    for (const record of [copy(), copy({ datasetId: 'dataset-b' }), copy({ editor: 'software-method' })]) retainEditorCopy(db, record, null)
    assert.equal(listEditorCopies(db, 'dataset-a', 'cost-treatment', valid).copies.length, 1); assert.equal(db.length, 3)
  })
  it('keeps independent tab copies and requires the exact old bytes for replacing or removing one', () => {
    const db = storage(), c = copy(), first = retainEditorCopy(db, c, null)
    retainEditorCopy(db, copy({ id: 'tab-b' }), null)
    assert.throws(() => retainEditorCopy(db, c, null), /別の画面/)
    const changed = copy({ value: { reason: 'next' } }), second = retainEditorCopy(db, changed, first)
    assert.throws(() => removeEditorCopy(db, c, first), /削除しません/)
    assert.equal(db.getItem(editorCopyKey(c)), second)
    removeEditorCopy(db, changed, second); assert.equal(db.length, 1)
  })
  it('retains last good bytes and caller input when local storage refuses the update', () => {
    const db = storage(), c = copy(), before = retainEditorCopy(db, c, null)
    db.setItem = () => { throw new Error('quota') }
    const pending = copy({ value: { reason: 'まだ送信しない入力' } })
    assert.throws(() => retainEditorCopy(db, pending, before), /quota/)
    assert.equal(db.getItem(editorCopyKey(c)), before)
    assert.equal(decodeEditorCopy(encodeEditorCopy(pending), valid).value.reason, pending.value.reason)
  })
  it('permits an explicit bounded file fallback for UTF-8 input beyond the browser copy budget', () => {
    const large = copy({ value: { reason: 'あ'.repeat(750000) } })
    assert.throws(() => encodeEditorCopy(large), /容量/)
    const file = encodeEditorCopy(large, EDITOR_FILE_LIMIT)
    assert.deepEqual(decodeEditorCopy(file, valid), large)
    assert.throws(() => encodeEditorCopy(large, Infinity), /容量指定/)
    assert.throws(() => decodeEditorCopy(' '.repeat(EDITOR_FILE_LIMIT + 1), valid), /大きすぎ/)
  })
  it('retains corrupt or misplaced records for explicit inspection', () => {
    const db = storage(); db.setItem(editorCopyKey(copy()), '{')
    db.setItem(editorCopyKey(copy({ id: 'wrong' })), encodeEditorCopy(copy()))
    const result = listEditorCopies(db, 'dataset-a', 'cost-treatment', valid)
    assert.equal(result.unreadable, 2); assert.equal(result.copies.length, 0); assert.equal(db.length, 2)
  })
  for (const patch of [{ parentRevision: -1 }, { datasetId: '../other' }, { version: 2 }, { updatedAt: 'bad' }])
    it('rejects invalid copy metadata ' + JSON.stringify(patch), () => {
      assert.throws(() => encodeEditorCopy({ ...copy(), ...patch } as EditorCopy<{reason: string}>))
    })
  it('rejects nonfinite numbers instead of silently encoding null', () => {
    assert.throws(() => encodeEditorCopy({ ...copy(), value: { amount: NaN } }), /数値/)
  })
  it('accepts a structurally valid unfinished facts draft without claiming its tax treatment is confirmed', () => {
    assert.ok(validTreatmentEditorValue(value())); assertTreatmentEditorSave(value())
  })
  for (const raw of ['', '-', '20e', 'invalid', '9007199254740993'])
    it('preserves incomplete final-year control ' + JSON.stringify(raw) + ' and refuses stale-value saving', () => {
      const initial = value(), next = editTreatmentMethodNumber(initial, 'throughYear', raw)
      assert.equal(next.numericInputs!.throughYear, raw); assert.equal(next.draft.methodComparison!.throughYear, 2030)
      const c = { ...copy(), value: next }
      assert.deepEqual(decodeEditorCopy(encodeEditorCopy(c), validTreatmentEditorValue).value, next)
      assert.throws(() => assertTreatmentEditorSave(next), /入力途中/); assert.equal(initial.numericInputs, undefined)
    })
  it('distinguishes optional unknown from explicitly entered zero', () => {
    const empty = editTreatmentMethodNumber(value(), 'annualSpecialUsedJpy', '')
    assert.equal(empty.draft.methodComparison!.annualSpecialUsedJpy, null); assertTreatmentEditorSave(empty)
    const zero = editTreatmentMethodNumber(empty, 'annualSpecialUsedJpy', '0')
    assert.equal(zero.draft.methodComparison!.annualSpecialUsedJpy, 0); assertTreatmentEditorSave(zero)
  })
  it('allows completion, while retaining actual range and raw/parsed consistency checks at save', () => {
    const next = editTreatmentMethodNumber(editTreatmentMethodNumber(value(), 'throughYear', '-'), 'throughYear', '2031')
    assertTreatmentEditorSave(next)
    assert.throws(() => assertTreatmentEditorSave(editTreatmentMethodNumber(value(), 'businessMonths', '13')), /事業月数/)
    assert.throws(() => assertTreatmentEditorSave({ ...value(), numericInputs: { throughYear: '2029' } }), /入力途中/)
  })
  it('retains an unfinished calendar date, but cannot save it or accept unrelated control fields', () => {
    const input = value(); input.draft.methodComparison!.usedOn = '2026-'
    assert.ok(validTreatmentEditorValue(input)); assert.throws(() => assertTreatmentEditorSave(input), /日付/)
    assert.equal(validTreatmentEditorValue({ ...input, numericInputs: { forged: 'x' } }), false)
  })
})
