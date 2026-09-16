import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { mergeWorkspaceDrafts } from '../../src/core/workspaceMerge.js'
import { isNewWorkspace, workspaceChangeKind } from '../../src/core/workspaceChange.js'
import { sourceAdjustmentBasis, validateSourceAdjustments, type SourceAdjustmentRecord } from '../../src/core/sourceAdjustments.js'
import { readSourceAdjustments, writeSourceAdjustments } from '../../src/server/sourceAdjustmentsRepository.js'

const adjustment = (id = 'r'): SourceAdjustmentRecord => ({
  id, sourceId: 'direct:cost', sourceYear: 2026,
  sourceBasis: { kind: 'direct', originalAmountJpy: 2000, incurredOn: '2026-07-01' },
  kind: 'refund', amountJpy: -1000, occurredOn: '2026-08-01', recordedAt: '2026-08-01T00:00:00Z',
  effect: 'undetermined', reason: '請求に対応する返金。処理は未判断。', evidenceIds: ['receipt'],
})
const workspace = () => ({
  planning: emptyPlanningSnapshot(2026),
  configuration: {
    charges: { claude: 0, codex: 0 }, monthlyCharges: [], chargePeriods: [],
    contracts: { claude: {}, codex: {} }, unobservedRatio: null,
  },
})

describe('adjustments in the existing planning save boundary', () => {
  it('retains the exact date in the basis without mutating the receipt', () => {
    const source = { kind: 'direct' as const, originalAmountJpy: 2000, incurredOn: '2026-07-01' }
    assert.deepEqual(sourceAdjustmentBasis(source), source)
    assert.deepEqual(source, { kind: 'direct', originalAmountJpy: 2000, incurredOn: '2026-07-01' })
  })
  for (const field of ['kind', 'effect'] as const) it(`rejects array coercion for ${field}`, () => {
    const row = adjustment()
    assert.throws(() => validateSourceAdjustments([{ ...row, [field]: [row[field]] }]))
  })
  it('rejects duplicate identities instead of silently overwriting one record', () => {
    assert.throws(() => validateSourceAdjustments([adjustment(), adjustment()]))
  })
  it('round-trips SQLite records, prevents omission, and permits explicit clearing', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
      writeSourceAdjustments(db, [adjustment()])
      assert.deepEqual(readSourceAdjustments(db), [adjustment()])
      assert.throws(() => writeSourceAdjustments(db, undefined))
      assert.deepEqual(readSourceAdjustments(db), [adjustment()])
      writeSourceAdjustments(db, [])
      assert.deepEqual(readSourceAdjustments(db), [])
    } finally { db.close() }
  })
  it('rolls back the extension along with a later planning failure', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
      writeSourceAdjustments(db, [adjustment()])
      db.exec('SAVEPOINT planning')
      writeSourceAdjustments(db, [{ ...adjustment(), amountJpy: -2000 }])
      assert.throws(() => db.exec('INSERT INTO missing_table VALUES (1)'))
      db.exec('ROLLBACK TO planning; RELEASE planning')
      assert.deepEqual(readSourceAdjustments(db), [adjustment()])
    } finally { db.close() }
  })
  it('does not replace malformed stored data with an empty list', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
      writeSourceAdjustments(db, [adjustment()])
      db.prepare("UPDATE app_settings SET value=? WHERE key='planning_source_adjustments_v1'").run('{broken')
      assert.throws(() => readSourceAdjustments(db))
      assert.equal(db.prepare("SELECT value FROM app_settings WHERE key='planning_source_adjustments_v1'").get()?.value, '{broken')
    } finally { db.close() }
  })
  it('keeps unrelated edits while merging whole adjustment records', () => {
    const base = workspace()
    base.planning.sourceAdjustments = [adjustment()]
    const local = structuredClone(base), latest = structuredClone(base)
    local.planning.sourceAdjustments![0]!.amountJpy = -500
    latest.planning.sourceAdjustments!.push(adjustment('other'))
    const merged = mergeWorkspaceDrafts(base, local, latest)
    assert.ok(merged.contents)
    assert.equal(merged.contents.planning.sourceAdjustments!.find((row) => row.id === 'r')!.amountJpy, -500)
    assert.equal(merged.contents.planning.sourceAdjustments!.length, 2)
  })
  it('does not automatically combine an edit with a concurrent deletion', () => {
    const base = workspace()
    base.planning.sourceAdjustments = [adjustment()]
    const local = structuredClone(base), latest = structuredClone(base)
    local.planning.sourceAdjustments![0]!.reason = '変更した理由'
    latest.planning.sourceAdjustments = []
    const merged = mergeWorkspaceDrafts(base, local, latest)
    assert.equal(merged.contents, null)
    assert.equal(merged.changes.filter((row) => row.conflict).length, 1)
  })
  it('treats adjustment changes as calculation-affecting, not harmless notes', () => {
    const base = workspace(), edited = structuredClone(base)
    edited.planning.sourceAdjustments = [adjustment()]
    assert.equal(workspaceChangeKind(base, edited), 'calculation')
    assert.equal(isNewWorkspace(edited, 0), false)
    assert.equal(isNewWorkspace(base, 0), true)
  })
})
