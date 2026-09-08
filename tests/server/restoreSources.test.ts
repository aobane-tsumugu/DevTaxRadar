import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { previewRestoreSources, applyRestoreSources } from '../../src/server/restoreSources.js'
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const action of cleanup.splice(0)) action()
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-reconnect-test-'))
  const db = new DatabaseSync(':memory:')
  cleanup.push(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  writeFileSync(join(directory, 'identifier-salt'), 'synthetic-identity')
  writeFileSync(join(directory, 'restore-reconnect-required.json'), '{}')
  db.exec(
    'CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE history_sources(id TEXT PRIMARY KEY, provider TEXT, kind TEXT, name TEXT, root_path TEXT, root_key TEXT, enabled INTEGER, created_at TEXT, updated_at TEXT, UNIQUE(provider,root_key)); CREATE TABLE history_file_cache(source_id TEXT,payload TEXT); CREATE TABLE usage_events(source_id TEXT,amount INTEGER)',
  )
  for (const id of ['a', 'b']) {
    const root = join(directory, id)
    mkdirSync(root)
    db.prepare('INSERT INTO history_sources VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').run(
      id,
      'claude',
      'default',
      id,
      root,
      root.toLowerCase(),
      'before',
      'before',
    )
    db.prepare('INSERT INTO history_file_cache VALUES (?,?)').run(id, 'cached')
    db.prepare('INSERT INTO usage_events VALUES (?,?)').run(id, 100)
  }
  return { db, directory }
}
describe('restored source reconnect', () => {
  it('swaps roots atomically, preserves IDs and numeric history, and replays without changing records', () => {
    const { db, directory } = fixture()
    const view = previewRestoreSources(db, directory)
    const first = view.plan.sources[0]!.root
    view.plan.sources[0]!.root = view.plan.sources[1]!.root
    view.plan.sources[1]!.root = first
    const result = applyRestoreSources(db, directory, view.plan)
    expect(result.sources.map((s) => s.sourceId)).toEqual(['a', 'b'])
    expect(existsSync(join(directory, 'restore-reconnect-required.json'))).toBe(false)
    expect(db.prepare('SELECT * FROM history_file_cache').all()).toEqual([])
    expect(db.prepare('SELECT * FROM usage_events').all()).toEqual([
      { source_id: 'a', amount: 100 },
      { source_id: 'b', amount: 100 },
    ])
    expect(applyRestoreSources(db, directory, view.plan)).toEqual(result)
    writeFileSync(join(directory, 'restore-reconnect-required.json'), '{"newRestore":true}')
    expect(() => applyRestoreSources(db, directory, view.plan)).toThrow('再接続後')
    expect(existsSync(join(directory, 'restore-reconnect-required.json'))).toBe(true)
  })
  it('requires all IDs and readable enabled roots, rejects stale confirmation, and keeps the hold on failure', () => {
    const { db, directory } = fixture()
    const plan = previewRestoreSources(db, directory).plan
    expect(() =>
      applyRestoreSources(db, directory, { ...plan, sources: plan.sources.slice(0, 1) }),
    ).toThrow('すべて')
    const duplicate = structuredClone(plan)
    duplicate.sources[1]!.root = duplicate.sources[0]!.root
    expect(() => applyRestoreSources(db, directory, duplicate)).toThrow('重複')
    const missing = structuredClone(plan)
    missing.sources[0]!.root = join(directory, 'missing')
    expect(() => applyRestoreSources(db, directory, missing)).toThrow()
    db.prepare("UPDATE history_sources SET name='other' WHERE id='a'").run()
    expect(() => applyRestoreSources(db, directory, plan)).toThrow('確認後')
    expect(existsSync(join(directory, 'restore-reconnect-required.json'))).toBe(true)
    expect(db.prepare('SELECT * FROM history_file_cache').all()).toHaveLength(2)
  })
  it('retains disabled unavailable sources and rolls back source/cache edits if the receipt fails', () => {
    const { db, directory } = fixture()
    const plan = previewRestoreSources(db, directory).plan
    plan.sources[0]!.root = join(directory, 'unavailable')
    plan.sources[0]!.enabled = false
    db.exec(
      "CREATE TRIGGER reject_receipt BEFORE INSERT ON app_settings BEGIN SELECT RAISE(ABORT, 'receipt failure'); END",
    )
    expect(() => applyRestoreSources(db, directory, plan)).toThrow('receipt failure')
    expect(db.prepare('SELECT * FROM history_file_cache').all()).toHaveLength(2)
    expect(existsSync(join(directory, 'restore-reconnect-required.json'))).toBe(true)
    db.exec('DROP TRIGGER reject_receipt')
    expect(applyRestoreSources(db, directory, plan).sources[0]!.enabled).toBe(false)
    expect(db.prepare('SELECT * FROM usage_events').all()).toHaveLength(2)
  })
})
