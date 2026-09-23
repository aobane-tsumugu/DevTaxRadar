import type { DatabaseSync } from 'node:sqlite'
import type { DecisionRecord } from '../planning/types.js'
import {
  validateTreatmentDecisionBinding,
  type TreatmentDecisionBinding,
} from '../core/treatmentDecisionBinding.js'
import type { SoftwareAnnualDecisionBinding } from '../core/softwareAnnualDecision.js'
const key = 'planning_decision_treatment_bindings_v1'
export function readDecisionTreatmentBindings(
  db: DatabaseSync,
): Map<string, TreatmentDecisionBinding> {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as
    { value: string } | undefined
  if (!row) return new Map()
  const parsed: unknown = JSON.parse(row.value)
  if (!Array.isArray(parsed)) throw new Error('判断候補の対応記録を確認できません。')
  const result = new Map<string, TreatmentDecisionBinding>()
  for (const entry of parsed) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !entry[0].trim() ||
      entry[0].length > 120 ||
      result.has(entry[0])
    )
      throw new Error('判断候補の対応IDを確認できません。')
    validateTreatmentDecisionBinding(entry[1])
    result.set(entry[0], entry[1])
  }
  return result
}
/** Caller owns the existing planning savepoint. Old clients cannot drop a retained decision's provenance. */
export function writeDecisionTreatmentBindings(db: DatabaseSync, records: DecisionRecord[]): void {
  const previous = readDecisionTreatmentBindings(db)
  const ids = new Set<string>()
  for (const record of records) {
    if (
      typeof record.id !== 'string' ||
      !record.id.trim() ||
      record.id.length > 120 ||
      ids.has(record.id)
    )
      throw new Error('判断候補の対応IDが不正または重複しています。')
    ids.add(record.id)
    if (previous.has(record.id) && record.treatmentBinding === undefined)
      throw new Error(
        '判断候補の確認元を含む最新の入力を読み直してください。対応元だけを省略できません。',
      )
    if (record.treatmentBinding !== undefined)
      validateTreatmentDecisionBinding(record.treatmentBinding)
  }
  const next = records
    .filter((row) => row.treatmentBinding)
    .map((row) => [row.id, row.treatmentBinding])
  if (!next.length) db.prepare('DELETE FROM app_settings WHERE key=?').run(key)
  else
    db.prepare(
      'INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(key, JSON.stringify(next))
}

const softwareAnnualKey = 'planning_decision_software_annual_bindings_v1'
/** The planning schema validates each binding against its decision when the snapshot is read. */
export function readDecisionSoftwareAnnualBindings(
  db: DatabaseSync,
): Map<string, SoftwareAnnualDecisionBinding> {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(softwareAnnualKey) as
    { value: string } | undefined
  if (!row) return new Map()
  const parsed: unknown = JSON.parse(row.value)
  if (!Array.isArray(parsed)) throw new Error('ソフトウェア年額の判断元を確認できません。')
  const result = new Map<string, SoftwareAnnualDecisionBinding>()
  for (const entry of parsed) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !entry[0].trim() ||
      entry[0].length > 120 ||
      result.has(entry[0]) ||
      !entry[1] ||
      typeof entry[1] !== 'object' ||
      Array.isArray(entry[1])
    )
      throw new Error('ソフトウェア年額の判断元IDを確認できません。')
    result.set(entry[0], entry[1] as SoftwareAnnualDecisionBinding)
  }
  return result
}
/** Caller owns the existing planning savepoint; ids were checked by writeDecisionTreatmentBindings. */
export function writeDecisionSoftwareAnnualBindings(
  db: DatabaseSync,
  records: DecisionRecord[],
): void {
  const previous = readDecisionSoftwareAnnualBindings(db)
  if (records.some((row) => previous.has(row.id) && row.softwareAnnualBinding === undefined))
    throw new Error(
      'ソフトウェア年額の判断元を含む最新の入力を読み直してください。判断元だけを省略できません。',
    )
  const next = records
    .filter((row) => row.softwareAnnualBinding)
    .map((row) => [row.id, row.softwareAnnualBinding])
  if (!next.length) db.prepare('DELETE FROM app_settings WHERE key=?').run(softwareAnnualKey)
  else
    db.prepare(
      'INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(softwareAnnualKey, JSON.stringify(next))
}
