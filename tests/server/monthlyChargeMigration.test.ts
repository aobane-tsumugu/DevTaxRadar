import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import {
  migrateMonthlyCharges,
  requiresMonthlyChargeMigration,
} from '../../src/server/monthlyChargeMigration.js'

function legacy() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE provider_month_charges(provider TEXT NOT NULL, month TEXT NOT NULL, amount_jpy INTEGER NOT NULL, PRIMARY KEY(provider,month)) STRICT;
    INSERT INTO provider_month_charges VALUES ('claude','2026-01',6200);
    INSERT INTO provider_month_charges VALUES ('codex','2026-01',0);`)
  return db
}
describe('monthly AI charge amount migration', () => {
  it('preserves provider-month keys and zero values and persists unknown reasons', () => {
    const db = legacy()
    try {
      const before = db.prepare('SELECT rowid,* FROM provider_month_charges ORDER BY rowid').all()
      migrateMonthlyCharges(db)
      expect(requiresMonthlyChargeMigration(db)).toBe(false)
      expect(
        db
          .prepare('SELECT rowid,* FROM provider_month_charges ORDER BY rowid')
          .all()
          .map(({ unknown_amount_reason: _reason, ...row }) => row),
      ).toEqual(before)
      expect(() =>
        db.exec("UPDATE provider_month_charges SET amount_jpy=NULL WHERE provider='claude'"),
      ).toThrow()
      db.exec(
        "UPDATE provider_month_charges SET amount_jpy=NULL,unknown_amount_reason='請求確認待ち' WHERE provider='claude'",
      )
      migrateMonthlyCharges(db)
      expect(
        db
          .prepare(
            "SELECT amount_jpy,unknown_amount_reason FROM provider_month_charges WHERE provider='claude'",
          )
          .get(),
      ).toEqual({ amount_jpy: null, unknown_amount_reason: '請求確認待ち' })
      expect(() =>
        db.exec("UPDATE provider_month_charges SET amount_jpy=0 WHERE provider='claude'"),
      ).toThrow()
      db.exec(
        "UPDATE provider_month_charges SET amount_jpy=0,unknown_amount_reason=NULL WHERE provider='claude'",
      )
    } finally {
      db.close()
    }
  })
  it('rolls back invalid legacy values and protects custom database objects', () => {
    const db = legacy()
    try {
      db.exec("UPDATE provider_month_charges SET amount_jpy=-1 WHERE provider='claude'")
      expect(() => migrateMonthlyCharges(db)).toThrow()
      expect(requiresMonthlyChargeMigration(db)).toBe(true)
      expect(
        db.prepare("SELECT amount_jpy FROM provider_month_charges WHERE provider='claude'").get(),
      ).toEqual({ amount_jpy: -1 })
      db.exec('CREATE INDEX custom_charge ON provider_month_charges(month)')
      expect(() => migrateMonthlyCharges(db)).toThrow('独自index・trigger')
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='custom_charge'").get(),
      ).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
