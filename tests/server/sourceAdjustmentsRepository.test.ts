import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readSourceAdjustments, writeSourceAdjustments } from '../../src/server/sourceAdjustmentsRepository.js'
import type { SourceAdjustmentRecord } from '../../src/core/sourceAdjustments.js'

function entry(): SourceAdjustmentRecord {
  return { id: 'refund', sourceId: 'direct:invoice', sourceYear: 2026,
    sourceBasis: { kind: 'direct', originalAmountJpy: 10000 }, kind: 'refund', amountJpy: -1000,
    occurredOn: '2026-05-06', recordedAt: '2026-05-07T10:00:00+09:00', effect: 'undetermined',
    reason: '返金の事実だけを保存。税務上の対象年は未判断。', evidenceIds: ['credit-note'] }
}
function database(path = ':memory:') {
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  return db
}

describe('source adjustment persistence', () => {
  it('keeps old workspaces readable without a migration or new table', () => {
    const db = database()
    try {
      assert.deepEqual(readSourceAdjustments(db), [])
      writeSourceAdjustments(db, undefined)
      assert.equal(db.prepare('SELECT count(*) AS count FROM app_settings').get()!.count, 0)
    } finally { db.close() }
  })
  it('round-trips dates, unknowns, source basis and conversion evidence exactly', () => {
    const db = database()
    try {
      const row = entry()
      row.amountJpy = -200
      row.conversion = { currency: 'USD', foreignAmount: '2', jpyPerUnit: '100', rounding: 'nearest-yen', convertedOn: '2026-05-06', reference: '合成換算資料' }
      writeSourceAdjustments(db, [row])
      assert.deepEqual(readSourceAdjustments(db), [row])
      const copy = readSourceAdjustments(db)
      copy[0]!.reason = '別の値'
      assert.deepEqual(readSourceAdjustments(db), [row])
      row.sourceBasis.originalAmountJpy = null
      writeSourceAdjustments(db, [row])
      assert.equal(readSourceAdjustments(db)[0]!.sourceBasis.originalAmountJpy, null)
    } finally { db.close() }
  })
  it('does not discard records when an older client omits the new collection', () => {
    const db = database()
    try {
      writeSourceAdjustments(db, [entry()])
      assert.throws(() => writeSourceAdjustments(db, undefined), /最新の計画/)
      assert.deepEqual(readSourceAdjustments(db), [entry()])
      writeSourceAdjustments(db, [])
      assert.deepEqual(readSourceAdjustments(db), [])
    } finally { db.close() }
  })
  it('rolls back source adjustments with a later failure in the owning workspace savepoint', () => {
    const db = database()
    try {
      writeSourceAdjustments(db, [entry()])
      db.exec('CREATE TABLE profiles(id INTEGER PRIMARY KEY, value TEXT NOT NULL); SAVEPOINT workspace')
      assert.throws(() => {
        writeSourceAdjustments(db, [{ ...entry(), amountJpy: -3000 }])
        db.prepare('INSERT INTO profiles(id,value) VALUES (1,?)').run(null)
      })
      db.exec('ROLLBACK TO workspace; RELEASE workspace')
      assert.deepEqual(readSourceAdjustments(db), [entry()])
      assert.equal(db.prepare('SELECT count(*) AS count FROM profiles').get()!.count, 0)
    } finally { db.close() }
  })
  it('does not modify unrelated settings or accept invalid imported records', () => {
    const db = database()
    try {
      db.prepare('INSERT INTO app_settings VALUES (?,?)').run('identifier_salt', 'keep-me')
      writeSourceAdjustments(db, [entry()])
      assert.throws(() => writeSourceAdjustments(db, [{ ...entry(), amountJpy: NaN }]))
      assert.deepEqual(readSourceAdjustments(db), [entry()])
      writeSourceAdjustments(db, [])
      assert.equal(db.prepare('SELECT value FROM app_settings WHERE key=?').get('identifier_salt')!.value, 'keep-me')
    } finally { db.close() }
  })
  for (const malformed of ['not-json', '{}', '[{"id":"broken"}]'])
    it(`retains corrupted source data without pretending it is empty: ${malformed}`, () => {
      const db = database()
      try {
        db.prepare('INSERT INTO app_settings VALUES (?,?)').run('planning_source_adjustments_v1', malformed)
        assert.throws(() => readSourceAdjustments(db))
        assert.equal(db.prepare('SELECT value FROM app_settings WHERE key=?').get('planning_source_adjustments_v1')!.value, malformed)
      } finally { db.close() }
    })
  it('remains readable after restart and a separate-file database copy with no original receipts', () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-adjustments-'))
    const originalPath = join(root, 'original.sqlite')
    const restoredPath = join(root, 'restored.sqlite')
    try {
      const original = database(originalPath)
      writeSourceAdjustments(original, [entry()]); original.close()
      copyFileSync(originalPath, restoredPath)
      const restored = new DatabaseSync(restoredPath, { readOnly: true })
      try {
        assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
        assert.deepEqual(readSourceAdjustments(restored), [entry()])
      } finally { restored.close() }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
