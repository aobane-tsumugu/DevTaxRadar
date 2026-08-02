import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageSession } from '../../src/server/sessionAggregation.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SQLite persistence', () => {
  it('stores normalized metadata in an isolated application directory', () => {
    const dataDirectory = mkdtempSync(joinTempPrefix('devtax-db-'))
    temporaryDirectories.push(dataDirectory)

    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', resolve('tests/server/helpers/database-probe.ts')],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          DEVTAX_RADAR_DATA_DIR: dataDirectory,
        },
      },
    )
    const result = JSON.parse(stdout) as {
      databaseExists: boolean
      overview: {
        providers: Array<Record<string, string | number>>
        recentScans: Array<Record<string, string | number>>
      }
    }

    expect(result.databaseExists).toBe(true)
    expect(result.overview.providers).toEqual([
      expect.objectContaining({
        provider: 'claude',
        month: '2026-04',
        sessions: 1,
        projects: 1,
        inputTokens: 100,
        outputTokens: 20,
      }),
    ])
    expect(result.overview.recentScans[0]).toEqual(
      expect.objectContaining({
        provider: 'claude',
        filesSeen: 1,
        eventsWritten: 1,
        malformedLines: 0,
        status: 'complete',
      }),
    )
  })
})

function joinTempPrefix(name: string): string {
  return `${tmpdir()}${process.platform === 'win32' ? '\\' : '/'}${name}`
}

const diagnostics = { filesSeen: 1, malformedLines: 0 }

function session(overrides: Partial<UsageSession> = {}): UsageSession {
  return {
    provider: 'claude',
    sessionKey: 'session_a',
    projectKey: 'project_a',
    month: '2026-07',
    startedAt: '2026-07-15T10:00:00.000Z',
    endedAt: '2026-07-15T11:00:00.000Z',
    messageCount: 2,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    schemaVersion: 'test-v1',
    confidence: 'medium',
    ...overrides,
  }
}

