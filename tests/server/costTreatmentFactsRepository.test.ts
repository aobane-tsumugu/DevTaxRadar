import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { readCostTreatmentFacts, writeCostTreatmentFacts } from '../../src/server/costTreatmentFactsRepository.js'
import { fixture, addFacts } from '../core/helpers/treatmentFixtures.js'

function withDatabase(action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
    action(db)
  } finally { db.close() }
}
const fact = () => addFacts(fixture())

describe('processing facts in the existing workspace database boundary', () => {
  it('returns an empty list without writing defaults', () => withDatabase((db) => {
    assert.deepEqual(readCostTreatmentFacts(db), [])
    assert.deepEqual(db.prepare('SELECT * FROM app_settings').all(), [])
  }))
  it('roundtrips every field without mutating the caller input', () => withDatabase((db) => {
    const input = [fact()]
    const before = structuredClone(input)
    writeCostTreatmentFacts(db, input)
    assert.deepEqual(readCostTreatmentFacts(db), before)
    assert.deepEqual(input, before)
    input[0]!.evidenceIds.push('not-saved')
    assert.deepEqual(readCostTreatmentFacts(db), before)
  }))
  it('participates in the caller savepoint and rolls back a later write failure', () => withDatabase((db) => {
    const old = [fact()]
    writeCostTreatmentFacts(db, old)
    db.exec('SAVEPOINT devtax_planning_write')
    try {
      writeCostTreatmentFacts(db, [{ ...old[0]!, reason: 'would be rolled back' }])
      db.exec('INSERT INTO table_that_does_not_exist VALUES (1)')
      assert.fail('must fail')
    } catch { db.exec('ROLLBACK TO devtax_planning_write; RELEASE devtax_planning_write') }
    assert.deepEqual(readCostTreatmentFacts(db), old)
  }))
  it('preserves an enclosing transaction when the planning savepoint is rolled back', () => withDatabase((db) => {
    db.exec("BEGIN; INSERT INTO app_settings VALUES ('other','keep'); SAVEPOINT devtax_planning_write")
    writeCostTreatmentFacts(db, [fact()])
    db.exec('ROLLBACK TO devtax_planning_write; RELEASE devtax_planning_write; COMMIT')
    assert.deepEqual(readCostTreatmentFacts(db), [])
    assert.equal(db.prepare("SELECT value FROM app_settings WHERE key='other'").get()?.value, 'keep')
  }))
  it('rejects omitted nonempty facts rather than letting an old writer erase them', () => withDatabase((db) => {
    const saved = [fact()]
    writeCostTreatmentFacts(db, saved)
    assert.throws(() => writeCostTreatmentFacts(db, undefined), /最新の計画/)
    assert.deepEqual(readCostTreatmentFacts(db), saved)
  }))
  it('accepts omission for a legacy database with no facts', () => withDatabase((db) => {
    writeCostTreatmentFacts(db, undefined)
    assert.deepEqual(db.prepare('SELECT * FROM app_settings').all(), [])
  }))
  it('treats an explicit empty list as deletion and keeps unrelated settings', () => withDatabase((db) => {
    db.prepare('INSERT INTO app_settings VALUES (?,?)').run('other', 'preserved')
    writeCostTreatmentFacts(db, [fact()])
    writeCostTreatmentFacts(db, [])
    assert.deepEqual(readCostTreatmentFacts(db), [])
    assert.equal(db.prepare("SELECT value FROM app_settings WHERE key='other'").get()?.value, 'preserved')
  }))
  it('rejects invalid new input without changing the current saved value', () => withDatabase((db) => {
    const saved = [fact()]
    writeCostTreatmentFacts(db, saved)
    assert.throws(() => writeCostTreatmentFacts(db, [{ ...saved[0]!, costYear: 1 }]))
    assert.deepEqual(readCostTreatmentFacts(db), saved)
  }))
  it('rejects corrupted saved JSON rather than silently falling back to no facts', () => withDatabase((db) => {
    writeCostTreatmentFacts(db, [fact()])
    db.exec("UPDATE app_settings SET value='broken'")
    assert.throws(() => readCostTreatmentFacts(db))
    assert.equal(db.prepare('SELECT value FROM app_settings').get()?.value, 'broken')
  }))
  it('rejects unsupported saved fields without silently stripping them', () => withDatabase((db) => {
    writeCostTreatmentFacts(db, [fact()])
    db.prepare('UPDATE app_settings SET value=?').run(JSON.stringify([{ ...fact(), unknown: true }]))
    assert.throws(() => readCostTreatmentFacts(db), /形式/)
  }))
  it('persists across closing and reopening an actual SQLite file', () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-treatment-records-'))
    try {
      const file = join(root, 'fixture.db')
      const db = new DatabaseSync(file)
      const saved = [fact()]
      try {
        db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
        writeCostTreatmentFacts(db, saved)
      } finally { db.close() }
      const reopened = new DatabaseSync(file, { readOnly: true })
      try { assert.deepEqual(readCostTreatmentFacts(reopened), saved) } finally { reopened.close() }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
