import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { convertedYen, evaluateSourceAdjustments, sourceAdjustmentBasis, validateSourceAdjustments, type SourceAdjustmentRecord, type CurrencyConversion } from '../../src/core/sourceAdjustments.js'
import type { ExpenseSource } from '../../src/accounting/costs.js'

const source: ExpenseSource = {
  id: 'direct:receipt', kind: 'direct', label: '合成外注費', originalAmountJpy: 10000,
  currency: 'JPY', servicePeriod: { startedOn: '2026-01-01', endedOn: '2026-01-31' },
  evidenceIds: ['receipt'], origin: 'entered',
}
const record = (patch: Partial<SourceAdjustmentRecord> = {}): SourceAdjustmentRecord => ({
  id: 'refund-1', sourceId: source.id, sourceYear: 2026, sourceBasis: sourceAdjustmentBasis(source),
  kind: 'refund', amountJpy: -1000, occurredOn: '2026-02-03', recordedAt: '2026-02-04T00:00:00Z',
  effect: 'restate-original-cost', reason: '元費用の対象期間へ訂正する入力案', evidenceIds: ['refund-receipt'], ...patch,
})
const conversion = (patch: Partial<CurrencyConversion> = {}): CurrencyConversion => ({
  currency: 'USD', foreignAmount: '12.34', jpyPerUnit: '150.25', rounding: 'nearest-yen',
  convertedOn: '2026-02-03', reference: '合成決済明細の換算率', ...patch,
})

describe('source adjustment records', () => {
  it('retains gross amount, exact source/period and original inputs', () => {
    const original = structuredClone(source)
    const entry = record()
    const before = structuredClone(entry)
    const result = evaluateSourceAdjustments(source, [entry], new Set(['refund-receipt']))
    assert.equal(result.originalAmountJpy, 10000)
    assert.equal(result.costAmountJpy, 9000)
    assert.equal(result.refundAmountJpy, 1000)
    assert.equal(result.rows[0]!.status, 'applied-to-cost')
    assert.deepEqual(source, original); assert.deepEqual(entry, before)
  })
  it('does not confuse source-read year with receipt or tax-treatment year', () => {
    const result = evaluateSourceAdjustments(source, [record({ occurredOn: '2027-04-01', sourceYear: 2026 })])
    assert.equal(result.costAmountJpy, 9000)
    assert.match(result.rows[0]!.reasons.join(''), /受領年の税務処理.*自動変更しません/)
  })
  for (const effect of ['undetermined', 'balance-reduction'] as const) {
    it(`does not subtract ${effect} from the original cost again`, () => {
      const result = evaluateSourceAdjustments(source, [record({ effect, ...(effect === 'balance-reduction' ? { balanceMovementId: 'reduction-1' } : {}) })])
      assert.equal(result.costAmountJpy, 10000)
      assert.equal(result.rows[0]!.status, effect === 'undetermined' ? 'pending' : 'balance-link')
    })
  }
  it('combines multiple signed corrections without floating point or order dependence', () => {
    const entries = [record(), record({ id: 'increase', kind: 'correction', amountJpy: 301 }), record({ id: 'decrease', kind: 'correction', amountJpy: -2 })]
    assert.equal(evaluateSourceAdjustments(source, entries).costAmountJpy, 9299)
    assert.deepEqual(evaluateSourceAdjustments(source, entries), evaluateSourceAdjustments(source, entries.slice().reverse()))
  })
  it('keeps a full refund as confirmed zero, not an unknown amount', () => {
    assert.equal(evaluateSourceAdjustments(source, [record({ amountJpy: -10000 })]).costAmountJpy, 0)
  })
  for (const changed of [
    { originalAmountJpy: 10001 },
    { servicePeriod: { startedOn: '2026-01-02', endedOn: '2026-01-31' } },
    { contractId: 'changed-contract' },
    { kind: 'home' as const },
  ]) it(`detects a stale source basis: ${Object.keys(changed)[0]}`, () => {
    const result = evaluateSourceAdjustments({ ...source, ...changed }, [record()])
    assert.equal(result.costAmountJpy, null)
    assert.equal(result.rows[0]!.status, 'stale')
  })
  it('ignores descriptive source-name changes and object-key ordering', () => {
    const entry = record()
    entry.sourceBasis.servicePeriod = { endedOn: '2026-01-31', startedOn: '2026-01-01' }
    assert.equal(evaluateSourceAdjustments({ ...source, label: '別の説明' }, [entry]).costAmountJpy, 9000)
  })
  it('retains missing evidence as a stale pending calculation', () => {
    const result = evaluateSourceAdjustments(source, [record()], new Set())
    assert.equal(result.costAmountJpy, null)
    assert.match(result.reasons.join(''), /証拠参照/)
  })
  for (const kind of ['equipment', 'opening-balance'] as const) it(`does not apply ordinary price subtraction to ${kind}`, () => {
    const original = { ...source, kind }
    const result = evaluateSourceAdjustments(original, [record({ sourceBasis: sourceAdjustmentBasis(original) })])
    assert.equal(result.originalAmountJpy, 10000); assert.equal(result.costAmountJpy, null)
    assert.equal(result.rows[0]!.status, 'pending')
  })
  it('does not infer a known original amount from a known refund', () => {
    const original = { ...source, originalAmountJpy: null, unknownOriginalAmountReasons: ['請求額未確認'] }
    const result = evaluateSourceAdjustments(original, [record({ sourceBasis: sourceAdjustmentBasis(original) })])
    assert.equal(result.costAmountJpy, null); assert.equal(result.refundAmountJpy, 1000)
  })
  for (const amountJpy of [-10001, Number.MAX_SAFE_INTEGER]) it(`holds out-of-range corrected cost: ${amountJpy}`, () => {
    const result = evaluateSourceAdjustments(source, [record({ kind: 'correction', amountJpy })])
    assert.equal(result.costAmountJpy, null)
    assert.ok(result.reasons.length)
  })
  it('does not apply an adjustment to a different original source', () => {
    const result = evaluateSourceAdjustments({ ...source, id: 'other-source' }, [record()])
    assert.equal(result.costAmountJpy, 10000); assert.deepEqual(result.rows, [])
  })
  for (const patch of [
    { id: '' }, { sourceId: '' }, { sourceYear: 2026.1 }, { sourceYear: 0 },
    { amountJpy: 0 }, { amountJpy: -0 }, { amountJpy: NaN }, { amountJpy: Infinity },
    { amountJpy: -0.1 }, { amountJpy: 1 },
    { occurredOn: '2026-02-30' }, { recordedAt: '2026-02-30T00:00:00Z' },
    { recordedAt: '2026-02-04T00:00:00' }, { effect: 'automatic-tax' },
    { evidenceIds: [] }, { evidenceIds: ['same', 'same'] },
    { reason: ' ' }, { balanceMovementId: 'not-a-balance-effect' },
    { effect: 'balance-reduction' },
    { sourceBasis: { kind: 'unknown', originalAmountJpy: 10000 } },
    { sourceBasis: { kind: 'direct', originalAmountJpy: -1 } },
    { sourceBasis: { kind: 'direct', originalAmountJpy: 10000, nativePath: '/secret' } },
    { sourceBasis: { kind: 'direct', originalAmountJpy: 10000, servicePeriod: { startedOn: '2026-02-01', endedOn: '2026-01-01' } } },
    { conversion: conversion() }, { unapprovedProperty: true },
  ]) it(`rejects invalid input ${JSON.stringify(patch)}`, () => {
    assert.throws(() => validateSourceAdjustments([record(patch as Partial<SourceAdjustmentRecord>)]))
  })
  it('rejects duplicate record IDs and unbounded imports', () => {
    assert.throws(() => validateSourceAdjustments([record(), record()]))
    assert.throws(() => validateSourceAdjustments(Array.from({ length: 1001 }, (_, i) => record({ id: `r-${i}` }))))
    assert.throws(() => validateSourceAdjustments(Array.from({ length: 201 }, (_, i) => record({ id: `r-${i}`, sourceYear: 1900 + i }))))
  })
})

