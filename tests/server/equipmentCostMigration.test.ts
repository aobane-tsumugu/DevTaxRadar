import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import {
  migrateEquipmentCosts,
  requiresEquipmentCostMigration,
} from '../../src/server/equipmentCostMigration.js'

function legacy() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE planning_tax_units(id TEXT PRIMARY KEY);
    INSERT INTO planning_tax_units VALUES ('unit');
    CREATE TABLE planning_equipment(id TEXT PRIMARY KEY,name TEXT NOT NULL,equipment_type TEXT NOT NULL,
      acquisition_cost_jpy INTEGER NOT NULL,ordered_on TEXT,delivered_on TEXT,acquired_on TEXT NOT NULL,
      business_use_started_on TEXT,converted_from_private INTEGER NOT NULL,opening_unamortized_balance_jpy INTEGER,
      business_use_ratio REAL NOT NULL,useful_life_years INTEGER,role TEXT NOT NULL,
      tax_unit_id TEXT REFERENCES planning_tax_units(id),project_allocation_ratio REAL NOT NULL,evidence_ids_json TEXT NOT NULL) STRICT;
    INSERT INTO planning_equipment VALUES ('pc','合成PC','pc',240000,'2025-12-28','2026-01-01','2026-01-01',
      '2026-02-01',1,120000,0.8,4,'開発','unit',0.6,'["e"]');
    INSERT INTO planning_equipment VALUES ('desk','合成机','desk',0,NULL,NULL,'2026-01-02',NULL,0,NULL,0.5,NULL,'作業机',NULL,0,'[]');`)
  return db
}
describe('equipment purchase amount migration', () => {
  it('retains acquisition, private conversion and evidence facts while separating unknown from confirmed zero', () => {
    const db = legacy()
    try {
      const before = db.prepare('SELECT rowid,* FROM planning_equipment ORDER BY rowid').all()
      migrateEquipmentCosts(db)
      expect(requiresEquipmentCostMigration(db)).toBe(false)
      expect(
        db
          .prepare('SELECT rowid,* FROM planning_equipment ORDER BY rowid')
          .all()
          .map(({ unknown_amount_reason: _reason, ...row }) => row),
      ).toEqual(before)
      db.exec(
        "UPDATE planning_equipment SET acquisition_cost_jpy=NULL,unknown_amount_reason='領収書の確認待ち' WHERE id='pc'",
      )
      migrateEquipmentCosts(db)
      expect(
        db
          .prepare(
            "SELECT acquisition_cost_jpy,unknown_amount_reason FROM planning_equipment WHERE id='pc'",
          )
          .get(),
      ).toEqual({ acquisition_cost_jpy: null, unknown_amount_reason: '領収書の確認待ち' })
      expect(() =>
        db.exec("UPDATE planning_equipment SET acquisition_cost_jpy=0 WHERE id='pc'"),
      ).toThrow()
      db.exec(
        "UPDATE planning_equipment SET acquisition_cost_jpy=0,unknown_amount_reason=NULL WHERE id='pc'",
      )
      expect(() =>
        db.exec("UPDATE planning_equipment SET tax_unit_id='missing' WHERE id='pc'"),
      ).toThrow()
    } finally {
      db.close()
    }
  })
  it('rolls back failed legacy copying and does not discard a custom index', () => {
    const db = legacy()
    try {
      db.exec("UPDATE planning_equipment SET acquisition_cost_jpy=-1 WHERE id='pc'")
      expect(() => migrateEquipmentCosts(db)).toThrow()
      expect(requiresEquipmentCostMigration(db)).toBe(true)
      expect(
        db.prepare("SELECT acquisition_cost_jpy FROM planning_equipment WHERE id='pc'").get(),
      ).toEqual({ acquisition_cost_jpy: -1 })
      db.exec('CREATE INDEX custom_equipment ON planning_equipment(name)')
      expect(() => migrateEquipmentCosts(db)).toThrow('独自index・trigger')
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='custom_equipment'").get(),
      ).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
