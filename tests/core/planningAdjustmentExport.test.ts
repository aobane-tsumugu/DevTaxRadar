import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { planningMarkdown } from '../../src/core/planningExport.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import type { SourceAdjustmentRecord } from '../../src/core/sourceAdjustments.js'

function fixture() {
  const planning = emptyPlanningSnapshot(2026)
  const record: SourceAdjustmentRecord = {
    id: 'refund-1',
    sourceId: 'direct:invoice-1',
    sourceYear: 2025,
    sourceBasis: {
      kind: 'direct',
      originalAmountJpy: 10_000,
      servicePeriod: { startedOn: '2025-12-01', endedOn: '2025-12-31' },
      acquiredOn: '2025-12-01',
      contractId: 'contract-1',
    },
    kind: 'refund',
    amountJpy: -1500,
    occurredOn: '2026-01-10',
    recordedAt: '2026-01-11T00:00:00Z',
    effect: 'undetermined',
    reason: '返金の対象期間を確認中',
    evidenceIds: ['receipt-1'],
  }
  planning.sourceAdjustments = [record]
  planning.evidence = [
    {
      id: 'receipt-1',
      evidenceType: 'receipt',
      strength: 'external',
      recordedAt: '2026-01-11T00:00:00Z',
      note: '返金明細',
      localReference: '/private/refund-receipt.pdf',
    },
  ]
  return { planning, record }
}

describe('planning export retains adjustment facts without posting amounts', () => {
  it('includes original amount, signed refund, record and evidence references', () => {
    const { planning } = fixture()
    const output = planningMarkdown(planning)
    for (const value of [
      '## 返金・訂正の登録記録',
      '返金 / ID refund-1',
      '-1,500円',
      'direct:invoice-1',
      'receipt-1',
      '原額 10,000円',
    ])
      assert.ok(output.includes(value), value)
    assert.ok(!output.includes('8,500円'), 'The export must not independently net the original')
  })
  it('keeps source year, receipt date, recording time and original period distinct', () => {
    const { planning } = fixture()
    const output = planningMarkdown(planning)
    for (const value of [
      '元費用を確認する年 2025年',
      '受領・訂正日 2026-01-10',
      '記録日時 2026-01-11T00:00:00Z',
      '2025-12-01 ～ 2025-12-31',
      '取得日: 2025-12-01',
      '契約ID: contract-1',
    ])
      assert.ok(output.includes(value), value)
  })
  it('does not turn an unknown original into zero or a negative cost basis', () => {
    const { planning, record } = fixture()
    record.sourceBasis.originalAmountJpy = null
    const output = planningMarkdown(planning)
    assert.ok(output.includes('原額 不明'))
    assert.ok(!output.includes('原額 0円'))
    assert.ok(output.includes('扱いを保留'))
  })
  it('identifies a positive correction separately from a refund', () => {
    const { planning, record } = fixture()
    record.kind = 'correction'
    record.amountJpy = 25
    record.effect = 'restate-original-cost'
    const output = planningMarkdown(planning)
    assert.ok(output.includes('訂正 / ID refund-1 / 記録額 25円'))
    assert.ok(output.includes('元費用の訂正を指定'))
    assert.ok(output.includes('照合の完了を示しません'))
  })
  it('retains the designated balance movement without asserting a verified match', () => {
    const { planning, record } = fixture()
    record.effect = 'balance-reduction'
    record.balanceMovementId = 'reduction-1'
    const output = planningMarkdown(planning)
    assert.ok(output.includes('残高減少との対応を指定'))
    assert.ok(output.includes('残高減少ID: reduction-1'))
    assert.ok(output.includes('金額・原価の一致は未検証'))
  })
  it('keeps exact decimal strings, selected rounding and conversion evidence', () => {
    const { planning, record } = fixture()
    record.conversion = {
      currency: 'USD',
      foreignAmount: '10.00000000',
      jpyPerUnit: '150.00000000',
      rounding: 'nearest-yen',
      convertedOn: '2026-01-10',
      reference: '決済明細の換算',
    }
    const output = planningMarkdown(planning)
    assert.ok(output.includes('10.00000000 USD × 150.00000000 円/通貨単位'))
    assert.ok(output.includes('円未満四捨五入'))
    assert.ok(output.includes('換算日 2026-01-10 / 確認先 決済明細の換算'))
    record.conversion.rounding = 'floor-yen'
    assert.ok(planningMarkdown(planning).includes('円未満切捨て'))
    record.conversion.rounding = 'ceiling-yen'
    assert.ok(planningMarkdown(planning).includes('円未満切上げ'))
  })
  it('does not expose dedicated private references or arbitrary injected fields', () => {
    const { planning, record } = fixture()
    Object.assign(record, { localReference: '/private/extra.json', token: 'SECRET_MARKER' })
    Object.assign(record.sourceBasis, { sourcePath: '/private/source.jsonl' })
    const output = planningMarkdown(planning)
    assert.ok(!output.includes('/private/'))
    assert.ok(!output.includes('SECRET_MARKER'))
    assert.ok(output.includes('自由記述はそのまま含まれます'))
  })
  it('escapes Markdown and HTML structures in adjustment free text', () => {
    const { planning, record } = fixture()
    record.reason = '\n## fake heading\n<script>x</script> [secret](https://example.invalid)'
    record.sourceBasis.contractId = '[contract](https://example.invalid)'
    const output = planningMarkdown(planning)
    assert.ok(!output.includes('\n## fake heading'))
    assert.ok(!output.includes('<script>'))
    assert.ok(!output.includes('[secret]('))
    assert.ok(output.includes('\\#\\# fake heading'))
    assert.ok(output.includes('\\[contract\\]'))
  })
  it('does not rewrite stored records or remove other planning content', () => {
    const { planning } = fixture()
    planning.profile.notes = '計画メモ'
    const before = structuredClone(planning)
    const output = planningMarkdown(planning)
    assert.deepEqual(planning, before)
    for (const value of [
      '計画メモ',
      '## 設備',
      '## 家賃・電気・通信費',
      '## 直接費',
      '## ライフサイクルと証拠',
      '## 扱いを判断した記録',
      '返金明細',
    ])
      assert.ok(output.includes(value))
  })
  it('leaves legacy and explicitly empty adjustment lists equivalent', () => {
    const legacy = emptyPlanningSnapshot(2026)
    const empty = { ...legacy, sourceAdjustments: [] }
    assert.equal(planningMarkdown(legacy), planningMarkdown(empty))
    assert.ok(!planningMarkdown(empty).includes('## 返金・訂正の登録記録'))
  })
})
