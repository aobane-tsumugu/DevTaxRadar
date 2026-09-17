import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { adjustmentBalanceLinkIssues } from '../../src/core/adjustmentBalanceLinks.js'
import { editSourceAdjustment } from '../../src/core/sourceAdjustmentEdit.js'
import { createSourceAdjuster } from '../../src/core/adjustedCostSources.js'
import { historicalReviewMaterials } from '../../src/core/reviewHistory.js'
import { planningMarkdown } from '../../src/core/planningExport.js'
import { costProjectionMarkdown } from '../../src/core/costExport.js'
import { readSourceAdjustments, writeSourceAdjustments } from '../../src/server/sourceAdjustmentsRepository.js'
import type { AnnualCostProjection, ExpenseSource } from '../../src/accounting/costs.js'
import type { BalanceSnapshot, BalanceMovement } from '../../src/accounting/types.js'
import type { ReviewMaterials } from '../../src/accounting/reviewMaterials.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { sourceAdjustmentBasis, type SourceAdjustmentRecord } from '../../src/core/sourceAdjustments.js'

const receipt: ExpenseSource = { id: 'direct:a', kind: 'direct', label: '合成外注費', originalAmountJpy: 6200,
  incurredOn: '2026-07-01', currency: 'JPY', evidenceIds: [], origin: 'entered' }
function record(): SourceAdjustmentRecord {
  return { id: 'refund', sourceId: receipt.id, sourceYear: 2026, sourceBasis: sourceAdjustmentBasis(receipt),
    kind: 'refund', amountJpy: -3100, occurredOn: '2027-02-01', recordedAt: '2027-02-01T00:00:00Z',
    effect: 'balance-reduction', balanceMovementId: 'reduction', reason: '返金を残高減少へ対応', evidenceIds: ['receipt'] }
}
function balances(): BalanceSnapshot {
  return { version: 1, accounts: [], pendingDecisions: [], movements: [{
    id: 'reduction', kind: 'reduction', accountId: 'a', amountJpy: 3100, occurredOn: '2027-02-01',
    sourceIds: ['direct:a'], decisionId: 'd', reason: '本人が確認した減少',
  }] }
}
function costs(): AnnualCostProjection {
  return { version: 1, engineVersion: 'cost-projection/1', year: 2026, sources: [structuredClone(receipt)], bases: [], contributions: [], byTaxUnit: [],
    totals: { knownBasisJpy: 0, taxUnitJpy: 0, generalJpy: 0, privateJpy: 0, unallocatedJpy: 0, unobservedJpy: 0, roundingJpy: 0, unknownBasisIds: [] }, invariantSatisfied: true }
}
function material(): ReviewMaterials {
  return { schemaVersion: 1, engineVersion: 'review-materials/1', year: 2026, workspaceRevision: 1, timeZone: 'Asia/Tokyo',
    configuration: { charges: { claude: 0, codex: 0 }, monthlyCharges: [], contracts: { claude: {}, codex: {} }, chargePeriods: [], unobservedRatio: null },
    planning: emptyPlanningSnapshot(2026), observations: [], scanTimeZones: {}, recentScans: [], costs: costs(),
    referenceCheck: { engineVersion: 'balance-references/1', issues: [], status: 'consistent' }, taxTreatmentVerified: false }
}

