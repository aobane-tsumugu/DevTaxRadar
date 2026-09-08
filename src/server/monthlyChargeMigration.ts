import type { DatabaseSync } from 'node:sqlite'
import { requiresCostAmountMigration, migrateCostAmountTable } from './directCostMigration.js'
export const MONTHLY_CHARGE_TABLE = `CREATE TABLE provider_month_charges (
  provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
  month TEXT NOT NULL,
  amount_jpy INTEGER CHECK(amount_jpy >= 0 AND amount_jpy <= 9007199254740991),
  unknown_amount_reason TEXT,
  PRIMARY KEY(provider, month),
  CHECK ((amount_jpy IS NULL AND unknown_amount_reason IS NOT NULL AND length(trim(unknown_amount_reason)) > 0)
    OR (amount_jpy IS NOT NULL AND unknown_amount_reason IS NULL))
) STRICT;`
export function requiresMonthlyChargeMigration(db: DatabaseSync): boolean {
  return requiresCostAmountMigration(db, 'provider_month_charges')
}
export function migrateMonthlyCharges(db: DatabaseSync): void {
  migrateCostAmountTable(
    db,
    'provider_month_charges',
    MONTHLY_CHARGE_TABLE,
    'provider,month,amount_jpy',
  )
}