describe('session storage', () => {
  let sessionDirectory: string
  let db: typeof import('../../src/server/database.ts')

  beforeEach(async () => {
    sessionDirectory = mkdtempSync(joinTempPrefix('devtax-db-session-'))
    process.env.DEVTAX_RADAR_DATA_DIR = sessionDirectory
    vi.resetModules()
    db = await import('../../src/server/database.ts')
  })

  afterEach(() => {
    db.getDatabase().close()
    delete process.env.DEVTAX_RADAR_DATA_DIR
    rmSync(sessionDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
  })

  it('同じセッションを二重に保存しない', () => {
    db.replaceProviderSessions('claude', [session(), session()], diagnostics)
    expect(db.getUsageSessions()).toHaveLength(1)
  })

  it('再スキャンで置き換えてもトークンが失われない', () => {
    db.replaceProviderSessions('claude', [session({ inputTokens: 100 })], diagnostics)
    db.replaceProviderSessions('claude', [session({ inputTokens: 250 })], diagnostics)
    const rows = db.getUsageSessions()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.inputTokens).toBe(250)
  })

  it('生参照はopt-inしたときだけ保存する', () => {
    db.replaceProviderSessions('claude', [session()], diagnostics)
    expect(db.getSessionReference('claude', 'session_a')).toBeUndefined()

    db.replaceProviderSessions(
      'claude',
      [
        session({
          localReference: {
            nativeSessionId: 'native-1',
            sourcePath: '/tmp/a.jsonl',
            workingDirectory: '/tmp/work',
          },
        }),
      ],
      diagnostics,
    )
    expect(db.getSessionReference('claude', 'session_a')).toMatchObject({
      nativeSessionId: 'native-1',
      workingDirectory: '/tmp/work',
    })
  })

  it('セッション行に開始日時と終了日時を保持する', () => {
    db.replaceProviderSessions('claude', [session()], diagnostics)
    const row = db.getUsageSessions()[0]
    expect(row?.startedAt).toBe('2026-07-15T10:00:00.000Z')
    expect(row?.endedAt).toBe('2026-07-15T11:00:00.000Z')
  })

  it('旧スキーマを検出して作り直し、time_zoneを追加し、2回起動しても失敗しない', async () => {
    // v0.1.0以前の実際のスキーマを直接組み立てる: メッセージ単位のusage_events
    // （started_atがない）と、time_zoneのないscans。
    const databasePath = join(sessionDirectory, 'devtax-radar.db')
    const raw = new DatabaseSync(databasePath)
    raw.exec(`
      CREATE TABLE scans (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        files_seen INTEGER NOT NULL DEFAULT 0,
        events_written INTEGER NOT NULL DEFAULT 0,
        malformed_lines INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL
      ) STRICT;
      CREATE TABLE usage_events (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        month TEXT NOT NULL,
        session_key TEXT NOT NULL,
        project_key TEXT NOT NULL,
        project_label TEXT,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        observed_at TEXT,
        schema_version TEXT NOT NULL,
        confidence TEXT NOT NULL,
        UNIQUE(provider, session_key, month, project_key, observed_at)
      ) STRICT;
    `)
    raw
      .prepare(
        `
      INSERT INTO scans(provider, started_at, completed_at, files_seen, events_written, malformed_lines, status)
      VALUES ('claude', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:01.000Z', 1, 1, 0, 'complete')
    `,
      )
      .run()
    raw.close()

    // 起動その1: dbは既にimport済み（beforeEach）。getDatabase()が旧スキーマを検出して作り直す。
    const firstStart = db.getDatabase()
    const usageColumns = (
      firstStart.prepare(`PRAGMA table_info(usage_events)`).all() as Array<{ name: string }>
    ).map((column) => column.name)
    const scanColumns = (
      firstStart.prepare(`PRAGMA table_info(scans)`).all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(usageColumns).toContain('started_at')
    expect(scanColumns).toContain('time_zone')
    expect((firstStart.prepare(`SELECT COUNT(*) AS n FROM scans`).get() as { n: number }).n).toBe(1)

    // 起動その2: モジュールを再importして新しいDatabaseSyncを同じファイルへ開く。
    // 既に現行スキーマのため、ALTER/DROPガードは何もせず、例外も投げない。
    vi.resetModules()
    const restarted = await import('../../src/server/database.ts')
    expect(() => restarted.getDatabase()).not.toThrow()
    expect(
      (restarted.getDatabase().prepare(`SELECT COUNT(*) AS n FROM scans`).get() as { n: number }).n,
    ).toBe(1)
    restarted.getDatabase().close()
  })

  it('planning_project_rulesのtax_unit_id NOT NULLを検出して作り直し、planning_tax_unitsを失わない', () => {
    // v0.1.0以前のレガシースキーマ: tax_unit_idがNOT NULLのplanning_project_rulesと、
    // それが実際に参照するplanning_tax_unitsの行を1件ずつ用意する。
    // 外部キー制約が有効な状態でplanning_project_rules（子テーブル）をDROPしても、
    // planning_tax_units（親テーブル）の行は失われないことを確認する。
    const databasePath = join(sessionDirectory, 'devtax-radar.db')
    const raw = new DatabaseSync(databasePath)
    raw.exec(`
      CREATE TABLE planning_tax_units (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit_type TEXT NOT NULL,
        usage_mode TEXT NOT NULL,
        revenue_model TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        journey_mode TEXT NOT NULL DEFAULT 'early',
        monetization_status TEXT NOT NULL DEFAULT 'planned',
        completion_criteria TEXT,
        predecessor_id TEXT,
        same_as_external_version TEXT,
        notes TEXT
      ) STRICT;
      CREATE TABLE planning_project_rules (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        provider TEXT,
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        tax_unit_id TEXT NOT NULL REFERENCES planning_tax_units(id),
        classification TEXT NOT NULL,
        reason TEXT
      ) STRICT;
    `)
    raw
      .prepare(
        `
      INSERT INTO planning_tax_units(id, name, unit_type, usage_mode, revenue_model, lifecycle_status)
      VALUES ('unit-legacy', 'レガシー制作物', 'new-software', 'internal', 'undecided', 'idea')
    `,
      )
      .run()
    raw
      .prepare(
        `
      INSERT INTO planning_project_rules(id, project_key, effective_from, tax_unit_id, classification)
      VALUES ('rule-legacy', 'project_legacy_0001', '2026-01-01', 'unit-legacy', 'new-development')
    `,
      )
      .run()
    raw.close()

    // dbは既にimport済み（beforeEach）。getDatabase()が旧スキーマを検出して作り直す。
    const firstStart = db.getDatabase()
    const projectRuleColumns = firstStart
      .prepare(`PRAGMA table_info(planning_project_rules)`)
      .all() as Array<{ name: string; notnull: number }>
    const taxUnitIdColumn = projectRuleColumns.find((column) => column.name === 'tax_unit_id')
    expect(taxUnitIdColumn?.notnull).toBe(0)
    expect(
      (firstStart.prepare(`SELECT COUNT(*) AS n FROM planning_tax_units`).get() as { n: number }).n,
    ).toBe(1)
    expect(() =>
      firstStart
        .prepare(
          `
      INSERT INTO planning_project_rules(id, project_key, effective_from, tax_unit_id, classification)
      VALUES ('rule-private', 'project_private_0001', '2026-01-01', NULL, 'private')
    `,
        )
        .run(),
    ).not.toThrow()
  })

  it('旧project_mappingsをplanning_project_rulesへ移行し、テーブル自体を削除する', () => {
    // v0.1.0以前のレガシースキーマ: project_key単位の分類だけを持つproject_mappings。
    // product_nameは制作物ではなく、フォルダに付けた表示名にすぎないため移行しない。
    const databasePath = join(sessionDirectory, 'devtax-radar.db')
    const raw = new DatabaseSync(databasePath)
    raw.exec(`
      CREATE TABLE project_mappings (
        project_key TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        asset_name TEXT NOT NULL,
        classification TEXT NOT NULL
      ) STRICT;
    `)
    raw
      .prepare(
        `
      INSERT INTO project_mappings(project_key, product_name, asset_name, classification)
      VALUES ('project_legacy_mapping_0001', '旧プロダクト名', '旧資産名', 'maintenance')
    `,
      )
      .run()
    raw.close()

    // dbは既にimport済み（beforeEach）。getDatabase()が旧テーブルを検出して移行し、削除する。
    const firstStart = db.getDatabase()

    const tableExists = firstStart
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_mappings'`)
      .get()
    expect(tableExists).toBeUndefined()

    const migratedRule = firstStart
      .prepare(
        `
      SELECT project_key AS projectKey, tax_unit_id AS taxUnitId, classification, reason
      FROM planning_project_rules WHERE project_key = 'project_legacy_mapping_0001'
    `,
      )
      .get() as
      | {
          projectKey: string
          taxUnitId: string | null
          classification: string
          reason: string | null
        }
      | undefined
    expect(migratedRule).toEqual({
      projectKey: 'project_legacy_mapping_0001',
      taxUnitId: null,
      classification: 'maintenance',
      reason: '旧設定から移行',
    })
  })

  it('利用者の実データに近い旧スキーマ全体を1回の起動で移行し、provider_settingsは既存の月額を保ったまま契約列を得る', () => {
    // このリポジトリのユーザーが実際に持つDBは、session_referencesが存在せず、
    // usage_eventsがメッセージ単位（started_atがない）で、provider_settingsが
    // provider/monthly_fee_jpyしか持たない、v0.1.0以前のスキーマのまま45,529行の
    // 実データを抱えている。ここではその状態を、commit 061c534（0e9abb2の直前、
    // セッション単位への作り直し前の最後のコミット）のsrc/server/database.tsから
    // 再構成する。個々の移行ガードは他のテストで単独に確認済みだが、実際の起動では
    // これらが同じ1回のgetDatabase()呼び出しの中で連続して走るため、その連鎖を
    // 1つのテストで確認する。
    const databasePath = join(sessionDirectory, 'devtax-radar.db')
    const raw = new DatabaseSync(databasePath)
    raw.exec(`
      CREATE TABLE scans (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        files_seen INTEGER NOT NULL DEFAULT 0,
        events_written INTEGER NOT NULL DEFAULT 0,
        malformed_lines INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL
      ) STRICT;
      CREATE TABLE usage_events (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        month TEXT NOT NULL,
        session_key TEXT NOT NULL,
        project_key TEXT NOT NULL,
        project_label TEXT,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        observed_at TEXT,
        schema_version TEXT NOT NULL,
        confidence TEXT NOT NULL,
        UNIQUE(provider, session_key, month, project_key, observed_at)
      ) STRICT;
      CREATE TABLE provider_settings (
        provider TEXT PRIMARY KEY,
        monthly_fee_jpy INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE project_mappings (
        project_key TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        asset_name TEXT NOT NULL,
        classification TEXT NOT NULL
      ) STRICT;
      CREATE TABLE planning_tax_units (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit_type TEXT NOT NULL,
        usage_mode TEXT NOT NULL,
        revenue_model TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        journey_mode TEXT NOT NULL DEFAULT 'early',
        monetization_status TEXT NOT NULL DEFAULT 'planned',
        completion_criteria TEXT,
        predecessor_id TEXT,
        same_as_external_version TEXT,
        notes TEXT
      ) STRICT;
      CREATE TABLE planning_project_rules (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        provider TEXT,
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        tax_unit_id TEXT NOT NULL REFERENCES planning_tax_units(id),
        classification TEXT NOT NULL,
        reason TEXT
      ) STRICT;
    `)
    raw
      .prepare(
        `
      INSERT INTO scans(provider, started_at, completed_at, files_seen, events_written, malformed_lines, status)
      VALUES ('claude', '2026-04-01T00:00:00.000Z', '2026-04-01T00:00:05.000Z', 12, 12, 0, 'complete')
    `,
      )
      .run()
    raw
      .prepare(`INSERT INTO provider_settings(provider, monthly_fee_jpy) VALUES ('claude', 30000)`)
      .run()
    raw
      .prepare(`INSERT INTO provider_settings(provider, monthly_fee_jpy) VALUES ('codex', 20000)`)
      .run()
    raw
      .prepare(
        `
      INSERT INTO usage_events(
        provider, month, session_key, project_key, project_label, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        observed_at, schema_version, confidence
      ) VALUES ('claude', '2026-04', 'legacy_session_1', 'legacy_project_1', '実データ制作物', 'claude-x',
        1000, 200, 0, 0, '2026-04-05T00:00:00.000Z', 'legacy-v1', 'medium')
    `,
      )
      .run()
    raw
      .prepare(
        `
      INSERT INTO usage_events(
        provider, month, session_key, project_key, project_label, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        observed_at, schema_version, confidence
      ) VALUES ('codex', '2026-04', 'legacy_session_2', 'legacy_project_2', '旧プロダクト', 'codex-x',
        500, 90, 0, 0, '2026-04-06T00:00:00.000Z', 'legacy-v1', 'medium')
    `,
      )
      .run()
    raw
      .prepare(
        `
      INSERT INTO planning_tax_units(id, name, unit_type, usage_mode, revenue_model, lifecycle_status)
      VALUES ('unit-real', '実データ制作物', 'new-software', 'internal', 'undecided', 'idea')
    `,
      )
      .run()
    raw
      .prepare(
        `
      INSERT INTO planning_project_rules(id, project_key, effective_from, tax_unit_id, classification)
      VALUES ('rule-real', 'legacy_project_1', '2026-01-01', 'unit-real', 'new-development')
    `,
      )
      .run()
    raw
      .prepare(
        `
      INSERT INTO project_mappings(project_key, product_name, asset_name, classification)
      VALUES ('legacy_project_2', '旧プロダクト', '旧資産', 'maintenance')
    `,
      )
      .run()
    raw.close()

    // dbは既にimport済み（beforeEach）。getDatabase()を初めて呼ぶことで、
    // 上で作った旧DBファイルに対して起動時の移行ロジックがすべて連続して走る。
    expect(() => db.getDatabase()).not.toThrow()
    const started = db.getDatabase()

    // scans: time_zone列が追加され、既存の1行は残る
    const scanColumns = (
      started.prepare(`PRAGMA table_info(scans)`).all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(scanColumns).toContain('time_zone')
    expect((started.prepare(`SELECT COUNT(*) AS n FROM scans`).get() as { n: number }).n).toBe(1)

    // provider_settings: 契約列（開始日・終了日）が追加され、既存のmonthly_fee_jpyは保持される
    const providerRows = started
      .prepare(
        `SELECT provider, monthly_fee_jpy AS amount,
                contract_started_on AS startedOn, contract_ended_on AS endedOn
         FROM provider_settings ORDER BY provider`,
      )
      .all() as Array<{
      provider: string
      amount: number
      startedOn: string | null
      endedOn: string | null
    }>
    expect(providerRows).toEqual([
      { provider: 'claude', amount: 30000, startedOn: null, endedOn: null },
      { provider: 'codex', amount: 20000, startedOn: null, endedOn: null },
    ])

    // usage_events: メッセージ単位の旧行は作り直しの対象になり、セッション単位の新スキーマになる
    const usageColumns = (
      started.prepare(`PRAGMA table_info(usage_events)`).all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(usageColumns).toContain('started_at')
    expect(usageColumns).toContain('ended_at')
    expect(usageColumns).toContain('message_count')

    // planning_tax_units: 親テーブルの行は失われない
    expect(
      (
        started
          .prepare(`SELECT COUNT(*) AS n FROM planning_tax_units WHERE id = 'unit-real'`)
          .get() as { n: number }
      ).n,
    ).toBe(1)

    // planning_project_rules: tax_unit_idがNULL許容の新スキーマへ作り直される。
    // 子テーブルのDROP+再作成なので、旧NOT NULL時代の行（rule-real）自体は失われる。
    // データが失われないのは親のplanning_tax_unitsだけ、というのが実装コメントの通りの挙動。
    const ruleColumns = started
      .prepare(`PRAGMA table_info(planning_project_rules)`)
      .all() as Array<{ name: string; notnull: number }>
    expect(ruleColumns.find((column) => column.name === 'tax_unit_id')?.notnull).toBe(0)

    // project_mappings: planning_project_rulesへ移行され、テーブル自体は削除される
    const migratedFromMappings = started
      .prepare(
        `SELECT tax_unit_id AS taxUnitId, classification, reason
         FROM planning_project_rules WHERE project_key = 'legacy_project_2'`,
      )
      .get() as
      { taxUnitId: string | null; classification: string; reason: string | null } | undefined
    expect(migratedFromMappings).toEqual({
      taxUnitId: null,
      classification: 'maintenance',
      reason: '旧設定から移行',
    })
    expect(
      started
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_mappings'`,
        )
        .get(),
    ).toBeUndefined()
  })

  it('再スキャンで消えたセッションの参照が残らない', () => {
    db.replaceProviderSessions(
      'claude',
      [
        session({
          sessionKey: 'session_a',
          localReference: {
            nativeSessionId: 'native-a',
            sourcePath: '/a.jsonl',
            workingDirectory: '/work/a',
          },
        }),
        session({
          sessionKey: 'session_b',
          projectKey: 'project_b',
          localReference: {
            nativeSessionId: 'native-b',
            sourcePath: '/b.jsonl',
            workingDirectory: '/work/b',
          },
        }),
      ],
      diagnostics,
    )
    // A second provider's reference: replaceProviderSessions("claude", ...)
    // below must scope its DELETE to provider = 'claude', or this codex
    // reference would be silently wiped too.
    db.replaceProviderSessions(
      'codex',
      [
        session({
          provider: 'codex',
          sessionKey: 'session_c',
          projectKey: 'project_c',
          localReference: {
            nativeSessionId: 'native-c',
            sourcePath: '/c.jsonl',
            workingDirectory: '/work/c',
          },
        }),
      ],
      diagnostics,
    )

    db.replaceProviderSessions(
      'claude',
      [
        session({
          sessionKey: 'session_a',
          localReference: {
            nativeSessionId: 'native-a',
            sourcePath: '/a.jsonl',
            workingDirectory: '/work/a',
          },
        }),
      ],
      diagnostics,
    )

    expect(db.getSessionReference('claude', 'session_a')).toMatchObject({
      nativeSessionId: 'native-a',
    })
    expect(db.getSessionReference('claude', 'session_b')).toBeUndefined()
    expect(db.getSessionReference('codex', 'session_c')).toMatchObject({
      nativeSessionId: 'native-c',
    })
  })
})
