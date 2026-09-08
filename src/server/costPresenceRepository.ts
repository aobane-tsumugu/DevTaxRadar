import type { DatabaseSync } from 'node:sqlite'
import { costPresenceRecordsSchema, type CostPresenceRecord } from '../planning/costPresence.js'

export function initializeCostPresenceSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS planning_cost_presence (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL CHECK(tax_year BETWEEN 2000 AND 2100),
    category TEXT NOT NULL CHECK(category IN ('equipment', 'home', 'direct')),
    status TEXT NOT NULL CHECK(status IN ('not-applicable', 'deferred')),
    reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
    recorded_at TEXT NOT NULL,
    UNIQUE(tax_year, category)
  ) STRICT`)
}

export function readCostPresence(db: DatabaseSync): CostPresenceRecord[] {
  return costPresenceRecordsSchema.parse(
    db
      .prepare(
        `SELECT id, tax_year AS taxYear,
    category, status, reason, recorded_at AS recordedAt FROM planning_cost_presence ORDER BY tax_year, category`,
      )
      .all(),
  )
}

/** Caller owns the planning savepoint: failures roll back the whole workspace. */
export function writeCostPresence(db: DatabaseSync, records: CostPresenceRecord[]): void {
  const parsed = costPresenceRecordsSchema.parse(records)
  db.exec('DELETE FROM planning_cost_presence')
  const insert = db.prepare(
    'INSERT INTO planning_cost_presence(id, tax_year, category, status, reason, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const item of parsed)
    insert.run(item.id, item.taxYear, item.category, item.status, item.reason, item.recordedAt)
}
