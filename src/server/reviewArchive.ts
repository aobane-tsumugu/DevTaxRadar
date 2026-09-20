import { lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { BalanceReview } from '../accounting/balanceWorkspace.js'
import { readStoredReview } from './storedReview.js'

export type ReviewArchiveEntry = Pick<
  BalanceReview,
  'id' | 'year' | 'createdAt' | 'draftRevision' | 'correctsReviewId' | 'previousReviewId' | 'reason'
>
export type ReviewArchiveIndex = {
  kind: 'stored-review-index'
  version: 1
  reviews: ReviewArchiveEntry[]
}

/**
 * Open only the explicitly selected DB. No application initialization, migration,
 * identifier creation, original-folder access, HTTP listener, or scan is involved.
 * This is a record reader, not approval to restore a foreign database schema.
 */
function withArchive<T>(directory: string, action: (db: DatabaseSync) => T): T {
  const file = join(resolve(directory), 'devtax-radar.db')
  if (!lstatSync(file).isFile()) throw new Error('読取り元には通常のDBファイルが必要です。')
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000; BEGIN')
    const check = db.prepare('PRAGMA quick_check').all()
    if (check.length !== 1 || check[0]?.quick_check !== 'ok')
      throw new Error('読取り元DBの整合性を確認できません。')
    const table = db.prepare("SELECT type FROM sqlite_schema WHERE name='balance_reviews'").get()
    if (table?.type !== 'table')
      throw new Error('このDBには対応する採用済み年度資料がありません。移行・新規作成はしません。')
    return action(db)
  } finally {
    // Closing also ends the read snapshot. The DB was opened read-only throughout.
    db.close()
  }
}

export function readArchiveReview(directory: string, id: string): BalanceReview {
  if (!id || id.trim() !== id || id.length > 500)
    throw new Error('保存済み資料のIDを指定してください。')
  return withArchive(directory, (db) => {
    const review = readStoredReview(db, id)
    if (!review) throw new Error('指定した保存済み年度資料が見つかりません。')
    return review
  })
}

export function listArchiveReviews(directory: string): ReviewArchiveIndex {
  return withArchive(directory, (db) => {
    const rows = db.prepare('SELECT id FROM balance_reviews ORDER BY year, id').all() as {
      id: string
    }[]
    const reviews = rows.map(({ id }) => {
      const review = readStoredReview(db, id)!
      return {
        id: review.id,
        year: review.year,
        createdAt: review.createdAt,
        draftRevision: review.draftRevision,
        correctsReviewId: review.correctsReviewId,
        previousReviewId: review.previousReviewId,
        reason: review.reason,
      }
    })
    // Every version is listed explicitly; do not substitute the current year's head.
    return { kind: 'stored-review-index', version: 1, reviews }
  })
}
