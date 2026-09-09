import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { allocateSubscriptions, calculateWeightedTokenUsage } from '../../src/core/allocation.js'
import { chargeContractBasis, monthlyAmountsForCharge, type ProviderChargePeriod } from '../../src/core/chargePeriods.js'
import { selectContractUsage, similarSourceGroups, type ContractObservation, type ChargeUsageSelector } from '../../src/core/contractUsage.js'

const date = (value: string) => /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : undefined

function charge(id: string, amountJpy: number, selectors?: ChargeUsageSelector[]): ProviderChargePeriod {
  const period: ProviderChargePeriod = {
    id, provider: 'claude', planName: id, serviceStartedOn: '2026-04-01',
    serviceEndedOn: '2026-04-30', amountJpy,
  }
  period.contractConfirmation = {
    reference: id, reason: '実契約', confirmedAt: '2026-05-01T00:00:00Z', basis: chargeContractBasis(period),
    ...(selectors ? { usageScope: { kind: 'selected' as const, selectors, unobservedRatio: 0, reason: '取得範囲を確認' } } : {}),
  }
  return period
}

function observation(sourceId: string, projectKey: string): ContractObservation {
  return {
    sourceId, provider: 'claude', projectKey, sessionKey: `session-${projectKey}`, month: '2026-04',
    startedAt: '2026-04-15T10:00:00Z', endedAt: '2026-04-15T10:00:00Z',
    inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
    projectLabel: projectKey, model: 'synthetic',
  }
}

const A = charge('A', 8000, [{ sourceId: 'pc', projectKey: 'A' }])
const B = charge('B', 2000, [{ sourceId: 'pc', projectKey: 'B' }])
const rows = [observation('pc', 'A'), observation('pc', 'B')]

