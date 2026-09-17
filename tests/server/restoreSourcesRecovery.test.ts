import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'vitest'
import {
  applyRestoreSources,
  previewRestoreSources,
  RestoreSourceConflict,
} from '../../src/server/restoreSources.js'
import { historyRootKey, resolveRestoreHistoryRoot } from '../../src/server/paths.js'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const action of cleanup.splice(0).reverse()) action()
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-restore-recovery-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const databasePath = join(directory, 'test.db')
  const db = new DatabaseSync(databasePath)
  cleanup.push(() => db.close())
  const salt = 'A'.repeat(43) + '\n'
  writeFileSync(join(directory, 'identifier-salt'), salt)
  const markerPath = join(directory, 'restore-reconnect-required.json')
  writeFileSync(markerPath, '{"version":1,"restoredAt":"2026-09-17T00:00:00Z"}')
  db.exec(`
    CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE history_sources(
      id TEXT PRIMARY KEY, provider TEXT, kind TEXT, name TEXT,
      root_path TEXT, root_key TEXT, enabled INTEGER,
      created_at TEXT, updated_at TEXT, UNIQUE(provider, root_key)
    );
    CREATE TABLE history_file_cache(source_id TEXT, payload TEXT);
    CREATE TABLE usage_events(source_id TEXT, amount INTEGER);
  `)
  for (const id of ['a', 'b']) {
    const root = join(directory, id)
    mkdirSync(root)
    db.prepare('INSERT INTO history_sources VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').run(
      id,
      'claude',
      'configured',
      id,
      root,
      historyRootKey(root),
      'before',
      'before',
    )
    db.prepare('INSERT INTO history_file_cache VALUES (?, ?)').run(id, 'old-host-cache')
    db.prepare('INSERT INTO usage_events VALUES (?, ?)').run(id, 100)
  }
  const usage = () =>
    JSON.stringify(db.prepare('SELECT * FROM usage_events ORDER BY source_id').all())
  const bindings = () =>
    JSON.stringify(db.prepare('SELECT * FROM history_sources ORDER BY id').all())
  const cacheCount = () => db.prepare('SELECT count(*) AS n FROM history_file_cache').get()!.n
  return { db, directory, databasePath, markerPath, salt, usage, bindings, cacheCount }
}

function setSavedRoot(db: DatabaseSync, root: string, key: string) {
  db.prepare("UPDATE history_sources SET root_path=?, root_key=? WHERE id='a'").run(root, key)
}

describe('restored history root boundary', () => {
  it('keeps a disabled Windows root and its original comparison key byte-for-byte', () => {
    const root = 'Z:\\Unavailable\\Claude\\Projects'
    const previous = Object.freeze({ root_path: root, root_key: root.toLowerCase() })
    const choice = Object.freeze({ root, enabled: false })
    assert.deepEqual(resolveRestoreHistoryRoot(choice, previous), {
      root,
      rootKey: previous.root_key,
    })
  })

  it('keeps an unchanged disabled POSIX root without reinterpreting it on the current OS', () => {
    const previous = { root_path: '/Volumes/Archive/Claude', root_key: '/Volumes/Archive/Claude' }
    assert.deepEqual(
      resolveRestoreHistoryRoot({ root: previous.root_path, enabled: false }, previous),
      { root: previous.root_path, rootKey: previous.root_key },
    )
  })

  it('does not allow the disabled exception for an edited relative root', () => {
    assert.throws(
      () =>
        resolveRestoreHistoryRoot(
          { root: 'other-relative-root', enabled: false },
          { root_path: 'saved-relative-root', root_key: 'saved-key' },
        ),
      /絶対パス/,
    )
  })

  it('does not allow the disabled exception when re-enabling a legacy relative root', () => {
    assert.throws(
      () =>
        resolveRestoreHistoryRoot(
          { root: 'saved-relative-root', enabled: true },
          { root_path: 'saved-relative-root', root_key: 'saved-key' },
        ),
      /絶対パス/,
    )
  })

  it('normalizes a newly supplied local root even when disabled', () => {
    const root = join(tmpdir(), 'devtax-new-missing-source')
    assert.deepEqual(
      resolveRestoreHistoryRoot(
        { root, enabled: false },
        { root_path: 'Z:\\Unavailable', root_key: 'z:\\unavailable' },
      ),
      { root, rootKey: historyRootKey(root) },
    )
  })
})

