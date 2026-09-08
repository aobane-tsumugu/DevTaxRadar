import type { DatabaseSync } from 'node:sqlite'
import { requiresCostAmountMigration, migrateCostAmountTable } from './directCostMigration.js'

export const HOME_COST_TABLE = `CREATE TABLE planning_home_costs (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_jpy INTEGER CHECK(amount_jpy >= 0 AND amount_jpy <= 9007199254740991),
  unknown_amount_reason TEXT,
  method TEXT NOT NULL,
  business_use_ratio REAL NOT NULL,
  basis TEXT NOT NULL,
  rationale TEXT NOT NULL,
  tax_unit_id TEXT REFERENCES planning_tax_units(id),
  project_allocation_ratio REAL NOT NULL,
  treatment TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  targets_json TEXT CHECK(targets_json IS NULL OR json_valid(targets_json)),
  CHECK ((amount_jpy IS NULL AND unknown_amount_reason IS NOT NULL AND length(trim(unknown_amount_reason)) > 0)
    OR (amount_jpy IS NOT NULL AND unknown_amount_reason IS NULL))
) STRICT;`

export function requiresHomeCostMigration(db: DatabaseSync): boolean {
  const columns = db.prepare('PRAGMA table_info(planning_home_costs)').all() as { name: string }[]
  return (
    requiresCostAmountMigration(db, 'planning_home_costs') ||
    (columns.length > 0 && !columns.some((row) => row.name === 'targets_json'))
  )
}
export function migrateHomeCosts(db: DatabaseSync): void {
  migrateCostAmountTable(
    db,
    'planning_home_costs',
    HOME_COST_TABLE,
    'id,month,category,amount_jpy,method,business_use_ratio,basis,rationale,tax_unit_id,project_allocation_ratio,treatment,evidence_ids_json',
  )
  if (requiresHomeCostMigration(db))
    db.exec(
      'ALTER TABLE planning_home_costs ADD COLUMN targets_json TEXT CHECK(targets_json IS NULL OR json_valid(targets_json))',
    )
}