describe('real-contract denominator and exact invoice proration', () => {
  it('allocates 8000 and 2000 to the right projects, not 5000 to each', () => {
    const results = [A, B].map((period) => {
      const selected = selectContractUsage(period, [A, B], rows, '2026-04', 0.5, date)
      assert.equal(selected.status, 'selected')
      assert.equal(selected.unobservedRatio, 0)
      assert.equal(selected.observations.length, 1)
      return allocateSubscriptions([{
        provider: period.provider, billingMonth: '2026-04', monthlyFeeJpy: period.amountJpy!,
        unobservedUsage: { kind: 'confirmed-none' },
        usageLines: selected.observations.map((row) => ({
          id: row.sessionKey, productId: row.projectKey, bucket: 'product',
          usageWeight: calculateWeightedTokenUsage({
            inputTokens: row.inputTokens, outputTokens: row.outputTokens,
            cachedInputTokens: row.cacheReadTokens, cacheCreationTokens: row.cacheWriteTokens,
          }),
        })),
      }])[0]!
    })
    assert.equal(results[0]!.lines.find((line) => line.productId === 'A')?.allocatedAmountJpy, 8000)
    assert.equal(results[1]!.lines.find((line) => line.productId === 'B')?.allocatedAmountJpy, 2000)
    assert.equal(results.flatMap((result) => result.lines).reduce((sum, line) => sum + line.allocatedAmountJpy, 0), 10000)
  })

  it('keeps overlapping invoices pending when only their contract names were confirmed', () => {
    const a = charge('A', 8000), b = charge('B', 2000)
    assert.equal(selectContractUsage(a, [a, b], rows, '2026-04', 0, date).status, 'pending')
    assert.equal(a.amountJpy, 8000)
  })

  it('does not use the same observation for two explicitly different contracts', () => {
    const b = charge('B', 2000, [{ sourceId: 'pc' }])
    assert.equal(selectContractUsage(A, [A, b], rows, '2026-04', 0, date).status, 'pending')
  })

  it('does not duplicate a row selected by two selectors', () => {
    const a = charge('A', 8000, [{ sourceId: 'pc', projectKey: 'A' }, { sourceId: 'pc', sessionKey: 'session-A' }])
    assert.equal(selectContractUsage(a, [a], rows, '2026-04', 0, date).observations.length, 1)
  })

  it('requires canonical-source selection or explicit independence for matching source copies', () => {
    const all = charge('A', 8000, [{ sourceId: 'pc' }, { sourceId: 'copy' }])
    const duplicated = [rows[0]!, { ...rows[0]!, sourceId: 'copy', sessionKey: 'other-opaque-id' }]
    assert.deepEqual(similarSourceGroups(duplicated), [['copy', 'pc']])
    assert.equal(selectContractUsage(all, [all], duplicated, '2026-04', 0, date).status, 'pending')
    all.contractConfirmation!.usageScope!.independentSourceIds = ['pc', 'copy']
    assert.equal(selectContractUsage(all, [all], duplicated, '2026-04', 0, date).observations.length, 2)
    assert.equal(selectContractUsage(A, [A], duplicated, '2026-04', 0, date).observations.length, 1)
  })

  it('does not extend an independence confirmation to a source added later', () => {
    const a = charge('A', 8000, [{ sourceId: 'pc' }, { sourceId: 'copy' }, { sourceId: 'new' }])
    a.contractConfirmation!.usageScope!.independentSourceIds = ['pc', 'copy']
    const data = ['pc', 'copy', 'new'].map((sourceId) => ({ ...rows[0]!, sourceId }))
    assert.equal(selectContractUsage(a, [a], data, '2026-04', 0, date).status, 'pending')
  })

  it('keeps an unknown per-contract capture ratio instead of substituting a global zero', () => {
    const a = structuredClone(A)
    a.contractConfirmation!.usageScope!.unobservedRatio = null
    assert.equal(selectContractUsage(a, [a], rows, '2026-04', 0, date).unobservedRatio, null)
  })

  it('does not invent a date split for a crossing aggregate or unreadable timestamp', () => {
    const a = charge('A', 8000, [{ sourceId: 'pc', startedOn: '2026-04-15' }])
    const row = { ...rows[0]!, startedAt: '2026-04-01T00:00:00Z', endedAt: '2026-04-20T00:00:00Z' }
    assert.equal(selectContractUsage(a, [a], [row], '2026-04', 0, date).status, 'pending')
    assert.equal(selectContractUsage(A, [A], [{ ...rows[0]!, startedAt: 'bad' }], '2026-04', 0, date).status, 'pending')
  })

  it('invalidates a correspondence when the invoice facts change', () => {
    const a = { ...A, amountJpy: 9000 }
    assert.equal(selectContractUsage(a, [a], rows, '2026-04', 0, date).status, 'pending')
  })

  it('does not suspend an earlier month because contracts overlap in a later month', () => {
    const a = charge('A', 8000), b = charge('B', 2000)
    a.serviceStartedOn = '2026-03-01'
    a.contractConfirmation!.basis = chargeContractBasis(a)
    const row = { ...rows[0]!, month: '2026-03', startedAt: '2026-03-15T00:00:00Z', endedAt: '2026-03-15T00:00:00Z' }
    assert.equal(selectContractUsage(a, [a, b], [row], '2026-03', 0, date).status, 'selected')
  })

  it('conserves exact yen up to MAX_SAFE_INTEGER across leap months', () => {
    const period = { ...A, serviceStartedOn: '2024-01-31', serviceEndedOn: '2024-03-01', amountJpy: Number.MAX_SAFE_INTEGER }
    const months = monthlyAmountsForCharge(period)
    assert.equal(months.reduce((sum, row) => sum + row.amountJpy!, 0), period.amountJpy)
    assert.equal(months.length, 3)
    assert.deepEqual(monthlyAmountsForCharge({ ...period, amountJpy: 31 }).map((row) => row.amountJpy), [1, 29, 1])
  })

  it('preserves unknown original amounts in every service month', () => {
    const months = monthlyAmountsForCharge({ ...A, serviceStartedOn: '2026-04-15', serviceEndedOn: '2026-05-14', amountJpy: null, unknownAmountReason: '確認待ち' })
    assert.deepEqual(months.map((row) => row.amountJpy), [null, null])
  })
})
