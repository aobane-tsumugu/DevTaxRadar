import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace.js'
import { accountantCsvFiles } from '../../src/core/accountantCsv.js'
import { originalChargeFactSchema } from '../../src/planning/originalCharges.js'

const fixture = () =>
  JSON.parse(
    readFileSync('fixtures/archive/stored-review-materials-v1.json', 'utf8'),
  ) as BalanceReview

function records(review: BalanceReview, filename: string) {
  const content = accountantCsvFiles(review).find((file) => file.name === filename)!.content
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false
  for (let i = 1; i < content.length; i++) {
    const character = content[i]
    if (character === '"') {
      if (quoted && content[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (character === ',' || character === '\r')) {
      row.push(cell)
      cell = ''
      if (character === '\r') {
        expect(content[++i]).toBe('\n')
        rows.push(row)
        row = []
      }
    } else cell += character
  }
  const headers = rows.shift()!
  return rows.map((values) => Object.fromEntries(headers.map((key, i) => [key, values[i]])))
}

describe('accountant CSV independent money semantics review', () => {
  it('keeps a known foreign original amount distinct from an unknown adopted JPY amount', () => {
    const review = fixture()
    const source = review.materials!.costs.sources.find((row) => row.id === 'direct:unknown')!
    source.unknownOriginalAmountReasons = ['Exchange rate evidence not yet available']
    source.originalChargeFact = originalChargeFactSchema.parse({
      id: 'foreign-original',
      sourceId: source.id,
      recordedAt: '2026-02-01T00:00:00Z',
      category: 'direct',
      record: {
        id: 'unknown',
        taxUnitId: 'unit-b',
        incurredOn: '2026-01-31',
        costType: 'cloud',
        amountJpy: null,
        unknownAmountReason: source.unknownOriginalAmountReasons[0],
        directlyAttributable: true,
        treatment: 'direct',
        evidenceIds: source.evidenceIds,
      },
      original: {
        currency: 'USD',
        amount: '20.00',
        amountJpy: null,
        unknownJpyReason: source.unknownOriginalAmountReasons[0],
      },
      dates: { incurredOn: '2026-01-31', billedOn: '2026-02-01', paidOn: '2026-02-02' },
      servicePeriod: { startedOn: '2026-01-01', endedOn: '2026-01-31' },
      contract: { reference: 'Invoice contract reference', reason: 'Recorded contract details' },
      evidenceIds: source.evidenceIds,
      provenance: { kind: 'manual' },
    })
    const exported = records(review, 'sources.csv').find((row) => row.source_id === source.id)!
    expect(exported.original_currency).toBe('USD')
    expect(exported.original_amount_decimal_text).toBe('20.00')
    expect(exported.original_amount_status).toBe('known')
    expect(exported.adopted_original_jpy_status).toBe('unknown')
    expect(exported.adopted_original_jpy).toBe('')
    expect(exported.unknown_reasons_json).toContain(source.unknownOriginalAmountReasons[0])
    expect(exported.billed_on).toBe('2026-02-01')
    expect(exported.paid_on).toBe('2026-02-02')
    expect(exported.period_start).toBe('2026-01-01')
    expect(exported.period_end).toBe('2026-01-31')
    expect(exported.original_contract_reference).toBe('Invoice contract reference')
    expect(exported.contract_id).toBe('')
  })

  it('retains unknown-amount explanations separately from the pending decision question', () => {
    const review = fixture()
    const pending = review.snapshot.pendingDecisions[0]!
    const amountReason = 'Invoice has not arrived; amount cannot yet be determined'
    pending.amount = { status: 'unknown', amountJpy: null, reasons: [amountReason] }
    review.projection.pendingDecisions[0]!.amount = structuredClone(pending.amount)
    const row = records(review, 'pending_decisions.csv').find(
      (record) => record.pending_id === pending.id,
    )!
    expect(row.amount_status).toBe('unknown')
    expect(row.amount_jpy).toBe('')
    expect(row.amount_reasons_json).toBe(JSON.stringify([amountReason]))
    expect(row.reasons_json).toBe(JSON.stringify(pending.reasons))
    const unresolved = records(review, 'unresolved.csv').find(
      (record) => record.item_kind === 'pending-decision' && record.item_id === pending.id,
    )!
    expect(unresolved.reasons_json).toContain(amountReason)
    expect(unresolved.reasons_json).toContain(pending.reasons[0])
  })

  it('uses saved active-question membership instead of treating any resolution as current', () => {
    const review = fixture()
    const pending = review.snapshot.pendingDecisions[0]!
    pending.resolution = {
      taxYear: review.year,
      decisionId: 'resolution-needing-reconfirmation',
      reason: 'Previous answer no longer matches the question',
    }
    review.snapshot.pendingDecisions.push({
      ...structuredClone(pending),
      id: 'future-question',
      taxYear: review.year + 1,
      resolution: undefined,
    })
    const exported = records(review, 'pending_decisions.csv')
    expect(exported.find((row) => row.pending_id === pending.id)!.active_in_review).toBe('true')
    expect(exported.find((row) => row.pending_id === 'future-question')!.active_in_review).toBe(
      'false',
    )
  })
})
