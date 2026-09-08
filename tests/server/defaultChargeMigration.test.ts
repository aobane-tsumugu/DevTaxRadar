import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import {
  migrateDefaultCharges,
  requiresDefaultChargeMigration,
} from '../../src/server/defaultChargeMigration.js'

function legacy() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE provider_settings(provider TEXT PRIMARY KEY, monthly_fee_jpy INTEGER NOT NULL, contract_started_on TEXT, contract_ended_on TEXT) STRICT;
    INSERT INTO provider_settings VALUES ('claude',6200,'2026-01-01',NULL);
    INSERT INTO provider_settings VALUES ('codex',0,NULL,'2026-12-31');`)
  return db
}
describe('default AI charge amount migration', () => {
  it('preserves provider keys and contracts and zero values and persists unknown reasons', () => {
    const db = legacy()
    try {
      const before = db.prepare('SELECT rowid,* FROM provider_settings ORDER BY rowid').all()
      migrateDefaultCharges(db)
      expect(requiresDefaultChargeMigration(db)).toBe(false)
      expect(
        db
          .prepare('SELECT rowid,* FROM provider_settings ORDER BY rowid')
          .all()
          .map(({ unknown_amount_reason: _reason, ...row }) => row),
      ).toEqual(before)
      expect(() =>
        db.exec("UPDATE provider_settings SET monthly_fee_jpy=NULL WHERE provider='claude'"),
      ).toThrow()
      db.exec(
        "UPDATE provider_settings SET monthly_fee_jpy=NULL,unknown_amount_reason='請求確認待ち' WHERE provider='claude'",
      )
      migrateDefaultCharges(db)
      expect(
        db
          .prepare(
            "SELECT monthly_fee_jpy,unknown_amount_reason FROM provider_settings WHERE provider='claude'",
          )
          .get(),
      ).toEqual({ monthly_fee_jpy: null, unknown_amount_reason: '請求確認待ち' })
      expect(() =>
        db.exec("UPDATE provider_settings SET monthly_fee_jpy=0 WHERE provider='claude'"),
      ).toThrow()
      db.exec(
        "UPDATE provider_settings SET monthly_fee_jpy=0,unknown_amount_reason=NULL WHERE provider='claude'",
      )
    } finally {
      db.close()
    }
  })
  it('rolls back invalid legacy values and protects custom database objects', () => {
    const db = legacy()
    try {
      db.exec("UPDATE provider_settings SET monthly_fee_jpy=-1 WHERE provider='claude'")
      expect(() => migrateDefaultCharges(db)).toThrow()
      expect(requiresDefaultChargeMigration(db)).toBe(true)
      expect(
        db.prepare("SELECT monthly_fee_jpy FROM provider_settings WHERE provider='claude'").get(),
      ).toEqual({ monthly_fee_jpy: -1 })
      db.exec('CREATE INDEX custom_charge ON provider_settings(contract_started_on)')
      expect(() => migrateDefaultCharges(db)).toThrow('独自index・trigger')
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='custom_charge'").get(),
      ).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
