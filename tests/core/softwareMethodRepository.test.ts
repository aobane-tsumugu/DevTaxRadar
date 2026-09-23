import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  saveBalanceDraft,
  getBalanceDraft,
  previewBalanceReview,
  adoptBalanceReview,
  getBalanceReview,
  initializeBalanceSchema,
  listBalanceReviews,
} from '../../src/server/balanceRepository.js'
import {
  chooseSoftwareMethod,
  draftSoftwareYearExpense,
  endSoftwareOrdinaryMethod,
} from '../../src/core/softwareMethodDraft.js'
import { softwareMethodAdoptionIssues } from '../../src/core/softwareMethod.js'
import { methodFixture, expenseInput } from './helpers/softwareMethodFixture.js'

function database(action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(':memory:')
  try {
    initializeBalanceSchema(db)
    action(db)
  } finally {
    db.close()
  }
}
function adopt(db: DatabaseSync, year: number, idempotencyKey = randomUUID()) {
  const preview = previewBalanceReview(db, year)
  return adoptBalanceReview(db, {
    year,
    expectedDraftRevision: preview.draftRevision,
    projectionHash: preview.projectionHash,
    idempotencyKey,
    reason: '計算した年額と原価対応の合成受入',
  })
}
const savedMethod = (db: DatabaseSync) =>
  getBalanceDraft(db).snapshot.accounts.find((row) => row.id === 'asset')!.softwareMethod

