import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { ExpenseSource } from '../../src/accounting/costs.js'
import type { SubscriptionCostScope } from '../../src/core/workspaceCosts.js'
import { allocateMonthlySubscription, assertAllocationInvariant } from '../../src/core/allocation.js'
import { monthlyAmountsForCharge } from '../../src/core/chargePeriods.js'
import { createSourceAdjuster, adjustSubscriptionScope } from '../../src/core/adjustedCostSources.js'
import { sourceAdjustmentBasis, validateSourceAdjustments, type SourceAdjustmentRecord } from '../../src/core/sourceAdjustments.js'
import { mergeWorkspaceDrafts, type WorkspaceContents } from '../../src/core/workspaceMerge.js'
import { workspaceChangeKind, isNewWorkspace } from '../../src/core/workspaceChange.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'

const evidence = new Set(['receipt'])
function source(amount = 6200): ExpenseSource {
  return { id: 'ai:charge:a', kind: 'subscription', label: '合成契約', originalAmountJpy: amount,
    currency: 'JPY', servicePeriod: { startedOn: '2026-12-01', endedOn: '2027-01-31' }, evidenceIds: [], origin: 'entered' }
}
function adjustment(receipt = source(), amountJpy = -3100): SourceAdjustmentRecord {
  return { id: 'refund', sourceId: receipt.id, sourceYear: 2026, sourceBasis: sourceAdjustmentBasis(receipt),
    kind: amountJpy < 0 ? 'refund' : 'correction', amountJpy, effect: 'restate-original-cost',
    occurredOn: '2027-02-01', recordedAt: '2027-02-01T10:00:00+09:00', reason: '元のサービス期間の価格訂正', evidenceIds: ['receipt'] }
}
function scopes(receipt = source()): SubscriptionCostScope[] {
  return monthlyAmountsForCharge({ id: receipt.id, provider: 'claude', planName: receipt.label,
    serviceStartedOn: receipt.servicePeriod!.startedOn, serviceEndedOn: receipt.servicePeriod!.endedOn,
    amountJpy: receipt.originalAmountJpy, ...(receipt.originalAmountJpy === null ? { unknownAmountReason: '確認中' } : {}) }).map((month) => ({
      source: receipt, basisId: month.month, period: { startedOn: month.month + '-01', endedOn: month.month + '-31' },
      result: month.amountJpy === null ? null : allocateMonthlySubscription({ provider: 'claude', billingMonth: month.month as `${number}-${number}`,
        monthlyFeeJpy: month.amountJpy, unobservedUsage: { kind: 'confirmed-none' },
        usageLines: [{ id: 'work-a', productId: 'a', bucket: 'product', usageWeight: 1 }, { id: 'work-b', productId: 'b', bucket: 'product', usageWeight: 2 }] }),
      targets: { 'work-a': { kind: 'tax-unit', taxUnitId: 'a' }, 'work-b': { kind: 'tax-unit', taxUnitId: 'b' } },
    }))
}
function workspace(): WorkspaceContents {
  return { planning: emptyPlanningSnapshot(2026), configuration: {
    charges: { claude: 0, codex: 0 }, monthlyCharges: [], contracts: { claude: {}, codex: {} }, chargePeriods: [], unobservedRatio: null,
  } }
}