describe('restored source recovery without originals', () => {
  it('retains disabled legacy bindings, IDs, numeric history and identity, and can replay', () => {
    const f = fixture()
    setSavedRoot(f.db, 'unavailable-on-this-os', 'original-host-key')
    const beforeUsage = f.usage()
    const plan = previewRestoreSources(f.db, f.directory).plan
    plan.sources[0]!.enabled = false
    const result = applyRestoreSources(f.db, f.directory, plan)
    assert.equal(result.scanStarted, false)
    assert.deepEqual(result.sources.map((source) => source.sourceId), ['a', 'b'])
    assert.equal(result.sources[0]!.root, 'unavailable-on-this-os')
    assert.equal(result.sources[0]!.enabled, false)
    assert.equal(
      f.db.prepare("SELECT root_key FROM history_sources WHERE id='a'").get()!.root_key,
      'original-host-key',
    )
    assert.equal(f.usage(), beforeUsage)
    assert.equal(readFileSync(join(f.directory, 'identifier-salt'), 'utf8'), f.salt)
    assert.equal(f.cacheCount(), 0)
    assert.equal(existsSync(f.markerPath), false)
    f.db.prepare('INSERT INTO history_file_cache VALUES (?, ?)').run('b', 'fresh-after-reconnect')
    const afterBindings = f.bindings()
    assert.deepEqual(applyRestoreSources(f.db, f.directory, plan), result)
    assert.equal(f.bindings(), afterBindings)
    assert.equal(f.cacheCount(), 1)
  })

  it('invalidates pre-restore file caches even when enabled roots keep the same spelling', () => {
    const f = fixture()
    const beforeUsage = f.usage()
    const plan = previewRestoreSources(f.db, f.directory).plan
    applyRestoreSources(f.db, f.directory, plan)
    assert.equal(f.cacheCount(), 0)
    assert.equal(f.usage(), beforeUsage)
    assert.equal(existsSync(f.markerPath), false)
  })

  it('invalidates disabled caches before any later enabling', () => {
    const f = fixture()
    const beforeUsage = f.usage()
    const plan = previewRestoreSources(f.db, f.directory).plan
    for (const source of plan.sources) source.enabled = false
    const result = applyRestoreSources(f.db, f.directory, plan)
    assert.ok(result.sources.every((source) => !source.enabled))
    assert.equal(f.cacheCount(), 0)
    assert.equal(f.usage(), beforeUsage)
  })

  it('rebinds available sources while keeping an unavailable legacy source disabled', () => {
    const f = fixture()
    setSavedRoot(f.db, 'saved-on-another-os', 'other-os-key')
    const root = join(f.directory, 'new-readable-root')
    mkdirSync(root)
    const plan = previewRestoreSources(f.db, f.directory).plan
    plan.sources[0]!.enabled = false
    plan.sources[1]!.root = root
    const result = applyRestoreSources(f.db, f.directory, plan)
    assert.equal(result.sources[0]!.root, 'saved-on-another-os')
    assert.equal(result.sources[1]!.root, root)
    assert.equal(result.sources[1]!.enabled, true)
    assert.equal(f.cacheCount(), 0)
  })

  it('keeps the dataset held and unchanged when an enabled source is unavailable', () => {
    const f = fixture()
    const beforeBindings = f.bindings()
    const plan = previewRestoreSources(f.db, f.directory).plan
    plan.sources[0]!.root = join(f.directory, 'unavailable')
    assert.throws(() => applyRestoreSources(f.db, f.directory, plan))
    assert.equal(f.bindings(), beforeBindings)
    assert.equal(f.cacheCount(), 2)
    assert.equal(existsSync(f.markerPath), true)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM app_settings').get()!.n, 0)
  })

  it('still rejects duplicate enabled bindings before changing records', () => {
    const f = fixture()
    const beforeBindings = f.bindings()
    const plan = previewRestoreSources(f.db, f.directory).plan
    plan.sources[1]!.root = plan.sources[0]!.root
    assert.throws(() => applyRestoreSources(f.db, f.directory, plan), /重複/)
    assert.equal(f.bindings(), beforeBindings)
    assert.equal(f.cacheCount(), 2)
    assert.equal(existsSync(f.markerPath), true)
  })

  it('rolls back cache invalidation and binding changes when receipt persistence fails', () => {
    const f = fixture()
    const beforeBindings = f.bindings()
    const beforeUsage = f.usage()
    const plan = previewRestoreSources(f.db, f.directory).plan
    f.db.exec(
      "CREATE TRIGGER reject_receipt BEFORE INSERT ON app_settings BEGIN SELECT RAISE(ABORT, 'receipt failure'); END",
    )
    assert.throws(() => applyRestoreSources(f.db, f.directory, plan), /receipt failure/)
    assert.equal(f.bindings(), beforeBindings)
    assert.equal(f.usage(), beforeUsage)
    assert.equal(f.cacheCount(), 2)
    assert.equal(existsSync(f.markerPath), true)
    f.db.exec('DROP TRIGGER reject_receipt')
    applyRestoreSources(f.db, f.directory, plan)
    assert.equal(f.cacheCount(), 0)
  })

  it('rejects a stale plan without clearing caches or lifting the restore hold', () => {
    const f = fixture()
    const plan = previewRestoreSources(f.db, f.directory).plan
    f.db.prepare("UPDATE history_sources SET name='changed' WHERE id='a'").run()
    const beforeBindings = f.bindings()
    assert.throws(() => applyRestoreSources(f.db, f.directory, plan), RestoreSourceConflict)
    assert.equal(f.bindings(), beforeBindings)
    assert.equal(f.cacheCount(), 2)
    assert.equal(existsSync(f.markerPath), true)
  })

  it('rejects replay against a different restore marker', () => {
    const f = fixture()
    const plan = previewRestoreSources(f.db, f.directory).plan
    applyRestoreSources(f.db, f.directory, plan)
    writeFileSync(f.markerPath, '{"newRestore":true}')
    const beforeBindings = f.bindings()
    assert.throws(() => applyRestoreSources(f.db, f.directory, plan), RestoreSourceConflict)
    assert.equal(f.bindings(), beforeBindings)
    assert.equal(readFileSync(f.markerPath, 'utf8'), '{"newRestore":true}')
  })

  it('reads committed bindings and numeric records through another SQLite connection', () => {
    const f = fixture()
    setSavedRoot(f.db, 'old-host-only', 'old-host-key')
    const plan = previewRestoreSources(f.db, f.directory).plan
    plan.sources[0]!.enabled = false
    applyRestoreSources(f.db, f.directory, plan)
    const reopened = new DatabaseSync(f.databasePath, { readOnly: true })
    try {
      assert.equal(reopened.prepare('SELECT sum(amount) AS n FROM usage_events').get()!.n, 200)
      const row = reopened
        .prepare("SELECT root_path, root_key, enabled FROM history_sources WHERE id='a'")
        .get()!
      assert.equal(row.root_path, 'old-host-only')
      assert.equal(row.root_key, 'old-host-key')
      assert.equal(row.enabled, 0)
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM history_file_cache').get()!.n, 0)
    } finally {
      reopened.close()
    }
  })
})