describe('selected method through real SQLite save, adoption and following-year records', () => {
  it('retains the method and computed amount through 2026/2027 adoption, then reads the original version unchanged', () =>
    database((db) => {
      const f = methodFixture(),
        first = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
      const save = saveBalanceDraft(db, first, 0, randomUUID())
      assert.deepEqual(
        savedMethod(db),
        first.accounts.find((a) => a.id === 'asset')!.softwareMethod,
      )
      const old = adopt(db, 2026),
        frozen = JSON.stringify(getBalanceReview(db, old.id))
      assert.equal(old.projection.totals.expensesJpy, 12000)
      const next = draftSoftwareYearExpense(
        getBalanceDraft(db).snapshot,
        f.planning,
        f.costs,
        expenseInput(2027),
      )
      saveBalanceDraft(db, next, save.revision, randomUUID())
      const second = adopt(db, 2027)
      assert.equal(second.previousReviewId, old.id)
      const row = second.projection.accounts.find((a) => a.accountId === 'asset')!
      assert.equal(row.opening.amountJpy, 108000)
      assert.equal(row.expensesJpy, 24000)
      assert.equal(row.closing.amountJpy, 84000)
      assert.equal(JSON.stringify(getBalanceReview(db, old.id)), frozen)
      assert.equal(
        second.snapshot.accounts.find((a) => a.id === 'asset')!.softwareMethod!.method,
        'straight-line',
      )
      assert.equal(
        second.snapshot.movements.find(
          (m) => m.id === 'balance-use:' + expenseInput(2027).requestId,
        )!.softwareExpense!.year,
        2027,
      )
    }))
  it('rejects adoption of a selected but unposted method, without rejecting ordinary draft saving', () =>
    database((db) => {
      const f = methodFixture()
      saveBalanceDraft(db, f.snapshot, 0, randomUUID())
      assert.throws(() => adopt(db, 2026), /年額/)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM balance_reviews').get()!.n, 0)
      assert.equal(getBalanceDraft(db).revision, 1)
    }))
  it('is idempotent for both balance saves and annual adoption', () =>
    database((db) => {
      const f = methodFixture(),
        draft = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
      const request = randomUUID(),
        saved = saveBalanceDraft(db, draft, 0, request)
      assert.deepEqual(saveBalanceDraft(db, draft, 0, request), saved)
      const adoption = randomUUID(),
        preview = previewBalanceReview(db, 2026)
      const requestBody = {
        year: 2026,
        expectedDraftRevision: preview.draftRevision,
        projectionHash: preview.projectionHash,
        idempotencyKey: adoption,
        reason: '同一要求の再送',
      }
      const first = adoptBalanceReview(db, requestBody)
      assert.equal(adoptBalanceReview(db, requestBody).id, first.id)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM balance_reviews').get()!.n, 1)
    }))
  it('refuses stale saves and old writers dropping a retained selection', () =>
    database((db) => {
      const f = methodFixture()
      saveBalanceDraft(db, f.snapshot, 0, randomUUID())
      const old = structuredClone(f.snapshot)
      delete old.accounts.find((a) => a.id === 'asset')!.softwareMethod
      assert.throws(() => saveBalanceDraft(db, old, 1, randomUUID()), /省略/)
      assert.throws(() => saveBalanceDraft(db, f.snapshot, 0, randomUUID()), /別の画面/)
      assert.equal(getBalanceDraft(db).revision, 1)
      assert.ok(savedMethod(db))
    }))
  it('does not silently strip the annual expense marker', () =>
    database((db) => {
      const f = methodFixture(),
        draft = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
      saveBalanceDraft(db, draft, 0, randomUUID())
      delete draft.movements.at(-1)!.softwareExpense
      assert.throws(() => saveBalanceDraft(db, draft, 1, randomUUID()), /確認元/)
      assert.ok(getBalanceDraft(db).snapshot.movements.at(-1)!.softwareExpense)
    }))
  it('rolls back a failed write after validation instead of saving only part of the batch', () =>
    database((db) => {
      const f = methodFixture()
      saveBalanceDraft(db, f.snapshot, 0, randomUUID())
      db.exec(
        "CREATE TRIGGER fail_new_receipt BEFORE INSERT ON balance_draft_receipts BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END",
      )
      const next = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
      assert.throws(() => saveBalanceDraft(db, next, 1, randomUUID()), /synthetic write failure/)
      assert.equal(getBalanceDraft(db).revision, 1)
      assert.equal(
        getBalanceDraft(db).snapshot.movements.filter((m) => m.softwareExpense).length,
        0,
      )
    }))
  it('keeps fixed prior and following-year records when the selected life is explicitly corrected', () =>
    database((db) => {
      const f = methodFixture()
      let next = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
      saveBalanceDraft(db, next, 0, randomUUID())
      const first = adopt(db, 2026)
      next = draftSoftwareYearExpense(next, f.planning, f.costs, expenseInput(2027))
      saveBalanceDraft(db, next, 1, randomUUID())
      const second = adopt(db, 2027)
      const oldFirst = JSON.stringify(getBalanceReview(db, first.id)),
        oldSecond = JSON.stringify(getBalanceReview(db, second.id))
      const choice = f.snapshot.accounts.find((a) => a.id === 'asset')!.softwareMethod!
      const corrected = chooseSoftwareMethod(f.unselected, f.planning, 'asset', {
        ...choice,
        usefulLifeYears: 3,
        reason: '資料に基づく区分の訂正',
      })
      next = draftSoftwareYearExpense(corrected, f.planning, f.costs, expenseInput(2026))
      saveBalanceDraft(db, next, 2, randomUUID())
      const correction = adopt(db, 2026)
      assert.equal(correction.correctsReviewId, first.id)
      assert.equal(correction.projection.totals.expensesJpy, 20040)
      assert.ok(listBalanceReviews(db).find((r) => r.id === second.id)!.previousYearChanged)
      assert.equal(JSON.stringify(getBalanceReview(db, first.id)), oldFirst)
      assert.equal(JSON.stringify(getBalanceReview(db, second.id)), oldSecond)
      next = draftSoftwareYearExpense(next, f.planning, f.costs, expenseInput(2027))
      saveBalanceDraft(db, next, 3, randomUUID())
      const secondCorrection = adopt(db, 2027)
      assert.equal(secondCorrection.previousReviewId, correction.id)
      assert.equal(secondCorrection.correctsReviewId, second.id)
      assert.equal(secondCorrection.projection.totals.expensesJpy, 40080)
    }))
  it('ends automatic ordinary calculations explicitly without changing previous amounts', () =>
    database((db) => {
      const f = methodFixture(),
        posted = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
      const ended = endSoftwareOrdinaryMethod(
        posted,
        'asset',
        2026,
        '2027年から転用・終了の扱いを別途確認',
      )
      assert.equal(ended.movements.at(-1)!.amountJpy, 12000)
      assert.deepEqual(softwareMethodAdoptionIssues(ended, 2027, f.planning), [])
      assert.throws(
        () => draftSoftwareYearExpense(ended, f.planning, f.costs, expenseInput(2027)),
        /終了後/,
      )
      saveBalanceDraft(db, ended, 0, randomUUID())
      assert.equal(savedMethod(db)!.ordinaryThroughYear, 2026)
    }))
  it('detects same-ID changed method evidence for current adoption and does not bind a private path move', () => {
    const f = methodFixture(),
      posted = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    f.planning.evidence[0]!.localReference = 'A-DIFFERENT-PRIVATE-PATH'
    assert.deepEqual(softwareMethodAdoptionIssues(posted, 2026, f.planning), [])
    f.planning.evidence[0]!.note += ' different evidence'
    assert.match(softwareMethodAdoptionIssues(posted, 2026, f.planning)[0]!.message, /根拠/)
  })
  it('blocks ordinary adoption after a recorded retirement, not only the UI helper', () => {
    const f = methodFixture(),
      next = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    f.planning.lifecycleEvents.push({
      id: 'retired',
      taxUnitId: 'software',
      eventType: 'retired',
      occurredOn: '2026-10-01',
      recordedAt: '2026-10-01T00:00:00Z',
      evidenceIds: ['proof'],
    })
    assert.match(softwareMethodAdoptionIssues(next, 2026, f.planning)[0]!.message, /終了・中止/)
    const ended = endSoftwareOrdinaryMethod(f.snapshot, 'asset', 2025, '供用初年の中止を別途確認')
    assert.deepEqual(softwareMethodAdoptionIssues(ended, 2026, f.planning), [])
  })
  it('does not force a historical correction for a later end of ordinary calculation', () =>
    database((db) => {
      const f = methodFixture(),
        firstDraft = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
      saveBalanceDraft(db, firstDraft, 0, randomUUID())
      const first = adopt(db, 2026),
        unchanged = JSON.stringify(getBalanceReview(db, first.id))
      const ended = endSoftwareOrdinaryMethod(
        firstDraft,
        'asset',
        2026,
        '2027年からは別の処理として確認',
      )
      saveBalanceDraft(db, ended, 1, randomUUID())
      const next = adopt(db, 2027)
      assert.equal(next.previousReviewId, first.id)
      assert.equal(JSON.stringify(getBalanceReview(db, first.id)), unchanged)
    }))
  it('retains exact method records after database close/reopen with no original logs', () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-method-db-')),
      file = join(root, 'data.db')
    try {
      const f = methodFixture(),
        next = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
      const db = new DatabaseSync(file)
      let id = '',
        expected = ''
      try {
        initializeBalanceSchema(db)
        saveBalanceDraft(db, next, 0, randomUUID())
        const review = adopt(db, 2026)
        id = review.id
        expected = JSON.stringify(getBalanceReview(db, id))
      } finally {
        db.close()
      }
      const reopened = new DatabaseSync(file, { readOnly: true })
      try {
        assert.equal(JSON.stringify(getBalanceReview(reopened, id)), expected)
      } finally {
        reopened.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