describe('currency-conversion evidence', () => {
  for (const [rounding, expected] of [['nearest-yen', 1854], ['floor-yen', 1854], ['ceiling-yen', 1855]] as const)
    it(`records exact decimal multiplication and ${rounding}`, () => assert.equal(convertedYen(conversion({ rounding })), expected))
  for (const [rounding, expected] of [['nearest-yen', 2], ['floor-yen', 1], ['ceiling-yen', 2]] as const)
    it(`handles a half-yen tie with ${rounding}`, () => assert.equal(convertedYen(conversion({ foreignAmount: '0.01', jpyPerUnit: '150', rounding })), expected))
  it('requires imported and manually entered yen to match the retained conversion', () => {
    validateSourceAdjustments([record({ amountJpy: -1854, conversion: conversion() })])
    assert.throws(() => validateSourceAdjustments([record({ amountJpy: -1855, conversion: conversion() })]))
  })
  for (const patch of [
    { currency: 'JPY' }, { currency: 'usd' }, { jpyPerUnit: '0' },
    { foreignAmount: '1e5' }, { foreignAmount: '-2' }, { foreignAmount: '1.000000001' },
    { foreignAmount: '01' }, { rounding: 'automatic' }, { reference: '' },
    { convertedOn: '2026-13-01' }, { foreignAmount: '999999999999999', jpyPerUnit: '999999999999999' },
  ]) it(`rejects invalid conversion ${JSON.stringify(patch)}`, () => assert.throws(() => convertedYen(conversion(patch as Partial<CurrencyConversion>))))
})
