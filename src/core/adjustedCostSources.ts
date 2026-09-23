import type { ExpenseSource } from '../accounting/costs.js'
import type { SubscriptionCostScope } from './workspaceCosts.js'
import { allocateMonthlySubscription, assertAllocationInvariant } from './allocation.js'
import { monthlyAmountsForCharge } from './chargePeriods.js'
import {
  evaluateSourceAdjustments,
  validateSourceAdjustments,
  type SourceAdjustmentRecord,
} from './sourceAdjustments.js'

/** One lookup per source. The saved planning list, not embedded old projections, is authoritative. */
export function createSourceAdjuster(
  records: readonly SourceAdjustmentRecord[] = [],
  evidenceIds?: ReadonlySet<string>,
  year?: number,
) {
  validateSourceAdjustments(records)
  const bySource = new Map<string, SourceAdjustmentRecord[]>()
  for (const record of records) {
    if (
      year !== undefined &&
      record.effect !== 'restate-original-cost' &&
      Number(record.occurredOn.slice(0, 4)) > year
    )
      continue
    const rows = bySource.get(record.sourceId) ?? []
    rows.push(record)
    bySource.set(record.sourceId, rows)
  }
  return (original: ExpenseSource) => {
    const selected = bySource.get(original.id) ?? []
    const { adjustments: _previousProjection, ...receipt } = original
    const source: ExpenseSource = selected.length
      ? { ...receipt, adjustments: structuredClone(selected) }
      : receipt
    const evaluation = evaluateSourceAdjustments(source, selected, evidenceIds)
    return { source, evaluation }
  }
}

/**
 * Re-run the existing month proration and token allocation from the retained
 * original amount. Never scale rounded allocations or deduct the refund twice.
 */
export function adjustSubscriptionScope(
  scope: SubscriptionCostScope,
  adjustSource: ReturnType<typeof createSourceAdjuster>,
): SubscriptionCostScope {
  const { source, evaluation } = adjustSource(scope.source)
  if (!source.adjustments?.length && !scope.source.adjustments?.length) return scope
  const sourceWarnings = [
    ...new Set([
      ...(scope.sourceWarnings ?? []),
      ...evaluation.reasons,
      ...evaluation.rows.flatMap((row) => row.reasons),
    ]),
  ]
  const unknown = (reasons: string[]): SubscriptionCostScope => ({
    ...scope,
    source,
    result: null,
    sourceWarnings,
    basisUnknownReasons: reasons.length ? reasons : ['返金・訂正後の費用基礎を確認できません。'],
  })
  if (evaluation.costAmountJpy === null) return unknown(evaluation.reasons)
  if (!scope.result)
    return unknown(scope.basisUnknownReasons ?? ['配分に必要な元の利用量がありません。'])
  if (
    !source.servicePeriod ||
    scope.period.startedOn.slice(0, 7) !== scope.period.endedOn.slice(0, 7)
  )
    return unknown(['訂正対象の請求期間と月別の費用基礎を確認できません。'])
  const { provider, billingMonth } = scope.result
  const monthly = monthlyAmountsForCharge({
    id: source.id,
    provider,
    planName: source.label,
    serviceStartedOn: source.servicePeriod.startedOn,
    serviceEndedOn: source.servicePeriod.endedOn,
    amountJpy: evaluation.costAmountJpy,
  }).find((row) => row.month === billingMonth)
  if (monthly?.amountJpy === null || monthly?.amountJpy === undefined)
    return unknown(['訂正対象の請求期間に、この月の費用基礎がありません。'])
  if (scope.result.status === 'pending') {
    const result = {
      ...scope.result,
      monthlyFeeJpy: monthly.amountJpy,
      pendingAmountJpy: monthly.amountJpy,
      warnings: [...new Set([...scope.result.warnings, ...sourceWarnings])],
    }
    assertAllocationInvariant(result)
    return { ...scope, source, result, sourceWarnings }
  }
  const ratio = scope.result.unobservedUsageRatio
  const result = allocateMonthlySubscription({
    provider,
    billingMonth,
    monthlyFeeJpy: monthly.amountJpy,
    unobservedUsage:
      ratio === null
        ? { kind: 'unknown' }
        : ratio === 0
          ? { kind: 'confirmed-none' }
          : { kind: 'estimated', ratio },
    usageLines: scope.result.lines.flatMap((line) => {
      if (line.kind !== 'product' && line.kind !== 'private') return []
      if (!line.sourceId) throw new Error('訂正する配分の利用量参照がありません。')
      return [
        {
          id: line.sourceId,
          productId: line.productId,
          taxUnitId: line.taxUnitId,
          workStage: line.workStage,
          bucket: line.kind,
          usageWeight: line.usageWeight,
        },
      ]
    }),
  })
  result.warnings = [...new Set([...scope.result.warnings, ...result.warnings, ...sourceWarnings])]
  assertAllocationInvariant(result)
  return { ...scope, source, result, sourceWarnings }
}
