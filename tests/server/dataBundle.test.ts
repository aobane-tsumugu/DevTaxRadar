import { randomBytes } from 'node:crypto'
import { previewRestoreSources, applyRestoreSources } from '../../src/server/restoreSources.js'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDataBundle,
  verifyDataBundle,
  restoreDataBundle,
  databaseSchemaHash,
} from '../../src/server/dataBundle.js'
import {
  initializeBalanceSchema,
  saveBalanceDraft,
  adoptBalanceReview,
  previewBalanceReview,
  getBalanceReview,
} from '../../src/server/balanceRepository.js'

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'devtax-bundle-test-'))
  temporary.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'identifier-salt'), randomBytes(32).toString('base64url') + '\n')
  const db = new DatabaseSync(join(source, 'devtax-radar.db'))
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0')
  initializeBalanceSchema(db)
  const snapshot = { version: 1 as const, accounts: [], movements: [], pendingDecisions: [] }
  saveBalanceDraft(db, snapshot, 0)
  const preview = previewBalanceReview(db, 2026)
  const review = adoptBalanceReview(db, {
    year: 2026,
    expectedDraftRevision: 1,
    projectionHash: preview.projectionHash,
    idempotencyKey: 'test',
    reason: '合成資料を確認',
  })
  return { root, source, db, review }
}
describe('complete database and identity bundle', () => {
  it('reconnects copied original logs and rescans with the same source, session and project identifiers', () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-reconnect-scan-'))
    temporary.push(root)
    const oldHome = join(root, 'old-home'),
      source = join(root, 'source'),
      bundle = join(root, 'bundle'),
      restored = join(root, 'restored'),
      logs = join(root, 'moved-logs')
    cpSync(resolve('fixtures/claude'), join(oldHome, '.claude', 'projects'), { recursive: true })
    const probe = (data: string, home: string) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ['--import', 'tsx', resolve('tests/server/helpers/restored-data-probe.ts')],
          {
            encoding: 'utf8',
            env: { ...process.env, DEVTAX_RADAR_DATA_DIR: data, HOME: home, USERPROFILE: home },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      )
    const before = probe(source, oldHome)
    expect(before.scanResult.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'local-claude',
          status: 'complete',
          events: expect.any(Number),
        }),
      ]),
    )
    const contents = (data: string) => {
      const db = new DatabaseSync(join(data, 'devtax-radar.db'), { readOnly: true })
      try {
        return db
          .prepare(
            'SELECT source_id,provider,session_key,project_key,month,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens FROM usage_events ORDER BY source_id,provider,session_key,project_key,month',
          )
          .all()
      } finally {
        db.close()
      }
    }
    const expected = contents(source)
    expect(expected.length).toBeGreaterThan(0)
    const manifest = createDataBundle(source, bundle)
    restoreDataBundle(bundle, restored, manifest.schemaHash)
    cpSync(join(oldHome, '.claude', 'projects'), logs, { recursive: true })
    const db = new DatabaseSync(join(restored, 'devtax-radar.db'))
    try {
      const plan = previewRestoreSources(db, restored).plan
      for (const row of plan.sources) {
        row.enabled = row.sourceId === 'local-claude'
        if (row.enabled) row.root = logs
      }
      applyRestoreSources(db, restored, plan)
    } finally {
      db.close()
    }
    const after = probe(restored, join(root, 'new-home'))
    expect(after.scanResult.sources).toEqual([
      expect.objectContaining({ sourceId: 'local-claude', status: 'complete' }),
    ])
    expect(after.scanResult.sources[0].events).toBeGreaterThan(0)
    expect(contents(restored)).toEqual(expected)
  })
  it('captures committed WAL records and identity, restores immutable reviews into a new directory, and keeps unknown fields', () => {
    const f = fixture()
    const bundle = join(f.root, 'bundle'),
      restored = join(f.root, 'restored')
    let expected: string
    try {
      f.db.exec(
        "CREATE TABLE future_record (payload TEXT); INSERT INTO future_record VALUES ('unknown extension retained')",
      )
      expected = databaseSchemaHash(f.db)
      const manifest = createDataBundle(f.source, bundle)
      expect(manifest.schemaHash).toBe(expected)
      expect(verifyDataBundle(bundle)).toEqual(manifest)
      expect(readFileSync(join(bundle, 'identifier-salt'))).toEqual(
        readFileSync(join(f.source, 'identifier-salt')),
      )
      expect(restoreDataBundle(bundle, restored, expected)).toEqual(manifest)
    } finally {
      f.db.close()
    }
    const copy = new DatabaseSync(join(restored, 'devtax-radar.db'))
    try {
      expect(getBalanceReview(copy, f.review.id)).toEqual(f.review)
      expect(copy.prepare('SELECT * FROM future_record').get()).toEqual({
        payload: 'unknown extension retained',
      })
      expect(() => copy.exec('DELETE FROM balance_reviews')).toThrow('immutable')
    } finally {
      copy.close()
    }
  })
  it('rejects corrupted files, unsupported schema and existing destinations without changing originals', () => {
    const f = fixture()
    try {
      const bundle = join(f.root, 'bundle')
      const manifest = createDataBundle(f.source, bundle)
      expect(() => restoreDataBundle(bundle, join(f.root, 'rejected'), '0'.repeat(64))).toThrow(
        '対応しない',
      )
      expect(existsSync(join(f.root, 'rejected'))).toBe(false)
      expect(() => restoreDataBundle(bundle, f.source, manifest.schemaHash)).toThrow('既に存在')
      expect(getBalanceReview(f.db, f.review.id)).toEqual(f.review)
      writeFileSync(join(bundle, 'identifier-salt'), randomBytes(32).toString('base64url') + '\n')
      expect(() => verifyDataBundle(bundle)).toThrow('hash')
    } finally {
      f.db.close()
    }
  })
  it('fails safely for a missing salt or invalid database and never leaves a published partial bundle', () => {
    const f = fixture()
    f.db.close()
    const saltPath = join(f.source, 'identifier-salt')
    const salt = readFileSync(saltPath)
    rmSync(saltPath)
    expect(() => createDataBundle(f.source, join(f.root, 'missing'))).toThrow()
    expect(existsSync(join(f.root, 'missing'))).toBe(false)
    writeFileSync(saltPath, salt)
    writeFileSync(join(f.source, 'devtax-radar.db'), 'invalid database')
    expect(() => createDataBundle(f.source, join(f.root, 'broken'))).toThrow()
    expect(readdirSync(f.root)).toEqual(['source'])
  })
  it('rejects new manifest fields or version instead of dropping them', () => {
    const f = fixture()
    try {
      const bundle = join(f.root, 'bundle')
      const manifest = createDataBundle(f.source, bundle)
      writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ ...manifest, version: 2 }))
      expect(() => verifyDataBundle(bundle)).toThrow()
      writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ ...manifest, future: true }))
      expect(() => verifyDataBundle(bundle)).toThrow()
    } finally {
      f.db.close()
    }
  })
  it('creates and verifies a full product database with the CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-bundle-cli-'))
    temporary.push(root)
    const source = join(root, 'source'),
      bundle = join(root, 'bundle')
    execFileSync(
      process.execPath,
      ['--import', 'tsx', resolve('tests/server/helpers/database-probe.ts')],
      { env: { ...process.env, DEVTAX_RADAR_DATA_DIR: source }, stdio: 'pipe' },
    )
    writeFileSync(join(source, 'identifier-salt'), randomBytes(32).toString('base64url') + '\n')
    const run = (...args: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ['--import', 'tsx', resolve('scripts/data-backup.ts'), ...args],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      )
    const exported = run('create', source, bundle)
    expect(run('verify', bundle).schemaHash).toBe(exported.schemaHash)
    const restored = join(root, 'restored')
    expect(run('restore', bundle, restored)).toMatchObject({
      requiresSourceReconnect: true,
      dataDirectory: restored,
    })
    expect(readFileSync(join(restored, 'identifier-salt'))).toEqual(
      readFileSync(join(source, 'identifier-salt')),
    )
    const probe = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', resolve('tests/server/helpers/restored-data-probe.ts')],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            DEVTAX_RADAR_DATA_DIR: restored,
            HOME: join(root, 'new-home'),
            USERPROFILE: join(root, 'new-home'),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    )
    expect(probe).toMatchObject({
      restoreRequiresReconnect: true,
      automaticScan: false,
      scanRejected: true,
    })
    const planPath = join(root, 'reconnect.json')
    const reconnect = (...args: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ['--import', 'tsx', resolve('scripts/restore-sources.ts'), ...args],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      )
    const plan = reconnect('preview', restored, planPath).plan
    for (const item of plan.sources) {
      item.enabled = false
      item.root = join(root, 'relocated-' + item.sourceId)
    }
    writeFileSync(planPath, JSON.stringify(plan))
    expect(reconnect('apply', restored, planPath)).toMatchObject({
      reconnected: true,
      scanStarted: false,
    })
    const afterReconnect = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', resolve('tests/server/helpers/restored-data-probe.ts')],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            DEVTAX_RADAR_DATA_DIR: restored,
            HOME: join(root, 'third-home'),
            USERPROFILE: join(root, 'third-home'),
            DEVTAX_RADAR_AUTO_SCAN: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    )
    expect(afterReconnect).toMatchObject({
      restoreRequiresReconnect: false,
      automaticScan: true,
      scanRejected: false,
    })
    expect(
      afterReconnect.sources.map((s: { root: string; enabled: boolean }) => ({
        root: s.root,
        enabled: s.enabled,
      })),
    ).toEqual(
      plan.sources.map((s: { root: string; enabled: boolean }) => ({
        root: s.root,
        enabled: s.enabled,
      })),
    )
    const original = new DatabaseSync(join(source, 'devtax-radar.db'), { readOnly: true })
    const copied = new DatabaseSync(join(bundle, 'devtax-radar.db'), { readOnly: true })
    try {
      expect(databaseSchemaHash(copied)).toBe(databaseSchemaHash(original))
      expect(probe.sources.map((s: { root: string }) => s.root)).toEqual(
        original
          .prepare(
            "SELECT root_path FROM history_sources ORDER BY CASE kind WHEN 'default' THEN 0 ELSE 1 END, provider, name, id",
          )
          .all()
          .map((row) => row.root_path),
      )
      const activated = new DatabaseSync(join(restored, 'devtax-radar.db'), { readOnly: true })
      try {
        expect(activated.prepare('SELECT * FROM usage_events').all()).toEqual(
          original.prepare('SELECT * FROM usage_events').all(),
        )
      } finally {
        activated.close()
      }
      const tables = original
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
      for (const { name } of tables) {
        const quoted = '"' + name.replaceAll('"', '""') + '"'
        expect(copied.prepare('SELECT * FROM ' + quoted).all()).toEqual(
          original.prepare('SELECT * FROM ' + quoted).all(),
        )
      }
    } finally {
      original.close()
      copied.close()
    }
  }, 60_000)
})
