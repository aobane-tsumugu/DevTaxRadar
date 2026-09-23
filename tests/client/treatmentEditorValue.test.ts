import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  validTreatmentEditorValue,
  editTreatmentMethodNumber,
  assertTreatmentEditorSave,
  type TreatmentEditorValue,
} from '../../src/client/treatmentEditorValue.js'
import { encodeEditorCopy, decodeEditorCopy } from '../../src/client/editorRecovery.js'

function value(): TreatmentEditorValue {
  return {
    previous: null,
    draft: {
      id: 'facts',
      costYear: 2026,
      contributionId: 'part',
      costBasis: '{}',
      recordedAt: '2026-09-20T00:00:00Z',
      workPurpose: 'unknown',
      placedInService: 'unknown',
      assetKind: 'unknown',
      directlyAttributable: null,
      serviceProvidedInCurrentPeriod: null,
      paidByYearEnd: null,
      workInProgressAtPeriodEnd: null,
      liabilityFixedAtYearEnd: null,
      reason: '',
      evidenceIds: [],
      methodComparison: {
        assetKind: 'unknown',
        contributionIds: ['part'],
        scopeBasis: '',
        completeCostConfirmed: null,
        businessOnly: null,
        acquiredOn: null,
        usedOn: null,
        usefulLifeYears: null,
        taxpayer: 'unknown',
        ordinaryConditions: null,
        rentalUse: 'unknown',
        throughYear: 2030,
        eligibleSmallBusiness: null,
        annualSpecialUsedJpy: null,
        businessMonths: null,
        statementReady: null,
        roundingConfirmed: null,
        reason: '',
      },
    },
  }
}
describe('unfinished treatment method controls', () => {
  it('does not demand complete business facts to retain an editor copy', () => {
    assert.ok(validTreatmentEditorValue(value()))
    assert.doesNotThrow(() => assertTreatmentEditorSave(value()))
  })
  for (const raw of ['', '-', '20e', 'invalid', '9007199254740993']) {
    it(`preserves the raw final-year input ${JSON.stringify(raw)} but refuses saving an old numeric value`, () => {
      const original = value(),
        next = editTreatmentMethodNumber(original, 'throughYear', raw)
      assert.equal(next.numericInputs!.throughYear, raw)
      assert.equal(next.draft.methodComparison!.throughYear, 2030)
      assert.ok(validTreatmentEditorValue(next))
      const copy = {
        version: 1 as const,
        datasetId: 'dataset-a',
        editor: 'cost-treatment',
        id: 'tab',
        parentRevision: 7,
        updatedAt: '2026-09-20T00:00:00Z',
        value: next,
      }
      assert.deepEqual(
        decodeEditorCopy(encodeEditorCopy(copy), validTreatmentEditorValue).value,
        next,
      )
      assert.throws(() => assertTreatmentEditorSave(next), /入力途中/)
      assert.equal(original.numericInputs, undefined)
    })
  }
  it('keeps an optional amount blank as unknown, but preserves an explicit zero', () => {
    const empty = editTreatmentMethodNumber(value(), 'annualSpecialUsedJpy', '')
    assert.equal(empty.draft.methodComparison!.annualSpecialUsedJpy, null)
    assertTreatmentEditorSave(empty)
    const zero = editTreatmentMethodNumber(empty, 'annualSpecialUsedJpy', '0')
    assert.equal(zero.draft.methodComparison!.annualSpecialUsedJpy, 0)
    assertTreatmentEditorSave(zero)
  })
  it('returns to a valid save once the user completes the year', () => {
    const next = editTreatmentMethodNumber(
      editTreatmentMethodNumber(value(), 'throughYear', '-'),
      'throughYear',
      '2031',
    )
    assert.equal(next.draft.methodComparison!.throughYear, 2031)
    assertTreatmentEditorSave(next)
  })
  it('still applies the actual method range validation at save', () => {
    const next = editTreatmentMethodNumber(value(), 'businessMonths', '13')
    assert.ok(validTreatmentEditorValue(next))
    assert.throws(() => assertTreatmentEditorSave(next), /事業月数/)
  })
  it('does not accept a mismatched raw and parsed number', () => {
    assert.throws(
      () => assertTreatmentEditorSave({ ...value(), numericInputs: { throughYear: '2029' } }),
      /入力途中/,
    )
  })
  it('rejects unsupported payload fields but not an incomplete calendar control', () => {
    const input = value()
    input.draft.methodComparison!.usedOn = '2026-'
    assert.ok(validTreatmentEditorValue(input))
    assert.throws(() => assertTreatmentEditorSave(input), /日付/)
    assert.equal(validTreatmentEditorValue({ ...input, numericInputs: { forged: 'x' } }), false)
  })
})