describe('source-bound corrections across calculation and workspace boundaries', () => {
  it('keeps gross receipts and prorates the adjusted total across the original years', () => {
    const original = scopes()
    const before = structuredClone(original)
    const adjusted = original.map((scope) => adjustSubscriptionScope(scope, createSourceAdjuster([adjustment()], evidence)))
    assert.deepEqual(adjusted.map((scope) => scope.result!.monthlyFeeJpy), [1550, 1550])
    assert.equal(adjusted.reduce((sum, scope) => sum + scope.result!.monthlyFeeJpy, 0), 3100)
    for (const scope of adjusted) {
      assert.equal(scope.source.originalAmountJpy, 6200)
      assert.deepEqual(scope.source.adjustments, [adjustment()])
      assertAllocationInvariant(scope.result!)
    }
    assert.deepEqual(original, before)
  })
  it('recomputes rounding from usage weights and is idempotent on an already adjusted scope', () => {
    const receipt = source(3)
    const record = adjustment(receipt, -1)
    const adjust = createSourceAdjuster([record], evidence)
    const result = scopes(receipt).map((scope) => adjustSubscriptionScope(scope, adjust))
    assert.deepEqual(result.map((scope) => scope.result!.monthlyFeeJpy), [1, 1])
    assert.deepEqual(result.map((scope) => adjustSubscriptionScope(scope, adjust)), result)
    for (const scope of result) assertAllocationInvariant(scope.result!)
  })
  it('restores the original amount when an explicit adjustment deletion is recalculated', () => {
    const once = adjustSubscriptionScope(scopes()[0]!, createSourceAdjuster([adjustment()], evidence))
    const restored = adjustSubscriptionScope(once, createSourceAdjuster([], evidence))
    assert.equal(restored.result!.monthlyFeeJpy, 3100)
    assert.equal(restored.source.adjustments, undefined)
    assertAllocationInvariant(restored.result!)
  })
  it('does not apply a refund for one contract to another contract of the same service', () => {
    const unrelated = { ...source(), id: 'ai:charge:b' }
    const scope = scopes(unrelated)[0]!
    assert.equal(adjustSubscriptionScope(scope, createSourceAdjuster([adjustment()], evidence)), scope)
  })
  it('uses a positive correction without replacing the raw receipt', () => {
    const result = adjustSubscriptionScope(scopes()[0]!, createSourceAdjuster([adjustment(source(), 200)], evidence))
    assert.equal(result.result!.monthlyFeeJpy, 3200)
    assert.equal(result.source.originalAmountJpy, 6200)
    assertAllocationInvariant(result.result!)
  })
  it('keeps a known full refund as a zero basis, not an unknown or a deleted source', () => {
    const result = adjustSubscriptionScope(scopes()[0]!, createSourceAdjuster([adjustment(source(), -6200)], evidence))
    assert.equal(result.result!.monthlyFeeJpy, 0)
    assert.equal(result.source.originalAmountJpy, 6200)
    assert.equal(result.source.adjustments!.length, 1)
    assertAllocationInvariant(result.result!)
  })
  it('does not infer the capture ratio from a refund', () => {
    const scope = scopes()[0]!
    scope.result = allocateMonthlySubscription({ provider: 'claude', billingMonth: '2026-12', monthlyFeeJpy: 3100,
      usageLines: [{ id: 'a', bucket: 'product', usageWeight: 100 }], unobservedUsage: { kind: 'unknown' } })
    const result = adjustSubscriptionScope(scope, createSourceAdjuster([adjustment()], evidence))
    assert.equal(result.result!.status, 'pending')
    assert.equal(result.result!.pendingAmountJpy, 1550)
    assert.equal(result.result!.unobservedUsageRatio, null)
    assertAllocationInvariant(result.result!)
  })
  it('preserves explicit capture estimates while recomputing each rounded allocation', () => {
    const scope = scopes()[0]!
    scope.result = allocateMonthlySubscription({ provider: 'claude', billingMonth: '2026-12', monthlyFeeJpy: 3100,
      usageLines: [{ id: 'a', bucket: 'product', usageWeight: 100 }], unobservedUsage: { kind: 'estimated', ratio: 0.2 } })
    const result = adjustSubscriptionScope(scope, createSourceAdjuster([adjustment()], evidence))
    assert.equal(result.result!.unobservedUsageRatio, 0.2)
    assert.equal(result.result!.lines.find((line) => line.kind === 'unobserved')!.allocatedAmountJpy, 310)
    assertAllocationInvariant(result.result!)
  })
  for (const kind of ['raw-amount', 'period', 'evidence', 'oversized-refund'] as const) {
    it(`keeps corrections pending rather than inventing a basis after ${kind}`, () => {
      const scope = scopes()[0]!
      const record = adjustment()
      let available = evidence
      if (kind === 'raw-amount') scope.source = { ...scope.source, originalAmountJpy: 7000 }
      if (kind === 'period') scope.source = { ...scope.source, servicePeriod: { startedOn: '2026-12-02', endedOn: '2027-01-31' } }
      if (kind === 'evidence') available = new Set()
      if (kind === 'oversized-refund') record.amountJpy = -7000
      const result = adjustSubscriptionScope(scope, createSourceAdjuster([record], available))
      assert.equal(result.result, null)
      assert.ok(result.basisUnknownReasons!.length > 0)
      assert.equal(result.source.adjustments!.length, 1)
    })
  }
  for (const effect of ['undetermined', 'balance-reduction'] as const) {
    it(`does not subtract the original charge for ${effect}`, () => {
      const record = { ...adjustment(), effect, ...(effect === 'balance-reduction' ? { balanceMovementId: 'reduction' } : {}) }
      const result = adjustSubscriptionScope(scopes()[0]!, createSourceAdjuster([record], evidence))
      assert.equal(result.result!.monthlyFeeJpy, 3100)
      assert.ok(result.sourceWarnings!.length > 0)
    })
  }
  it('binds a direct-cost adjustment to the exact incurred date', () => {
    const direct: ExpenseSource = { id: 'direct:a', kind: 'direct', label: '外注費', originalAmountJpy: 6200,
      incurredOn: '2026-07-01', currency: 'JPY', evidenceIds: [], origin: 'entered' }
    const adjust = createSourceAdjuster([adjustment(direct)], evidence)
    assert.equal(adjust(direct).evaluation.costAmountJpy, 3100)
    assert.equal(adjust({ ...direct, incurredOn: '2026-07-02' }).evaluation.costAmountJpy, null)
  })
  for (const field of ['kind', 'effect', 'source-kind'] as const) {
    it(`rejects an array masquerading as the ${field} string`, () => {
      const record = structuredClone(adjustment())
      const malformed: unknown = field === 'source-kind'
        ? { ...record, sourceBasis: { ...record.sourceBasis, kind: ['subscription'] } }
        : { ...record, [field]: [record[field]] }
      assert.throws(() => validateSourceAdjustments([malformed]))
    })
  }
  it('preserves separate additions in a workspace merge', () => {
    const base = workspace(), local = structuredClone(base), latest = structuredClone(base)
    local.planning.sourceAdjustments = [adjustment()]
    latest.planning.sourceAdjustments = [{ ...adjustment(), id: 'second', amountJpy: -100 }]
    const merged = mergeWorkspaceDrafts(base, local, latest)
    assert.ok(merged.contents)
    assert.deepEqual(merged.contents.planning.sourceAdjustments!.map((row) => row.id).sort(), ['refund', 'second'])
    assert.equal(workspaceChangeKind(base, local), 'calculation')
    assert.equal(isNewWorkspace(local, 0), false)
    assert.equal(base.planning.sourceAdjustments, undefined)
  })
  it('requires a whole-record choice when the same refund was edited twice', () => {
    const base = workspace()
    base.planning.sourceAdjustments = [adjustment()]
    const local = structuredClone(base), latest = structuredClone(base)
    local.planning.sourceAdjustments![0]!.amountJpy = -2000
    local.planning.sourceAdjustments![0]!.reason = '手元の理由'
    latest.planning.sourceAdjustments![0]!.amountJpy = -1000
    latest.planning.sourceAdjustments![0]!.reason = '別画面の理由'
    const conflict = mergeWorkspaceDrafts(base, local, latest)
    assert.equal(conflict.contents, null)
    const key = conflict.changes.find((row) => row.conflict)!.key
    const chosen = mergeWorkspaceDrafts(base, local, latest, { [key]: 'local' })
    assert.deepEqual(chosen.contents!.planning.sourceAdjustments, local.planning.sourceAdjustments)
  })
  it('does not lose a competing refund edit when another editor deletes it', () => {
    const base = workspace(); base.planning.sourceAdjustments = [adjustment()]
    const local = structuredClone(base), latest = structuredClone(base)
    local.planning.sourceAdjustments = []
    latest.planning.sourceAdjustments![0]!.reason = '別画面の訂正理由'
    assert.equal(mergeWorkspaceDrafts(base, local, latest).contents, null)
  })
})
