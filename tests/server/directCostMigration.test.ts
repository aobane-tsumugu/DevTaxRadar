import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import {
  migrateDirectCosts,
  requiresDirectCostMigration,
} from '../../src/server/directCostMigration.js'

function legacy() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE planning_tax_units(id TEXT PRIMARY KEY);
    INSERT INTO planning_tax_units VALUES ('unit');
    CREATE TABLE planning_direct_costs(id TEXT PRIMARY KEY,tax_unit_id TEXT REFERENCES planning_tax_units(id),
      incurred_on TEXT NOT NULL,cost_type TEXT NOT NULL,amount_jpy INTEGER NOT NULL,
      directly_attributable INTEGER NOT NULL,treatment TEXT NOT NULL,note TEXT,evidence_ids_json TEXT NOT NULL) STRICT;
    INSERT INTO planning_direct_costs VALUES ('later','unit','2026-01-01','domain',2000,1,'direct','根拠','["e"]');
    INSERT INTO planning_direct_costs VALUES ('first',NULL,'2026-01-02','cloud',0,0,'general',NULL,'[]');`)
  return db
}

describe('direct cost amount migration', () => {
  it('adds targets to a nullable generation without changing its records', () => {
    const db = legacy()
    try {
      migrateDirectCosts(db)
      db.exec('ALTER TABLE planning_direct_costs DROP COLUMN targets_json')
      db.exec(
        "UPDATE planning_direct_costs SET amount_jpy=NULL, unknown_amount_reason='未確認' WHERE id='later'",
      )
      const before = db.prepare('SELECT rowid,* FROM planning_direct_costs ORDER BY rowid').all()
      expect(requiresDirectCostMigration(db)).toBe(true)
      migrateDirectCosts(db)
      const after = db.prepare('SELECT rowid,* FROM planning_direct_costs ORDER BY rowid').all()
      expect(
        after.map(({ targets_json, ...row }) => {
          expect(targets_json).toBeNull()
          return row
        }),
      ).toEqual(before)
      migrateDirectCosts(db)
      expect(requiresDirectCostMigration(db)).toBe(false)
    } finally {
      db.close()
    }
  })
  it('preserves values, row order and foreign keys, accepts unknown with reason and confirmed zero, and is repeatable', () => {
    const db = legacy()
    try {
      const before = db.prepare('SELECT rowid,* FROM planning_direct_costs ORDER BY rowid').all()
      migrateDirectCosts(db)
      expect(requiresDirectCostMigration(db)).toBe(false)
      expect(
        db
          .prepare(
            'SELECT rowid,id,tax_unit_id,incurred_on,cost_type,amount_jpy,directly_attributable,treatment,note,evidence_ids_json FROM planning_direct_costs ORDER BY rowid',
          )
          .all(),
      ).toEqual(before)
      db.exec(
        "UPDATE planning_direct_costs SET amount_jpy=NULL, unknown_amount_reason='請求額の確認待ち' WHERE id='later'",
      )
      migrateDirectCosts(db)
      expect(
        db
          .prepare(
            "SELECT amount_jpy,unknown_amount_reason FROM planning_direct_costs WHERE id='later'",
          )
          .get(),
      ).toEqual({ amount_jpy: null, unknown_amount_reason: '請求額の確認待ち' })
      expect(() =>
        db.exec("UPDATE planning_direct_costs SET unknown_amount_reason=NULL WHERE id='later'"),
      ).toThrow()
      expect(() =>
        db.exec("UPDATE planning_direct_costs SET amount_jpy=0 WHERE id='later'"),
      ).toThrow()
      db.exec(
        "UPDATE planning_direct_costs SET amount_jpy=0, unknown_amount_reason=NULL WHERE id='later'",
      )
      expect(() =>
        db.exec("UPDATE planning_direct_costs SET tax_unit_id='missing' WHERE id='later'"),
      ).toThrow()
    } finally {
      db.close()
    }
  })
  it('rolls back a failed copy without deleting legacy records or leaving a partial table', () => {
    const db = legacy()
    try {
      db.exec("UPDATE planning_direct_costs SET amount_jpy=-1 WHERE id='later'")
      expect(() => migrateDirectCosts(db)).toThrow()
      expect(requiresDirectCostMigration(db)).toBe(true)
      expect(
        db.prepare("SELECT amount_jpy FROM planning_direct_costs WHERE id='later'").get(),
      ).toEqual({ amount_jpy: -1 })
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE name='planning_direct_costs_legacy'")
          .get(),
      ).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
