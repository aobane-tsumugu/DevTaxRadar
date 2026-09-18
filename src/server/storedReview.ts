import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { BalanceReview } from '../accounting/balanceWorkspace.js'

/** Keep this encoding identical to the original adoption/receipt encoding. */
export function canonicalReviewValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalReviewValue).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalReviewValue(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function reviewContentHash(value: unknown): string {
  return createHash('sha256').update(canonicalReviewValue(value)).digest('hex')
}

/** Read the saved payload, never pass it through current input schemas or calculators. */
export function readStoredReview(db: DatabaseSync, id: string): BalanceReview | null {
  const rows = db
    .prepare('SELECT year, payload, content_hash FROM balance_reviews WHERE id = ?')
    .all(id) as Array<{ year: number; payload: string; content_hash: string }>
  if (rows.length === 0) return null
  if (rows.length !== 1)
    throw new Error('採用済み資料のIDが重複しているため、保存内容を検証できませんでした。')
  const row = rows[0]!
  let parsed: BalanceReview
  try {
    parsed = JSON.parse(row.payload) as BalanceReview
  } catch {
    throw new Error('採用済み資料のJSONを検証できませんでした。')
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.id !== id ||
    parsed.year !== row.year ||
    reviewContentHash(parsed) !== row.content_hash
  )
    throw new Error('採用済み資料の形式または保存内容を検証できませんでした。')
  return parsed
}
