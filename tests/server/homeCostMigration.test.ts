import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import { migrateHomeCosts, requiresHomeCostMigration } from '../../src/server/homeCostMigration.js'

function legacy() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE planning_tax_units(id TEXT PRIMARY KEY);
    INSERT INTO planning_tax_units VALUES ('unit');
    CREATE TABLE planning_home_costs(id TEXT PRIMARY KEY,month TEXT NOT NULL,category TEXT NOT NULL,
      amount_jpy INTEGER NOT NULL,method TEXT NOT NULL,business_use_ratio REAL NOT NULL,basis TEXT NOT NULL,
      rationale TEXT NOT NULL,tax_unit_id TEXT REFERENCES planning_tax_units(id),project_allocation_ratio REAL NOT NULL,
      treatment TEXT NOT NULL,evidence_ids_json TEXT NOT NULL) STRICT;
    INSERT INTO planning_home_costs VALUES ('rent','2026-07','rent',4000,'area-time',0.5,'面積と時間','毎月継続','unit',0.6,'shared','["e"]');
    INSERT INTO planning_home_costs VALUES ('net','2026-06','internet',0,'usage-time',1,'利用記録','確認済み',NULL,0,'general','[]');`)
  return db
}
describe('home cost amount migration', () => {
  it('adds targets to the nullable-amount generation without changing existing records', () => {
    const db = legacy()
    try {
      migrateHomeCosts(db)
      db.exec('ALTER TABLE planning_home_costs DROP COLUMN targets_json')
      const before = db.prepare('SELECT * FROM planning_home_costs ORDER BY rowid').all()
      expect(requiresHomeCostMigration(db)).toBe(true)
      migrateHomeCosts(db)
      expect(
        db
          .prepare('SELECT * FROM planning_home_costs ORDER BY rowid')
          .all()
          .map(({ targets_json: _targets, ...row }) => row),
      ).toEqual(before)
      db.prepare('UPDATE planning_home_costs SET targets_json=? WHERE id=?').run(
        JSON.stringify([{ taxUnitId: 'unit', shareBps: null }]),
        'rent',
      )
      migrateHomeCosts(db)
      expect(
        db.prepare("SELECT targets_json FROM planning_home_costs WHERE id='rent'").get()
          ?.targets_json,
      ).toBe('[{"taxUnitId":"unit","shareBps":null}]')
    } finally {
      db.close()
    }
  })

  it('retains every fact and row order while separating unknown from confirmed zero', () => {
    const db = legacy()
    try {
      const before = db.prepare('SELECT rowid,* FROM planning_home_costs ORDER BY rowid').all()
      migrateHomeCosts(db)
      expect(requiresHomeCostMigration(db)).toBe(false)
      const after = db
        .prepare('SELECT rowid,* FROM planning_home_costs ORDER BY rowid')
        .all()
        .map(({ unknown_amount_reason: _unknownReason, targets_json: _targets, ...row }) => row)
      expect(after).toEqual(before)
      db.exec(
        "UPDATE planning_home_costs SET amount_jpy=NULL,unknown_amount_reason='支払額の確認中' WHERE id='rent'",
      )
      migrateHomeCosts(db)
      expect(
        db
          .prepare(
            "SELECT amount_jpy,unknown_amount_reason,business_use_ratio FROM planning_home_costs WHERE id='rent'",
          )
          .get(),
      ).toEqual({
        amount_jpy: null,
        unknown_amount_reason: '支払額の確認中',
        business_use_ratio: 0.5,
      })
      expect(() => db.exec("UPDATE planning_home_costs SET amount_jpy=0 WHERE id='rent'")).toThrow()
      db.exec(
        "UPDATE planning_home_costs SET amount_jpy=0,unknown_amount_reason=NULL WHERE id='rent'",
      )
      expect(() =>
        db.exec("UPDATE planning_home_costs SET tax_unit_id='missing' WHERE id='rent'"),
      ).toThrow()
    } finally {
      db.close()
    }
  })
  it('restores the legacy table on invalid legacy data and preserves custom triggers', () => {
    const db = legacy()
    try {
      db.exec("UPDATE planning_home_costs SET amount_jpy=-1 WHERE id='rent'")
      expect(() => migrateHomeCosts(db)).toThrow()
      expect(requiresHomeCostMigration(db)).toBe(true)
      expect(
        db.prepare("SELECT amount_jpy FROM planning_home_costs WHERE id='rent'").get(),
      ).toEqual({ amount_jpy: -1 })
      db.exec(
        'CREATE TRIGGER preserve_custom BEFORE DELETE ON planning_home_costs BEGIN SELECT 1; END',
      )
      expect(() => migrateHomeCosts(db)).toThrow('独自index・trigger')
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='preserve_custom'").get(),
      ).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
