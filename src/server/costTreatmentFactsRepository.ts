import type { DatabaseSync } from 'node:sqlite'
import { validateCostTreatmentFacts, type CostTreatmentFacts } from '../core/costTreatmentFacts.js'

const key = 'planning_cost_treatment_facts_v1'

export function readCostTreatmentFacts(db: DatabaseSync): CostTreatmentFacts[] {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    { value: string } | undefined
  if (!row) return []
  const value: unknown = JSON.parse(row.value)
  validateCostTreatmentFacts(value)
  return structuredClone(value)
}

/** Owned by the existing planning SAVEPOINT; no new save API or schema migration. */
export function writeCostTreatmentFacts(db: DatabaseSync, records: CostTreatmentFacts[] | undefined): void {
  if (records === undefined) {
    if (readCostTreatmentFacts(db).length)
      throw new Error('保存済みの処理条件を含む最新の計画を読み直してください。削除は空の一覧で明示します。')
    return
  }
  validateCostTreatmentFacts(records)
  if (!records.length) db.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
  else db.prepare('INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(records))
}
