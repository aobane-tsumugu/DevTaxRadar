import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { methodFixture, expenseInput } from './helpers/softwareMethodFixture.js'
import { chooseSoftwareMethod, draftSoftwareYearExpense } from '../../src/core/softwareMethodDraft.js'
import { initializeBalanceSchema, saveBalanceDraft, getBalanceDraft, previewBalanceReview, adoptBalanceReview, getBalanceReview } from '../../src/server/balanceRepository.js'
import { reviewExportJson, reviewExportMarkdown } from '../../src/core/reviewExport.js'
import { reviewExportMarkdown as originalMarkdown } from '../../src/core/reviewExportBody.js'

function adopt(db: DatabaseSync, year: number) {
  const preview = previewBalanceReview(db, year)
  return adoptBalanceReview(db, { year, expectedDraftRevision: preview.draftRevision,
    projectionHash: preview.projectionHash, idempotencyKey: randomUUID(), reason: '是正T02の合成条件による年度受入' })
}
describe('C06 purpose journey through the real balance repository and export entry points', () => {
  it('T01/T02: carries 120,000 whole acquisition through 24,000 annual expense, adoption and the following year', () => {
    const f = methodFixture(), source = structuredClone(f.unselected)
    source.movements.find((row) => row.id === 'add:2026')!.occurredOn = '2026-01-01'
    source.movements.find((row) => row.id === f.acquisitionId)!.occurredOn = '2026-01-01'
    f.costs.find((row) => row.year === 2026)!.bases[0]!.period.endedOn = '2026-01-01'
    const selected = chooseSoftwareMethod(source, f.planning, 'asset', {
      ...f.snapshot.accounts.find((row) => row.id === 'asset')!.softwareMethod!, usedOn: '2026-01-01',
    })
    const firstDraft = draftSoftwareYearExpense(selected, f.planning, f.costs, expenseInput(2026))
    const db = new DatabaseSync(':memory:')
    try {
      initializeBalanceSchema(db)
      const saved = saveBalanceDraft(db, firstDraft, 0, randomUUID())
      const first = adopt(db, 2026), frozenJson = reviewExportJson(first), frozenMd = reviewExportMarkdown(first)
      const a = first.projection.accounts.find((row) => row.accountId === 'asset')!
      assert.equal(a.expensesJpy, 24000); assert.deepEqual(a.closing, { status: 'known', amountJpy: 96000 })
      assert.ok(frozenMd.includes('取得価額: 120,000円')); assert.ok(frozenMd.includes('記録した年額: 2026年 24,000円'))
      for (const year of [2025, 2026]) assert.ok(frozenMd.includes(`原価: ${year}年 / part:${year} / 使用額 12,000円`))
      assert.equal(JSON.parse(frozenJson).review.id, first.id)
      const secondDraft = draftSoftwareYearExpense(getBalanceDraft(db).snapshot, f.planning, f.costs, expenseInput(2027))
      saveBalanceDraft(db, secondDraft, saved.revision, randomUUID())
      const second = adopt(db, 2027), b = second.projection.accounts.find((row) => row.accountId === 'asset')!
      assert.equal(second.previousReviewId, first.id)
      assert.deepEqual(b.opening, { status: 'known', amountJpy: 96000 }); assert.equal(b.expensesJpy, 24000)
      assert.deepEqual(b.closing, { status: 'known', amountJpy: 72000 })
      assert.equal(reviewExportJson(getBalanceReview(db, first.id)), frozenJson)
      assert.equal(reviewExportMarkdown(getBalanceReview(db, first.id)), frozenMd)
    } finally { db.close() }
  })
  it('does not invalidate real posted amounts when the same method is reconfirmed at another time', () => {
    const f = methodFixture(), posted = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    const before = structuredClone(posted), retained = posted.accounts.find((row) => row.id === 'asset')!.softwareMethod!
    const result = chooseSoftwareMethod(posted, f.planning, 'asset', { ...retained, confirmedAt: '2026-09-20T00:00:00Z' })
    assert.deepEqual(result, before); assert.notEqual(result, posted)
    assert.throws(() => chooseSoftwareMethod(posted, f.planning, 'asset', { ...retained, usefulLifeYears: 3 }))
    assert.deepEqual(posted, before)
  })
  it('T08: expenses the separate improvement without disposing of an operating predecessor', () => {
    const f = methodFixture()
    f.planning.taxUnits[0]!.unitType = 'improvement-plan'
    f.planning.taxUnits.push({ ...f.planning.taxUnits[0]!, id: 'old-unit', unitType: 'new-software', name: '稼働旧版' })
    f.snapshot.accounts.push({ id: 'old-asset', taxUnitId: 'old-unit', name: '旧版残価', kind: 'asset', openingYear: 2025, opening: { status: 'known', amountJpy: 90000 } })
    const old = structuredClone(f.snapshot.accounts.at(-1)!)
    const next = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    assert.deepEqual(next.accounts.find((row) => row.id === 'old-asset'), old)
    assert.equal(next.movements.some((row) => row.kind === 'transfer' ? row.fromAccountId === 'old-asset' : row.accountId === 'old-asset'), false)
    assert.equal(next.movements.find((row) => row.softwareExpense)?.amountJpy, 12000)
  })
  it('T11: adds no method section and changes no bytes in legacy no-method output', () => {
    const f = methodFixture(), db = new DatabaseSync(':memory:')
    try {
      initializeBalanceSchema(db); saveBalanceDraft(db, f.unselected, 0, randomUUID())
      const old = adopt(db, 2026)
      assert.equal(reviewExportMarkdown(old), originalMarkdown(old))
    } finally { db.close() }
  })
})
