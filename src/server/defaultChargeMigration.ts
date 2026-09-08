import type { DatabaseSync } from 'node:sqlite'

export const PROVIDER_SETTINGS_TABLE = `CREATE TABLE provider_settings (
  provider TEXT PRIMARY KEY,
  monthly_fee_jpy INTEGER DEFAULT 0 CHECK(monthly_fee_jpy >= 0 AND monthly_fee_jpy <= 9007199254740991),
  unknown_amount_reason TEXT,
  contract_started_on TEXT,
  contract_ended_on TEXT,
  CHECK ((monthly_fee_jpy IS NULL AND unknown_amount_reason IS NOT NULL AND length(trim(unknown_amount_reason)) > 0)
    OR (monthly_fee_jpy IS NOT NULL AND unknown_amount_reason IS NULL))
) STRICT;`

export function requiresDefaultChargeMigration(db: DatabaseSync): boolean {
  const columns = db.prepare('PRAGMA table_info(provider_settings)').all() as {
    name: string
    notnull: number
  }[]
  return (
    columns.length > 0 &&
    (!columns.some((row) => row.name === 'unknown_amount_reason') ||
      columns.some((row) => row.name === 'monthly_fee_jpy' && row.notnull === 1))
  )
}

export function migrateDefaultCharges(db: DatabaseSync): void {
  if (!requiresDefaultChargeMigration(db)) return
  if (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE tbl_name='provider_settings' AND type IN ('trigger','index') AND sql IS NOT NULL",
      )
      .get()
  )
    throw new Error('既定月額表の独自index・triggerを確認する必要があるため、移行を停止しました。')
  const columns = new Set(
    (db.prepare('PRAGMA table_info(provider_settings)').all() as { name: string }[]).map(
      (row) => row.name,
    ),
  )
  db.exec('SAVEPOINT migrate_default_charges')
  try {
    db.exec('ALTER TABLE provider_settings RENAME TO provider_settings_legacy')
    db.exec(PROVIDER_SETTINGS_TABLE)
    db.exec(`INSERT INTO provider_settings(rowid,provider,monthly_fee_jpy,unknown_amount_reason,contract_started_on,contract_ended_on)
      SELECT rowid,provider,monthly_fee_jpy,${columns.has('unknown_amount_reason') ? 'unknown_amount_reason' : 'NULL'},${columns.has('contract_started_on') ? 'contract_started_on' : 'NULL'},${columns.has('contract_ended_on') ? 'contract_ended_on' : 'NULL'} FROM provider_settings_legacy`)
    db.exec('DROP TABLE provider_settings_legacy')
    if (db.prepare('PRAGMA foreign_key_check').get())
      throw new Error('既定月額の参照関係を移行できませんでした。')
    db.exec('RELEASE migrate_default_charges')
  } catch (error) {
    db.exec('ROLLBACK TO migrate_default_charges; RELEASE migrate_default_charges')
    throw error
  }
}
