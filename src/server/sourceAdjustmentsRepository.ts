import type { DatabaseSync } from 'node:sqlite'
import {
  validateSourceAdjustments,
  type SourceAdjustmentRecord,
} from '../core/sourceAdjustments.js'

const key = 'planning_source_adjustments_v1'

/** Uses the existing workspace database and transaction; not a second ledger or save API. */
export function readSourceAdjustments(db: DatabaseSync): SourceAdjustmentRecord[] {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    { value: string } | undefined
  if (!row) return []
  const value: unknown = JSON.parse(row.value)
  validateSourceAdjustments(value)
  return structuredClone(value)
}

/** The caller owns its SAVEPOINT, so later planning-write failure also rolls this write back. */
export function writeSourceAdjustments(
  db: DatabaseSync,
  records: SourceAdjustmentRecord[] | undefined,
): void {
  if (records === undefined) {
    if (readSourceAdjustments(db).length)
      throw new Error(
        '保存済みの返金・訂正記録を含む最新の計画を読み直してください。削除は明示的に空の一覧を指定します。',
      )
    return
  }
  validateSourceAdjustments(records)
  if (records.length === 0) db.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
  else
    db.prepare(
      'INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(key, JSON.stringify(records))
}
