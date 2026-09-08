import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export function initializeDatasetIdentity(db: DatabaseSync): void {
  db.prepare("INSERT OR IGNORE INTO app_settings(key,value) VALUES ('dataset_identity',?)").run(
    randomUUID(),
  )
  datasetIdentity(db)
}
/** Stable for this saved dataset, including backup/restore; contains no local path. */
export function datasetIdentity(db: DatabaseSync): string {
  const row = db.prepare("SELECT value FROM app_settings WHERE key='dataset_identity'").get()
  if (
    typeof row?.value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.value)
  )
    throw new Error('保存資料の識別子を確認できません。既存の識別子を自動置換しません。')
  return row.value
}
