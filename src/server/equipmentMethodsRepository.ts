import type { DatabaseSync } from 'node:sqlite'
import { equipmentMethodsSchema, type EquipmentAnnualMethod } from '../planning/equipmentMethods.js'
export function initializeEquipmentMethodsSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS planning_equipment_methods (
    id TEXT PRIMARY KEY, equipment_id TEXT NOT NULL REFERENCES planning_equipment(id),
    tax_year INTEGER NOT NULL CHECK(tax_year BETWEEN 2007 AND 2100),
    record_json TEXT NOT NULL CHECK(json_valid(record_json)), UNIQUE(equipment_id,tax_year)
  ) STRICT`)
}
export function readEquipmentMethods(db: DatabaseSync): EquipmentAnnualMethod[] {
  const rows = db
    .prepare('SELECT * FROM planning_equipment_methods ORDER BY tax_year,equipment_id')
    .all()
  return equipmentMethodsSchema.parse(
    rows.map((row) => {
      const parsed = JSON.parse(String(row.record_json))
      if (
        parsed.id !== row.id ||
        parsed.equipmentId !== row.equipment_id ||
        parsed.taxYear !== row.tax_year
      )
        throw new Error('設備計算条件の索引と保存内容が一致しません。')
      return parsed
    }),
  )
}
/** Called after equipment rows are inserted, within the planning savepoint. */
export function writeEquipmentMethods(db: DatabaseSync, records: EquipmentAnnualMethod[]) {
  const insert = db.prepare(
    'INSERT INTO planning_equipment_methods(id,equipment_id,tax_year,record_json) VALUES (?,?,?,?)',
  )
  for (const row of equipmentMethodsSchema.parse(records))
    insert.run(row.id, row.equipmentId, row.taxYear, JSON.stringify(row))
}
