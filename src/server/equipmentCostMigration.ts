import type { DatabaseSync } from 'node:sqlite'
import { requiresCostAmountMigration, migrateCostAmountTable } from './directCostMigration.js'

export const EQUIPMENT_TABLE = `CREATE TABLE planning_equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  acquisition_cost_jpy INTEGER CHECK(acquisition_cost_jpy >= 0 AND acquisition_cost_jpy <= 9007199254740991),
  unknown_amount_reason TEXT,
  ordered_on TEXT,
  delivered_on TEXT,
  acquired_on TEXT NOT NULL,
  business_use_started_on TEXT,
  converted_from_private INTEGER NOT NULL,
  opening_unamortized_balance_jpy INTEGER,
  business_use_ratio REAL NOT NULL,
  useful_life_years INTEGER,
  role TEXT NOT NULL,
  tax_unit_id TEXT REFERENCES planning_tax_units(id),
  project_allocation_ratio REAL NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  CHECK ((acquisition_cost_jpy IS NULL AND unknown_amount_reason IS NOT NULL AND length(trim(unknown_amount_reason)) > 0)
    OR (acquisition_cost_jpy IS NOT NULL AND unknown_amount_reason IS NULL))
) STRICT;`

export function requiresEquipmentCostMigration(db: DatabaseSync): boolean {
  return requiresCostAmountMigration(db, 'planning_equipment')
}
export function migrateEquipmentCosts(db: DatabaseSync): void {
  migrateCostAmountTable(
    db,
    'planning_equipment',
    EQUIPMENT_TABLE,
    'id,name,equipment_type,acquisition_cost_jpy,ordered_on,delivered_on,acquired_on,business_use_started_on,converted_from_private,opening_unamortized_balance_jpy,business_use_ratio,useful_life_years,role,tax_unit_id,project_allocation_ratio,evidence_ids_json',
  )
}
