import { describe, expect, it } from 'vitest'

import {
  allocateMonthlySubscription,
  allocateSubscriptions,
  assertAllocationInvariant,
  calculateWeightedTokenUsage,
} from '../../src/core/index.js'

describe('monthly subscription allocation', () => {
  it('allocates within one provider-month and preserves the actual fee', () => {
    const result = allocateMonthlySubscription({
      provider: 'claude',
      billingMonth: '2026-06',
      monthlyFeeJpy: 10_000,
      usageLines: [
        {
          id: 'product-a',
          productId: 'a',
          bucket: 'product',
          usageWeight: 1,
        },
        {
          id: 'private',
          bucket: 'private',
          usageWeight: 2,
        },
      ],
      unobservedUsage: { kind: 'estimated', ratio: 0.1 },
    })

    expect(result.lines.map((line) => line.allocatedAmountJpy)).toEqual([3_000, 6_000, 1_000, 0])
    expect(result.invariantSatisfied).toBe(true)
    expect(() => assertAllocationInvariant(result)).not.toThrow()
  })

  it('uses a visible rounding adjustment instead of losing yen', () => {
    const result = allocateMonthlySubscription({
      provider: 'codex',
      billingMonth: '2026-07',
      monthlyFeeJpy: 100,
      usageLines: [
        { id: 'a', bucket: 'product', usageWeight: 1 },
        { id: 'b', bucket: 'product', usageWeight: 1 },
        { id: 'c', bucket: 'private', usageWeight: 1 },
      ],
      unobservedUsage: { kind: 'confirmed-none' },
    })

    expect(result.lines.at(-1)).toMatchObject({
      kind: 'rounding-adjustment',
      allocatedAmountJpy: 1,
    })
    expect(result.lines.reduce((sum, line) => sum + line.allocatedAmountJpy, 0)).toBe(100)
  })

  it('keeps the entire source pending without inventing an unobserved percentage', () => {
    const result = allocateMonthlySubscription({
      provider: 'claude',
      billingMonth: '2026-07',
      monthlyFeeJpy: 1_000,
      usageLines: [{ id: 'a', bucket: 'product', usageWeight: 10 }],
      unobservedUsage: { kind: 'unknown' },
    })

    expect(result.unobservedUsageRatio).toBeNull()
    expect(result.unobservedUsageEquivalent).toBeNull()
    expect(result.status).toBe('pending')
    expect(result.pendingAmountJpy).toBe(1_000)
    expect(result.capturedUsageWeight).toBe(10)
    expect(result.lines).toEqual([])
    expect(() => assertAllocationInvariant(result)).not.toThrow()
    expect(result.warnings).toHaveLength(1)
  })

  it('does not allocate the fee to captured projects when no usage was found', () => {
    const result = allocateMonthlySubscription({
      provider: 'codex',
      billingMonth: '2026-04',
      monthlyFeeJpy: 3_000,
      usageLines: [],
      unobservedUsage: { kind: 'confirmed-none' },
    })

    expect(result.unobservedUsageRatio).toBe(0)
    expect(result.status).toBe('pending')
    expect(result.pendingAmountJpy).toBe(3_000)
    expect(result.lines).toEqual([])
    expect(result.invariantSatisfied).toBe(true)
  })

  it('continues known allocations when another source is unresolved', () => {
    const shared = {
      billingMonth: '2026-06' as const,
      monthlyFeeJpy: 1_000,
      usageLines: [{ id: 'a', bucket: 'product' as const, usageWeight: 1 }],
    }
    const [unknown, known] = allocateSubscriptions([
      { ...shared, provider: 'claude', unobservedUsage: { kind: 'unknown' } },
      { ...shared, provider: 'codex', unobservedUsage: { kind: 'confirmed-none' } },
    ])
    expect(unknown?.pendingAmountJpy).toBe(1_000)
    expect(known?.lines[0]?.allocatedAmountJpy).toBe(1_000)
    expect(known?.status).toBe('allocated')
  })

  it('keeps Claude and Codex as separate denominators', () => {
    const results = allocateSubscriptions([
      {
        provider: 'claude',
        billingMonth: '2026-06',
        monthlyFeeJpy: 3_000,
        usageLines: [{ id: 'a', bucket: 'product', usageWeight: 1 }],
        unobservedUsage: { kind: 'confirmed-none' },
      },
      {
        provider: 'codex',
        billingMonth: '2026-06',
        monthlyFeeJpy: 2_000,
        usageLines: [
          { id: 'a', bucket: 'product', usageWeight: 1 },
          { id: 'b', bucket: 'product', usageWeight: 3 },
        ],
        unobservedUsage: { kind: 'confirmed-none' },
      },
    ])

    expect(results[0]?.lines[0]?.allocatedAmountJpy).toBe(3_000)
    expect(results[1]?.lines[0]?.allocatedAmountJpy).toBe(500)
    expect(results[1]?.lines[1]?.allocatedAmountJpy).toBe(1_500)
  })

  it('rejects duplicate provider-month inputs', () => {
    const duplicate = {
      provider: 'claude' as const,
      billingMonth: '2026-06' as const,
      monthlyFeeJpy: 1_000,
      usageLines: [],
      unobservedUsage: { kind: 'confirmed-none' as const },
    }
    expect(() => allocateSubscriptions([duplicate, duplicate])).toThrow('duplicate provider-month')
  })
})

describe('weighted usage', () => {
  it('keeps token components and weights explicit', () => {
    expect(
      calculateWeightedTokenUsage(
        {
          inputTokens: 100,
          cachedInputTokens: 100,
          cacheCreationTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5,
        },
        {
          input: 1,
          cachedInput: 0.25,
          cacheCreation: 1,
          output: 3,
          reasoning: 3,
        },
      ),
    ).toBe(210)
  })
})
