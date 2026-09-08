import type {
  AllocationLine,
  MonthlyAllocationInput,
  MonthlyAllocationResult,
  TokenBreakdown,
  UsageWeights,
} from './types.js'

export const DEFAULT_USAGE_WEIGHTS: UsageWeights = {
  input: 1,
  cachedInput: 0.25,
  cacheCreation: 1,
  output: 3,
  reasoning: 3,
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`)
  }
}

function assertRatio(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`${name} must be at least 0 and less than 1`)
  }
}

export function calculateWeightedTokenUsage(
  tokens: TokenBreakdown,
  weights: UsageWeights = DEFAULT_USAGE_WEIGHTS,
): number {
  const values = [
    tokens.inputTokens,
    tokens.cachedInputTokens ?? 0,
    tokens.cacheCreationTokens ?? 0,
    tokens.outputTokens,
    tokens.reasoningTokens ?? 0,
  ]
  const weightValues = [
    weights.input,
    weights.cachedInput,
    weights.cacheCreation,
    weights.output,
    weights.reasoning,
  ]

  values.forEach((value, index) => assertFiniteNonNegative(value, `token value at index ${index}`))
  weightValues.forEach((value, index) =>
    assertFiniteNonNegative(value, `usage weight at index ${index}`),
  )

  return values.reduce((sum, value, index) => sum + value * (weightValues[index] ?? 0), 0)
}

function resolveUnobservedRatio(input: MonthlyAllocationInput): number | null {
  const unobserved = input.unobservedUsage
  if (unobserved.kind === 'confirmed-none') return 0

  if (unobserved.kind === 'estimated') {
    assertRatio(unobserved.ratio, 'unobserved usage ratio')
    return unobserved.ratio
  }

  return null
}

/**
 * Allocates one provider's actual monthly fee. Ratios express a share of total
 * monthly use, not an uplift percentage over captured use.
 */
export function allocateMonthlySubscription(
  input: MonthlyAllocationInput,
): MonthlyAllocationResult {
  assertFiniteNonNegative(input.monthlyFeeJpy, 'monthly fee')
  if (!Number.isSafeInteger(input.monthlyFeeJpy)) {
    throw new RangeError('monthly fee must be an integer number of yen')
  }

  const warnings: string[] = []
  const capturedUsageWeight = input.usageLines.reduce((sum, line) => {
    assertFiniteNonNegative(line.usageWeight, `usage weight for ${line.id}`)
    return sum + line.usageWeight
  }, 0)
  const unobservedUsageRatio = resolveUnobservedRatio(input)

  if (!Number.isFinite(capturedUsageWeight)) throw new RangeError('usage weight overflow')
  if (unobservedUsageRatio === null || capturedUsageWeight === 0) {
    if (unobservedUsageRatio === null) {
      warnings.push(
        '履歴にない利用の割合が不明なため、支払額を配分未算定として保持しています。割合を推定入力するか、捕捉外の利用がないことを確認してください。',
      )
    }
    if (capturedUsageWeight === 0) {
      warnings.push(
        '配分の基準となる利用がないため、支払額を配分未算定として保持しています。全額が未取得利用であると判断したものではありません。',
      )
    }
    return {
      provider: input.provider,
      billingMonth: input.billingMonth,
      monthlyFeeJpy: input.monthlyFeeJpy,
      capturedUsageWeight,
      status: 'pending',
      pendingAmountJpy: input.monthlyFeeJpy,
      unobservedUsageRatio,
      unobservedUsageEquivalent: null,
      lines: [],
      warnings,
      invariantSatisfied: true,
    }
  }

  const capturedRatio = 1 - unobservedUsageRatio
  const unobservedUsageEquivalent =
    capturedUsageWeight === 0 ? 0 : (capturedUsageWeight * unobservedUsageRatio) / capturedRatio
  const denominatorWeight = capturedUsageWeight + unobservedUsageEquivalent

  const lines: AllocationLine[] = input.usageLines.map((line) => {
    const allocationRatio =
      capturedUsageWeight === 0 ? 0 : capturedRatio * (line.usageWeight / capturedUsageWeight)
    return {
      kind: line.bucket,
      sourceId: line.id,
      productId: line.productId,
      taxUnitId: line.taxUnitId,
      workStage: line.workStage,
      usageWeight: line.usageWeight,
      denominatorWeight,
      allocationRatio,
      allocatedAmountJpy: Math.floor(input.monthlyFeeJpy * allocationRatio),
    }
  })

  const unobservedAmount = Math.floor(input.monthlyFeeJpy * unobservedUsageRatio)
  lines.push({
    kind: 'unobserved',
    usageWeight: unobservedUsageEquivalent,
    denominatorWeight,
    allocationRatio: unobservedUsageRatio,
    allocatedAmountJpy: unobservedAmount,
  })

  const allocatedBeforeAdjustment = lines.reduce((sum, line) => sum + line.allocatedAmountJpy, 0)
  const adjustment = input.monthlyFeeJpy - allocatedBeforeAdjustment
  lines.push({
    kind: 'rounding-adjustment',
    usageWeight: 0,
    denominatorWeight,
    allocationRatio: input.monthlyFeeJpy === 0 ? 0 : adjustment / input.monthlyFeeJpy,
    allocatedAmountJpy: adjustment,
  })

  const allocatedTotal = lines.reduce((sum, line) => sum + line.allocatedAmountJpy, 0)

  return {
    provider: input.provider,
    billingMonth: input.billingMonth,
    monthlyFeeJpy: input.monthlyFeeJpy,
    capturedUsageWeight,
    status: 'allocated',
    pendingAmountJpy: 0,
    unobservedUsageRatio,
    unobservedUsageEquivalent,
    lines,
    warnings,
    invariantSatisfied: allocatedTotal === input.monthlyFeeJpy,
  }
}

export function allocateSubscriptions(inputs: MonthlyAllocationInput[]): MonthlyAllocationResult[] {
  const keys = new Set<string>()
  return inputs.map((input) => {
    const key = `${input.provider}:${input.billingMonth}`
    if (keys.has(key)) {
      throw new Error(`duplicate provider-month allocation: ${key}`)
    }
    keys.add(key)
    return allocateMonthlySubscription(input)
  })
}

export function assertAllocationInvariant(result: MonthlyAllocationResult): void {
  const total = result.lines.reduce(
    (sum, line) => sum + line.allocatedAmountJpy,
    result.pendingAmountJpy,
  )
  if (total !== result.monthlyFeeJpy) {
    throw new Error(`allocation invariant violated: expected ${result.monthlyFeeJpy}, got ${total}`)
  }
}