describe('correction workflows use retained inputs without a second write channel', () => {
  it('accepts exactly one matching reduction without changing either record', () => {
    const rows = [record()], snapshot = balances(), before = structuredClone([rows, snapshot])
    assert.deepEqual(adjustmentBalanceLinkIssues(rows, snapshot), [])
    assert.deepEqual([rows, snapshot], before)
  })
  for (const kind of ['missing', 'amount', 'day', 'source', 'expense', 'addition', 'transfer'] as const) {
    it(`rejects a reduction link with ${kind}`, () => {
      const snapshot = balances()
      if (kind === 'missing') snapshot.movements = []
      else if (kind === 'amount') snapshot.movements[0]!.amountJpy++
      else if (kind === 'day') snapshot.movements[0]!.occurredOn = '2028-02-01'
      else if (kind === 'source') snapshot.movements[0]!.sourceIds = ['other']
      else snapshot.movements[0] = { ...snapshot.movements[0]!, kind } as BalanceMovement
      assert.ok(adjustmentBalanceLinkIssues([record()], snapshot).length > 0)
    })
  }
  it('rejects two different adjustment IDs claiming the same reduction', () => {
    const issues = adjustmentBalanceLinkIssues([record(), { ...record(), id: 'duplicate' }], balances())
    assert.equal(issues.length, 2)
    assert.ok(issues.every((issue) => issue.message.includes('重複')))
  })
  it('does not demand a movement for an undetermined receipt or original-cost restatement', () => {
    const { balanceMovementId: _movement, ...row } = record()
    assert.deepEqual(adjustmentBalanceLinkIssues([{ ...row, effect: 'undetermined' }, { ...row, id: 'second', effect: 'restate-original-cost' }], balances()), [])
  })
  it('keeps unrelated records during an edit, and makes identical retries no-ops', () => {
    const prior = record(), other = { ...record(), id: 'other' }, next = { ...prior, reason: '編集後' }
    const saved = editSourceAdjustment([prior, other], next, prior)
    assert.deepEqual(saved, [other, next])
    assert.deepEqual(editSourceAdjustment(saved, next, prior), saved)
    assert.deepEqual(prior.reason, '返金を残高減少へ対応')
  })
  for (const operation of ['edit', 'delete'] as const) {
    it(`does not overwrite a concurrent ${operation}`, () => {
      const before = record(), current = { ...before, reason: '別画面の更新' }
      assert.throws(() => editSourceAdjustment([current], operation === 'edit' ? { ...before, reason: '手元の更新' } : null, before))
    })
  }
  it('prevents a different record from reusing a newly added ID', () => {
    assert.throws(() => editSourceAdjustment([record()], { ...record(), amountJpy: -100 }, null))
  })
  it('does not treat a future balance-linked receipt as a change to the original year', () => {
    const earlier = createSourceAdjuster([record()], new Set(['receipt']), 2026)(receipt)
    assert.equal(earlier.source.adjustments, undefined)
    assert.equal(earlier.evaluation.costAmountJpy, 6200)
    const later = createSourceAdjuster([record()], new Set(['receipt']), 2027)(receipt)
    assert.equal(later.source.adjustments!.length, 1)
    assert.equal(later.evaluation.costAmountJpy, 6200)
  })
  it('does include a deliberate original-year correction received in a later year', () => {
    const { balanceMovementId: _movement, ...row } = record()
    const result = createSourceAdjuster([{ ...row, effect: 'restate-original-cost' }], new Set(['receipt']), 2026)(receipt)
    assert.equal(result.evaluation.costAmountJpy, 3100)
  })
  it('keeps new duplicate date metadata compatible with an unchanged old annual material', () => {
    const previous = material(), current = structuredClone(previous)
    delete previous.costs.sources[0]!.incurredOn
    const empty: BalanceSnapshot = { version: 1, accounts: [], movements: [], pendingDecisions: [] }
    assert.deepEqual(historicalReviewMaterials(previous, empty), historicalReviewMaterials(current, empty))
  })
  it('detects a changed correction reason even when the amount is the same', () => {
    const previous = material(), empty: BalanceSnapshot = { version: 1, accounts: [], movements: [], pendingDecisions: [] }
    const { balanceMovementId: _movement, ...row } = record()
    previous.planning.sourceAdjustments = [{ ...row, effect: 'restate-original-cost' }]
    const current = structuredClone(previous)
    current.planning.sourceAdjustments![0]!.reason = '異なる判断根拠'
    assert.notDeepEqual(historicalReviewMaterials(previous, empty), historicalReviewMaterials(current, empty))
  })
  it('outputs the retained original, adjustment, conversion, and escaped reason without replacing the data', () => {
    const projection = costs(), row = record()
    row.reason = '# private-heading\n<script>unsafe</script>'
    row.conversion = { currency: 'USD', foreignAmount: '20', jpyPerUnit: '155', rounding: 'nearest-yen', convertedOn: '2027-02-01', reference: 'card statement' }
    projection.sources[0]!.adjustments = [row]
    const original = structuredClone(projection), text = costProjectionMarkdown(projection)
    assert.ok(text.includes('原額 6,200円'))
    assert.ok(text.includes('-3,100円'))
    assert.ok(text.includes('USD 20 × 155円'))
    assert.ok(text.includes('対応する残高減少: reduction'))
    assert.ok(!text.includes('<script>'))
    assert.ok(!text.includes('\n# private-heading'))
    assert.deepEqual(projection, original)
  })
  it('rolls source records back with their enclosing planning SAVEPOINT on a real SQLite database', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
      writeSourceAdjustments(db, [record()])
      db.exec('SAVEPOINT planning_write')
      writeSourceAdjustments(db, [{ ...record(), reason: 'uncommitted change' }])
      assert.throws(() => db.exec('INSERT INTO missing_table VALUES(1)'))
      db.exec('ROLLBACK TO planning_write; RELEASE planning_write')
      assert.deepEqual(readSourceAdjustments(db), [record()])
      assert.throws(() => writeSourceAdjustments(db, undefined))
      assert.deepEqual(readSourceAdjustments(db), [record()])
      writeSourceAdjustments(db, [])
      assert.deepEqual(readSourceAdjustments(db), [])
    } finally { db.close() }
  })
  it('rejects malformed stored JSON rather than returning an empty list', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
      db.prepare('INSERT INTO app_settings(key, value) VALUES(?, ?)').run('planning_source_adjustments_v1', '{')
      assert.throws(() => readSourceAdjustments(db))
      assert.equal(db.prepare('SELECT value FROM app_settings').get()?.value, '{')
    } finally { db.close() }
  })
})

it('retains a later-year refund and its original-year pointer in the planning export', () => {
  const planning = emptyPlanningSnapshot(2027)
  planning.sourceAdjustments = [{ ...record(), reason: '年度判断\n# 偽見出し', conversion: {
    currency: 'USD', foreignAmount: '20', jpyPerUnit: '155', rounding: 'nearest-yen',
    convertedOn: '2027-02-01', reference: 'カード明細',
  } }]
  const output = planningMarkdown(planning)
  assert.match(output, /返金・訂正/)
  assert.match(output, /2026/)
  assert.match(output, /2027-02-01/)
  assert.match(output, /reduction/)
  assert.match(output, /USD/)
  assert.ok(!output.includes('\n# 偽見出し'))
})
