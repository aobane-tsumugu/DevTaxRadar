import type { DatabaseSync } from 'node:sqlite'
import { requiresCostAmountMigration, migrateCostAmountTable } from './directCostMigration.js'

export const CHARGE_PERIOD_TABLE = `CREATE TABLE provider_charge_periods (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
  plan_name TEXT NOT NULL,
  service_started_on TEXT NOT NULL,
  service_ended_on TEXT NOT NULL,
  billed_on TEXT,
  amount_jpy INTEGER CHECK(amount_jpy >= 0 AND amount_jpy <= 9007199254740991),
  unknown_amount_reason TEXT,
  note TEXT,
  CHECK ((amount_jpy IS NULL AND unknown_amount_reason IS NOT NULL AND length(trim(unknown_amount_reason)) > 0)
    OR (amount_jpy IS NOT NULL AND unknown_amount_reason IS NULL))
) STRICT;`
export function requiresChargePeriodMigration(db: DatabaseSync): boolean {
  return requiresCostAmountMigration(db, 'provider_charge_periods')
}
export function migrateChargePeriods(db: DatabaseSync): void {
  migrateCostAmountTable(
    db,
    'provider_charge_periods',
    CHARGE_PERIOD_TABLE,
    'id,provider,plan_name,service_started_on,service_ended_on,billed_on,amount_jpy,note',
  )
}
