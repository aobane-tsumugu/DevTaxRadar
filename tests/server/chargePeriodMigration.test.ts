import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import {
  migrateChargePeriods,
  requiresChargePeriodMigration,
} from '../../src/server/chargePeriodMigration.js'

function legacy() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE provider_charge_periods(id TEXT PRIMARY KEY, provider TEXT NOT NULL,
    plan_name TEXT NOT NULL,service_started_on TEXT NOT NULL,service_ended_on TEXT NOT NULL,
    billed_on TEXT,amount_jpy INTEGER NOT NULL,note TEXT) STRICT;
    INSERT INTO provider_charge_periods VALUES ('paid','claude','合成契約','2025-12-01','2026-01-31','2025-12-01',6200,'年跨ぎ');
    INSERT INTO provider_charge_periods VALUES ('zero','codex','合成無料','2026-01-01','2026-01-31',NULL,0,NULL);`)
  return db
}
describe('dated AI charge amount migration', () => {
  it('preserves dates, plan, notes and existing zero values and persists unknown reasons', () => {
    const db = legacy()
    try {
      const before = db.prepare('SELECT rowid,* FROM provider_charge_periods ORDER BY rowid').all()
      migrateChargePeriods(db)
      expect(requiresChargePeriodMigration(db)).toBe(false)
      expect(
        db
          .prepare('SELECT rowid,* FROM provider_charge_periods ORDER BY rowid')
          .all()
          .map(({ unknown_amount_reason: _reason, ...row }) => row),
      ).toEqual(before)
      expect(() =>
        db.exec("UPDATE provider_charge_periods SET amount_jpy=NULL WHERE id='paid'"),
      ).toThrow()
      db.exec(
        "UPDATE provider_charge_periods SET amount_jpy=NULL,unknown_amount_reason='請求確認待ち' WHERE id='paid'",
      )
      migrateChargePeriods(db)
      expect(
        db
          .prepare(
            "SELECT amount_jpy,unknown_amount_reason FROM provider_charge_periods WHERE id='paid'",
          )
          .get(),
      ).toEqual({ amount_jpy: null, unknown_amount_reason: '請求確認待ち' })
      expect(() =>
        db.exec("UPDATE provider_charge_periods SET amount_jpy=0 WHERE id='paid'"),
      ).toThrow()
      db.exec(
        "UPDATE provider_charge_periods SET amount_jpy=0,unknown_amount_reason=NULL WHERE id='paid'",
      )
    } finally {
      db.close()
    }
  })
  it('rolls back invalid legacy values and protects custom database objects', () => {
    const db = legacy()
    try {
      db.exec("UPDATE provider_charge_periods SET amount_jpy=-1 WHERE id='paid'")
      expect(() => migrateChargePeriods(db)).toThrow()
      expect(requiresChargePeriodMigration(db)).toBe(true)
      expect(
        db.prepare("SELECT amount_jpy FROM provider_charge_periods WHERE id='paid'").get(),
      ).toEqual({ amount_jpy: -1 })
      db.exec('CREATE INDEX custom_charge ON provider_charge_periods(plan_name)')
      expect(() => migrateChargePeriods(db)).toThrow('独自index・trigger')
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='custom_charge'").get(),
      ).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
