import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import {
  readDecisionTreatmentBindings,
  writeDecisionTreatmentBindings,
} from '../../src/server/decisionTreatmentBindingsRepository.js'
import { draftTreatmentDecision } from '../../src/core/costTreatmentDraft.js'
import { fixture, addFacts } from '../core/helpers/treatmentFixtures.js'
function check(
  action: (db: DatabaseSync, decision: ReturnType<typeof draftTreatmentDecision>) => void,
) {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
    const f = fixture()
    addFacts(f)
    action(
      db,
      draftTreatmentDecision(f.costs, f.planning, 'part', 'decision', '2026-09-18T00:00:00Z'),
    )
  } finally {
    db.close()
  }
}
describe('decision provenance within the existing SQLite savepoint', () => {
  it('roundtrips exact source binding and deletes only by an explicit decision deletion', () =>
    check((db, d) => {
      assert.equal(readDecisionTreatmentBindings(db).size, 0)
      writeDecisionTreatmentBindings(db, [d])
      assert.deepEqual(readDecisionTreatmentBindings(db).get(d.id), d.treatmentBinding)
      writeDecisionTreatmentBindings(db, [])
      assert.equal(readDecisionTreatmentBindings(db).size, 0)
    }))
  it('refuses old clients silently dropping a retained binding', () =>
    check((db, d) => {
      writeDecisionTreatmentBindings(db, [d])
      const { treatmentBinding: _old, ...oldClient } = d
      assert.throws(() => writeDecisionTreatmentBindings(db, [oldClient]), /省略/)
      assert.deepEqual(readDecisionTreatmentBindings(db).get(d.id), d.treatmentBinding)
    }))
  it('rolls back with the owning planning transaction', () =>
    check((db, d) => {
      db.exec('SAVEPOINT planning')
      writeDecisionTreatmentBindings(db, [d])
      db.exec('ROLLBACK TO planning; RELEASE planning')
      assert.equal(readDecisionTreatmentBindings(db).size, 0)
    }))
  it('rejects corrupted stored structures instead of deleting or repairing them', () =>
    check((db, d) => {
      writeDecisionTreatmentBindings(db, [d])
      db.prepare('UPDATE app_settings SET value=?').run('{"not":"entries"}')
      assert.throws(() => readDecisionTreatmentBindings(db))
      assert.equal(db.prepare('SELECT value FROM app_settings').get()!.value, '{"not":"entries"}')
    }))
  it('rejects duplicate decision inputs before writing the existing state', () =>
    check((db, d) => {
      writeDecisionTreatmentBindings(db, [d])
      const before = db.prepare('SELECT value FROM app_settings').get()!.value
      assert.throws(() => writeDecisionTreatmentBindings(db, [d, { ...d }]), /重複/)
      assert.equal(db.prepare('SELECT value FROM app_settings').get()!.value, before)
    }))
  it('rejects duplicate stored binding IDs', () =>
    check((db, d) => {
      writeDecisionTreatmentBindings(db, [d])
      db.prepare('UPDATE app_settings SET value=?').run(
        JSON.stringify([
          [d.id, d.treatmentBinding],
          [d.id, d.treatmentBinding],
        ]),
      )
      assert.throws(() => readDecisionTreatmentBindings(db))
    }))
})
