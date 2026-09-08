import type { DatabaseSync } from 'node:sqlite'

export const DIRECT_COST_TABLE = `CREATE TABLE planning_direct_costs (
  id TEXT PRIMARY KEY,
  tax_unit_id TEXT REFERENCES planning_tax_units(id),
  incurred_on TEXT NOT NULL,
  cost_type TEXT NOT NULL,
  amount_jpy INTEGER CHECK(amount_jpy >= 0 AND amount_jpy <= 9007199254740991),
  unknown_amount_reason TEXT,
  directly_attributable INTEGER NOT NULL,
  treatment TEXT NOT NULL,
  note TEXT,
  evidence_ids_json TEXT NOT NULL,
  targets_json TEXT CHECK(targets_json IS NULL OR json_valid(targets_json)),
  CHECK ((amount_jpy IS NULL AND unknown_amount_reason IS NOT NULL AND length(trim(unknown_amount_reason)) > 0)
    OR (amount_jpy IS NOT NULL AND unknown_amount_reason IS NULL))
) STRICT;`

type CostTable =
  | 'planning_direct_costs'
  | 'planning_home_costs'
  | 'planning_equipment'
  | 'provider_charge_periods'
  | 'provider_month_charges'

export function requiresCostAmountMigration(db: DatabaseSync, table: CostTable): boolean {
  const columns = db.prepare('PRAGMA table_info(' + table + ')').all() as Array<{
    name: string
    notnull: number
  }>
  const amountColumn = table === 'planning_equipment' ? 'acquisition_cost_jpy' : 'amount_jpy'
  return columns.some((column) => column.name === amountColumn && column.notnull === 1)
}

/** Only application-defined child tables are accepted; preserve all rows and their order. */
export function migrateCostAmountTable(
  db: DatabaseSync,
  table: CostTable,
  schema: string,
  columns: string,
): void {
  if (!requiresCostAmountMigration(db, table)) return
  if (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE tbl_name = ? AND type IN ('trigger','index') AND sql IS NOT NULL",
      )
      .get(table)
  )
    throw new Error('費用表の独自index・triggerを確認する必要があるため、移行を停止しました。')
  db.exec('SAVEPOINT migrate_cost_amount')
  try {
    const legacy = table + '_legacy'
    db.exec('ALTER TABLE ' + table + ' RENAME TO ' + legacy)
    db.exec(schema)
    db.exec(
      'INSERT INTO ' +
        table +
        '(rowid,' +
        columns +
        ') SELECT rowid,' +
        columns +
        ' FROM ' +
        legacy,
    )
    db.exec('DROP TABLE ' + legacy)
    if (db.prepare('PRAGMA foreign_key_check(' + table + ')').get())
      throw new Error('費用の参照関係を移行できませんでした。')
    db.exec('RELEASE migrate_cost_amount')
  } catch (error) {
    db.exec('ROLLBACK TO migrate_cost_amount; RELEASE migrate_cost_amount')
    throw error
  }
}

export function requiresDirectCostMigration(db: DatabaseSync): boolean {
  const columns = db.prepare('PRAGMA table_info(planning_direct_costs)').all() as { name: string }[]
  return (
    requiresCostAmountMigration(db, 'planning_direct_costs') ||
    (columns.length > 0 && !columns.some((row) => row.name === 'targets_json'))
  )
}
export function migrateDirectCosts(db: DatabaseSync): void {
  migrateCostAmountTable(
    db,
    'planning_direct_costs',
    DIRECT_COST_TABLE,
    'id,tax_unit_id,incurred_on,cost_type,amount_jpy,directly_attributable,treatment,note,evidence_ids_json',
  )
  if (requiresDirectCostMigration(db))
    db.exec(
      'ALTER TABLE planning_direct_costs ADD COLUMN targets_json TEXT CHECK(targets_json IS NULL OR json_valid(targets_json))',
    )
}
