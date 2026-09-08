import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { reviewExportMarkdown } from '../../src/core/reviewExport.js'
import {
  adoptBalanceReview,
  BalanceConflictError,
  getBalanceDraft,
  getBalanceReview,
  initializeBalanceSchema,
  listBalanceReviews,
  previewBalanceReview,
  saveBalanceDraft,
} from '../../src/server/balanceRepository.js'

function snapshot(): BalanceSnapshot {
  return {
    version: 1,
    accounts: [
      {
        id: 'asset',
        taxUnitId: 'unit-a',
        name: '合成の資産',
        kind: 'asset',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 100 },
      },
    ],
    movements: [2026, 2027].map((year) => ({
      id: `expense-${year}`,
      occurredOn: `${year}-12-31`,
      amountJpy: 10,
      sourceIds: ['synthetic-source'],
      decisionId: `synthetic-decision-${year}`,
      reason: '検証用に採用した額',
      kind: 'expense',
      accountId: 'asset',
    })),
    pendingDecisions: [],
  }
}

describe('adopted balance records', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
  })
  afterEach(() => db.close())
  it('recognizes committed draft requests without another write and never replays over later updates', () => {
    const key = randomUUID()
    const first = saveBalanceDraft(db, snapshot(), 0, key)
    expect(saveBalanceDraft(db, snapshot(), 0, key)).toEqual(first)
    expect(getBalanceDraft(db).revision).toBe(1)
    const changed = snapshot()
    changed.accounts[0]!.name = '変更'
    expect(() => saveBalanceDraft(db, changed, 0, key)).toThrow('同じ保存要求ID')
    const second = saveBalanceDraft(db, changed, 1, randomUUID())
    expect(() => saveBalanceDraft(db, snapshot(), 0, key)).toThrow('成功済み')
    expect(getBalanceDraft(db)).toEqual(second)
    expect(() => saveBalanceDraft(db, snapshot(), 2, key)).toThrow('同じ保存要求ID')
  })
  it('rolls back the draft when recording its receipt fails', () => {
    db.exec(
      "CREATE TRIGGER reject_receipt BEFORE INSERT ON balance_draft_receipts BEGIN SELECT RAISE(ABORT, 'receipt failure'); END",
    )
    const key = randomUUID()
    expect(() => saveBalanceDraft(db, snapshot(), 0, key)).toThrow('receipt failure')
    expect(getBalanceDraft(db).revision).toBe(0)
    expect(db.prepare('SELECT * FROM balance_draft_receipts').all()).toEqual([])
    db.exec('DROP TRIGGER reject_receipt')
    expect(saveBalanceDraft(db, snapshot(), 0, key).revision).toBe(1)
  })
  function adoption(year: number, key: string) {
    const preview = previewBalanceReview(db, year)
    return {
      year,
      expectedDraftRevision: preview.draftRevision,
      projectionHash: preview.projectionHash,
      idempotencyKey: key,
      reason: '内容を確認した合成例',
    }
  }

  it('saves a draft atomically and rejects stale tabs', () => {
    expect(getBalanceDraft(db).revision).toBe(0)
    const saved = saveBalanceDraft(db, snapshot(), 0)
    expect(saved.revision).toBe(1)
    const change = snapshot()
    change.accounts[0].name = '別タブ'
    expect(() => saveBalanceDraft(db, change, 0)).toThrow(BalanceConflictError)
    expect(getBalanceDraft(db)).toEqual(saved)
    expect(saveBalanceDraft(db, change, 1).revision).toBe(2)
  })

  it('round trips resolved questions and preserves the original adopted question', () => {
    const s = snapshot()
    s.pendingDecisions = [
      {
        id: 'q',
        taxUnitId: 'unit-a',
        taxYear: 2026,
        amount: { status: 'unknown', amountJpy: null, reasons: ['資料待ち'] },
        accountIds: ['asset'],
        sourceIds: ['receipt'],
        reasons: ['相談中'],
      },
    ]
    saveBalanceDraft(db, s, 0)
    const original = adoptBalanceReview(db, adoption(2026, 'pending'))
    s.pendingDecisions[0]!.resolution = {
      taxYear: 2027,
      decisionId: 'answer',
      reason: '相談結果を確認',
    }
    saveBalanceDraft(db, s, 1)
    expect(getBalanceDraft(db).snapshot.pendingDecisions).toEqual(s.pendingDecisions)
    const resolved = adoptBalanceReview(db, adoption(2027, 'resolved'))
    expect(resolved.projection.pendingDecisions).toEqual([])
    expect(resolved.snapshot.pendingDecisions[0]!.resolution).toEqual(
      s.pendingDecisions[0]!.resolution,
    )
    expect(getBalanceReview(db, original.id)).toEqual(original)
    expect(reviewExportMarkdown(resolved)).toContain('## 解消した確認事項')
    expect(reviewExportMarkdown(resolved)).toContain(
      '元の問い: 相談中 / 解消年: 2027 / 判断: answer / 理由: 相談結果を確認',
    )
  })

  it('does not adopt a projection after the draft changed', () => {
    saveBalanceDraft(db, snapshot(), 0)
    const request = adoption(2026, 'stale')
    saveBalanceDraft(db, snapshot(), 1)
    expect(() => adoptBalanceReview(db, request)).toThrow(/確認後/)
    expect(listBalanceReviews(db)).toEqual([])
  })

  it('makes retries idempotent even after a later draft save', () => {
    saveBalanceDraft(db, snapshot(), 0)
    const request = adoption(2026, 'retry')
    const adopted = adoptBalanceReview(db, request)
    saveBalanceDraft(db, snapshot(), 1)
    expect(adoptBalanceReview(db, request)).toEqual(adopted)
    expect(listBalanceReviews(db)).toHaveLength(1)
    expect(() => adoptBalanceReview(db, { ...request, reason: '異なる要求' })).toThrow(/異なる内容/)
  })

  it('keeps the adopted snapshot after source data disappears from the draft', () => {
    const data = snapshot()
    saveBalanceDraft(db, data, 0)
    const adopted = adoptBalanceReview(db, adoption(2026, 'retain'))
    saveBalanceDraft(db, { version: 1, accounts: [], movements: [], pendingDecisions: [] }, 1)
    data.accounts[0].name = '後から変わった名前'
    expect(getBalanceReview(db, adopted.id)).toEqual(adopted)
    expect(getBalanceReview(db, adopted.id)?.projection.totals.knownClosingJpy).toBe(90)
  })

  it('enforces immutable adopted rows at the database boundary', () => {
    saveBalanceDraft(db, snapshot(), 0)
    const adopted = adoptBalanceReview(db, adoption(2026, 'immutable'))
    expect(() =>
      db.prepare('UPDATE balance_reviews SET payload = ? WHERE id = ?').run('{}', adopted.id),
    ).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM balance_reviews WHERE id = ?').run(adopted.id)).toThrow(
      /immutable/,
    )
    expect(getBalanceReview(db, adopted.id)).toEqual(adopted)
  })

  it('carries adopted closing balances, preserves corrections and flags downstream records', () => {
    saveBalanceDraft(db, snapshot(), 0)
    const first = adoptBalanceReview(db, adoption(2026, 'first'))
    const next = adoptBalanceReview(db, adoption(2027, 'next'))
    expect(next.previousReviewId).toBe(first.id)
    expect(next.projection.totals.knownOpeningJpy).toBe(90)
    const changed = snapshot()
    changed.movements[0].amountJpy = 20
    saveBalanceDraft(db, changed, 1)
    expect(() => adoptBalanceReview(db, adoption(2027, 'inconsistent'))).toThrow(
      /前年度の採用済み期末/,
    )
    const corrected = adoptBalanceReview(db, adoption(2026, 'correct-first'))
    expect(corrected.correctsReviewId).toBe(first.id)
    expect(listBalanceReviews(db).find((row) => row.id === next.id)).toMatchObject({
      active: true,
      previousYearChanged: true,
    })
    expect(getBalanceReview(db, next.id)).toEqual(next)
    expect(() => adoptBalanceReview(db, adoption(2028, 'skip-correction'))).toThrow(
      /過年度訂正の未反映/,
    )
    const correctedNext = adoptBalanceReview(db, adoption(2027, 'correct-next'))
    expect(correctedNext.previousReviewId).toBe(corrected.id)
    expect(correctedNext.correctsReviewId).toBe(next.id)
    expect(correctedNext.projection.totals.knownClosingJpy).toBe(70)
    expect(listBalanceReviews(db).filter((row) => row.active)).toHaveLength(2)
  })

  it('rejects a missing carry-forward account and an unexplained prior opening', () => {
    saveBalanceDraft(db, snapshot(), 0)
    adoptBalanceReview(db, adoption(2026, 'first'))
    saveBalanceDraft(db, { version: 1, accounts: [], movements: [], pendingDecisions: [] }, 1)
    expect(() => adoptBalanceReview(db, adoption(2027, 'missing-account'))).toThrow(
      /前年度の採用済み期末/,
    )
    const extra = snapshot()
    extra.accounts.push({ ...extra.accounts[0], id: 'extra', name: '遡及して追加した残高' })
    saveBalanceDraft(db, extra, 2)
    expect(() => adoptBalanceReview(db, adoption(2027, 'extra-account'))).toThrow(
      /前年度にない繰越残高/,
    )
  })

  it('does not silently skip a year with an adopted earlier record', () => {
    saveBalanceDraft(db, snapshot(), 0)
    adoptBalanceReview(db, adoption(2026, 'first'))
    expect(() => adoptBalanceReview(db, adoption(2028, 'gap'))).toThrow(/年度の記録が途切れ/)
  })

  it('detects prior expense changes even when the closing balance stays the same', () => {
    saveBalanceDraft(db, snapshot(), 0)
    adoptBalanceReview(db, adoption(2026, 'first'))
    const changed = snapshot()
    changed.movements[0].amountJpy = 20
    changed.movements.push({
      ...changed.movements[0],
      id: 'extra-addition',
      occurredOn: '2026-01-01',
      kind: 'addition',
      accountId: 'asset',
      amountJpy: 10,
    })
    saveBalanceDraft(db, changed, 1)
    expect(previewBalanceReview(db, 2027).projection.totals.knownOpeningJpy).toBe(90)
    expect(() => adoptBalanceReview(db, adoption(2027, 'same-net'))).toThrow(/残高が同額でも/)
  })

  it('flags all later years affected by an unresolved earlier correction', () => {
    saveBalanceDraft(db, snapshot(), 0)
    adoptBalanceReview(db, adoption(2026, 'first'))
    const second = adoptBalanceReview(db, adoption(2027, 'second'))
    const third = adoptBalanceReview(db, adoption(2028, 'third'))
    const changed = snapshot()
    changed.movements[0].amountJpy = 20
    saveBalanceDraft(db, changed, 1)
    adoptBalanceReview(db, adoption(2026, 'correct-first'))
    const listed = listBalanceReviews(db)
    expect(listed.find((row) => row.id === second.id)?.previousYearChanged).toBe(true)
    expect(listed.find((row) => row.id === third.id)?.previousYearChanged).toBe(true)
    expect(() => adoptBalanceReview(db, adoption(2029, 'fourth'))).toThrow(/過年度訂正の未反映/)
  })

  it('excludes accidental raw-reference fields from the stored draft and adopted record', () => {
    const data = snapshot()
    Object.assign(data, { prompt: 'synthetic-private-body' })
    Object.assign(data.accounts[0], { nativePath: 'synthetic-private-path' })
    saveBalanceDraft(db, data, 0)
    const adopted = adoptBalanceReview(db, adoption(2026, 'privacy'))
    expect(JSON.stringify(getBalanceDraft(db))).not.toContain('synthetic-private')
    expect(JSON.stringify(adopted)).not.toContain('synthetic-private')
  })
})
