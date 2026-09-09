import {
  PROVIDER_SETTINGS_TABLE,
  requiresDefaultChargeMigration,
  migrateDefaultCharges,
} from './defaultChargeMigration.js'
import {
  MONTHLY_CHARGE_TABLE,
  requiresMonthlyChargeMigration,
  migrateMonthlyCharges,
} from './monthlyChargeMigration.js'
import { initializeBalanceSchema } from './balanceRepository.js'
import { initializeDatasetIdentity } from './datasetIdentity.js'
import { initializeCostPresenceSchema } from './costPresenceRepository.js'
import { initializeEquipmentMethodsSchema } from './equipmentMethodsRepository.js'
import { advanceWorkspaceRevision } from './workspaceRevision.js'
import {
  CHARGE_PERIOD_TABLE,
  requiresChargePeriodMigration,
  migrateChargePeriods,
} from './chargePeriodMigration.js'
import {
  EQUIPMENT_TABLE,
  requiresEquipmentCostMigration,
  migrateEquipmentCosts,
} from './equipmentCostMigration.js'
import {
  HOME_COST_TABLE,
  requiresHomeCostMigration,
  migrateHomeCosts,
} from './homeCostMigration.js'
import {
  DIRECT_COST_TABLE,
  requiresDirectCostMigration,
  migrateDirectCosts,
} from './directCostMigration.js'
import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolvedTimeZone } from '../adapters/localTime.js'
import type { NormalizedUsage, UsageProvider } from '../adapters/types.js'
import type { ProviderChargePeriod } from '../core/chargePeriods.js'
import {
  getAppDataDirectory,
  restoreRequiresReconnect,
  getDefaultHistoryPaths,
  historyRootKey,
  normalizeHistoryRoot,
} from './paths.js'
import type { UsageSession } from './sessionAggregation.js'

let databaseSingleton: DatabaseSync | undefined

type UsageOverview = {
  providers: Array<{
    provider: string
    month: string
    sessions: number
    projects: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }>
  recentScans: Array<Record<string, string | number | null>>
}

export type ProviderContract = {
  startedOn?: string // 'YYYY-MM-DD'
  endedOn?: string // 'YYYY-MM-DD'
}

export type LocalConfiguration = {
  charges: { claude: number | null; codex: number | null }
  unknownChargeReasons?: Partial<Record<'claude' | 'codex', string>>
  monthlyCharges: Array<{
    provider: 'claude' | 'codex'
    month: string
    amountJpy: number | null
    unknownAmountReason?: string
  }>
  contracts: { claude: ProviderContract; codex: ProviderContract }
  chargePeriods?: ProviderChargePeriod[]
  unobservedRatio: number | null
}

export type HistorySourceKind = 'default' | 'configured'

export type HistorySource = {
  id: string
  provider: UsageProvider
  kind: HistorySourceKind
  name: string
  root: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type HistorySourceInput = {
  provider: UsageProvider
  name: string
  root: string
  enabled?: boolean
}

export type HistorySourceScanStatus = {
  sourceId: string
  provider: UsageProvider
  status: 'complete' | 'unavailable' | 'failed' | 'running'
  completedAt?: string
  filesSeen: number
  eventsWritten: number
  errorCode?: 'not_found' | 'not_readable' | 'scan_failed'
}

/**
 * The durable portion of a normalized event. Local transcript references are
 * intentionally excluded: cache rows must never become another store of raw
 * paths, native IDs, or working directories.
 */
export type CachedNormalizedUsage = Omit<NormalizedUsage, 'localReference'>

export type HistoryFileCacheEntry = {
  fileKey: string
  byteSize: number
  fileMtime: string
  adapter: string
  schemaVersion: string
  events: CachedNormalizedUsage[]
  valid: boolean
}

export type HistoryFileCacheMutation = {
  upsert: Array<Omit<HistoryFileCacheEntry, 'valid'>>
  deleteFileKeys: string[]
}

const USAGE_EVENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'local',
    provider TEXT NOT NULL,
    session_key TEXT NOT NULL,
    project_key TEXT NOT NULL,
    month TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    project_label TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    schema_version TEXT NOT NULL,
    confidence TEXT NOT NULL,
    UNIQUE(source_id, provider, session_key, project_key, month)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS usage_events_month_provider ON usage_events(month, provider);
  CREATE INDEX IF NOT EXISTS usage_events_project ON usage_events(project_key);
`

const PLANNING_PROJECT_RULES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS planning_project_rules (
    id TEXT PRIMARY KEY,
    project_key TEXT NOT NULL,
    provider TEXT,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    tax_unit_id TEXT REFERENCES planning_tax_units(id),
    classification TEXT NOT NULL,
    reason TEXT
  ) STRICT;
`

const MULTI_SOURCE_MIGRATION_ID = '2026-08-20-multi-source-v1'
const MULTI_SOURCE_MIGRATION_CHECKSUM =
  'dcf989e36fb283e81cdf84cc19a08c72fb596e13c75a0e7822f968d0e6f4ccf2'

function tableExists(candidate: DatabaseSync, table: string): boolean {
  return Boolean(
    candidate
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table),
  )
}

function tableColumns(candidate: DatabaseSync, table: string): Set<string> {
  if (!tableExists(candidate, table)) return new Set()
  return new Set(
    (candidate.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )
}

function normalizedTableDefinition(candidate: DatabaseSync, table: string): string {
  const row = candidate
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { sql?: string } | undefined
  return row?.sql?.replaceAll(/\s+/g, '') ?? ''
}

function requiresMultiSourceMigration(candidate: DatabaseSync): boolean {
  const marker = tableExists(candidate, 'schema_migrations')
    ? (candidate
        .prepare('SELECT checksum FROM schema_migrations WHERE id = ?')
        .get(MULTI_SOURCE_MIGRATION_ID) as { checksum?: string } | undefined)
    : undefined
  if (marker && marker.checksum !== MULTI_SOURCE_MIGRATION_CHECKSUM) {
    throw new Error('複数読み取り元のDB移行履歴を検証できませんでした。')
  }
  if (!tableExists(candidate, 'history_sources') || !marker) return true
  const usageDefinition = normalizedTableDefinition(candidate, 'usage_events')
  const referenceDefinition = normalizedTableDefinition(candidate, 'session_references')
  return (
    !tableColumns(candidate, 'usage_events').has('source_id') ||
    !tableColumns(candidate, 'session_references').has('source_id') ||
    !tableColumns(candidate, 'scans').has('source_id') ||
    !tableColumns(candidate, 'scans').has('error_code') ||
    !usageDefinition.includes('UNIQUE(source_id,provider,session_key,project_key,month)') ||
    !referenceDefinition.includes('PRIMARYKEY(source_id,provider,session_key)')
  )
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function createVerifiedMigrationBackup(
  candidate: DatabaseSync,
  directory: string,
  kind = 'multi-source',
): void {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '')
  const backupPath = join(directory, `devtax-radar.before-${kind}-${timestamp}-${randomUUID()}.db`)
  candidate.exec(`VACUUM INTO ${sqlString(backupPath)}`)

  const backup = new DatabaseSync(backupPath, { readOnly: true })
  try {
    const result = backup.prepare('PRAGMA integrity_check').get() as
      { integrity_check?: string } | undefined
    if (result?.integrity_check !== 'ok') {
      throw new Error('schema移行前バックアップを検証できませんでした。')
    }
  } finally {
    backup.close()
  }
}

export function getDatabase(): DatabaseSync {
  if (databaseSingleton) {
    return databaseSingleton
  }

  const directory = getAppDataDirectory()
  mkdirSync(directory, { recursive: true })
  const databasePath = join(directory, 'devtax-radar.db')
  const databaseAlreadyExisted = existsSync(databasePath)
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  })

  try {
    database.exec('PRAGMA journal_mode = WAL')

    if (databaseAlreadyExisted && requiresMultiSourceMigration(database)) {
      createVerifiedMigrationBackup(database, directory)
    } else if (databaseAlreadyExisted && requiresDirectCostMigration(database)) {
      createVerifiedMigrationBackup(database, directory, 'direct-cost-unknown')
    } else if (databaseAlreadyExisted && requiresHomeCostMigration(database)) {
      createVerifiedMigrationBackup(database, directory, 'home-cost-unknown')
    } else if (databaseAlreadyExisted && requiresEquipmentCostMigration(database)) {
      createVerifiedMigrationBackup(database, directory, 'equipment-cost-unknown')
    } else if (databaseAlreadyExisted && requiresDefaultChargeMigration(database)) {
      createVerifiedMigrationBackup(database, directory, 'default-charge-unknown')
    } else if (databaseAlreadyExisted && requiresMonthlyChargeMigration(database)) {
      createVerifiedMigrationBackup(database, directory, 'monthly-charge-unknown')
    } else if (databaseAlreadyExisted && requiresChargePeriodMigration(database)) {
      createVerifiedMigrationBackup(database, directory, 'charge-period-unknown')
    } else if (
      databaseAlreadyExisted &&
      !tableColumns(database, 'provider_charge_periods').has('evidence_ids_json')
    ) {
      createVerifiedMigrationBackup(database, directory, 'charge-period-evidence')
    } else if (databaseAlreadyExisted && !tableColumns(database, 'provider_charge_periods').has('contract_confirmation_json')) {
      createVerifiedMigrationBackup(database, directory, 'charge-contract-confirmation')
    } else if (databaseAlreadyExisted && !tableColumns(database, 'balance_draft').has('revision')) {
      createVerifiedMigrationBackup(database, directory, 'balance-records')
    } else if (
      databaseAlreadyExisted &&
      !tableColumns(database, 'balance_draft_receipts').has('request_id')
    ) {
      createVerifiedMigrationBackup(database, directory, 'balance-draft-receipts')
    } else if (databaseAlreadyExisted && !tableExists(database, 'planning_cost_presence')) {
      createVerifiedMigrationBackup(database, directory, 'cost-presence')
    } else if (databaseAlreadyExisted && !tableExists(database, 'planning_equipment_methods')) {
      createVerifiedMigrationBackup(database, directory, 'equipment-methods')
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL DEFAULT 'local',
      provider TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      files_seen INTEGER NOT NULL DEFAULT 0,
      events_written INTEGER NOT NULL DEFAULT 0,
      malformed_lines INTEGER NOT NULL DEFAULT 0,
      time_zone TEXT,
      error_code TEXT,
      status TEXT NOT NULL
    ) STRICT;

    ${USAGE_EVENTS_SCHEMA}

    CREATE TABLE IF NOT EXISTS session_references (
      source_id TEXT NOT NULL DEFAULT 'local',
      provider TEXT NOT NULL,
      session_key TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      byte_size INTEGER NOT NULL DEFAULT 0,
      file_mtime TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,
      PRIMARY KEY(source_id, provider, session_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS history_sources (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
      kind TEXT NOT NULL CHECK(kind IN ('default', 'configured')),
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      root_key TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, root_key)
    ) STRICT;

    -- File cache rows contain an opaque source-scoped file key and sanitized
    -- normalized usage only. They must never contain a history root, a
    -- transcript path, a native session ID, or a working directory.
    CREATE TABLE IF NOT EXISTS history_file_cache (
      source_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
      file_key TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      file_mtime TEXT NOT NULL,
      adapter TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      events_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(source_id, provider, file_key)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS history_file_cache_source_provider
      ON history_file_cache(source_id, provider);

    ${PROVIDER_SETTINGS_TABLE.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')}



    ${MONTHLY_CHARGE_TABLE.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')}

    ${CHARGE_PERIOD_TABLE.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')}

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    INSERT OR IGNORE INTO app_settings(key, value)
    VALUES ('unobserved_ratio', 'null');

    CREATE TABLE IF NOT EXISTS planning_profiles (
      singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
      tax_year INTEGER NOT NULL,
      journey_mode TEXT NOT NULL,
      income_category TEXT NOT NULL,
      filing_type TEXT NOT NULL,
      activity_started_on TEXT,
      monetization_status TEXT NOT NULL,
      has_bookkeeping INTEGER NOT NULL,
      notes TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS planning_tax_units (
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

    ${PLANNING_PROJECT_RULES_SCHEMA}

    CREATE TABLE IF NOT EXISTS planning_lifecycle_events (
      id TEXT PRIMARY KEY,
      tax_unit_id TEXT NOT NULL REFERENCES planning_tax_units(id),
      event_type TEXT NOT NULL,
      occurred_on TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      note TEXT
    ) STRICT;

    ${EQUIPMENT_TABLE.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')}

    ${HOME_COST_TABLE.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')}

    ${DIRECT_COST_TABLE.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')}

    CREATE TABLE IF NOT EXISTS planning_evidence (
      id TEXT PRIMARY KEY,
      evidence_type TEXT NOT NULL,
      strength TEXT NOT NULL,
      occurred_on TEXT,
      recorded_at TEXT NOT NULL,
      local_reference TEXT,
      note TEXT NOT NULL,
      tax_unit_id TEXT REFERENCES planning_tax_units(id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS planning_decisions (
      id TEXT PRIMARY KEY,
      tax_unit_id TEXT NOT NULL REFERENCES planning_tax_units(id),
      tax_year INTEGER NOT NULL,
      engine_version TEXT NOT NULL,
      candidate TEXT NOT NULL,
      status TEXT NOT NULL,
      selected_candidate TEXT,
      reason TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    ) STRICT;
    `)

      const defaults = getDefaultHistoryPaths()
      const usageColumns = tableColumns(database, 'usage_events')
      if (!usageColumns.has('source_id')) {
        database.exec(`ALTER TABLE usage_events ADD COLUMN source_id TEXT NOT NULL DEFAULT 'local'`)
      }
      database.exec(`
      UPDATE usage_events
      SET source_id = CASE provider
        WHEN 'claude' THEN 'local-claude'
        WHEN 'codex' THEN 'local-codex'
        ELSE 'local'
      END
      WHERE source_id = 'local'
    `)

      const referenceColumns = tableColumns(database, 'session_references')
      if (!referenceColumns.has('source_id')) {
        database.exec(
          `ALTER TABLE session_references ADD COLUMN source_id TEXT NOT NULL DEFAULT 'local'`,
        )
      }
      if (!referenceColumns.has('content_hash')) {
        database.exec(
          `ALTER TABLE session_references ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''`,
        )
      }
      if (!referenceColumns.has('byte_size')) {
        database.exec(
          'ALTER TABLE session_references ADD COLUMN byte_size INTEGER NOT NULL DEFAULT 0',
        )
      }
      if (!referenceColumns.has('file_mtime')) {
        database.exec(
          `ALTER TABLE session_references ADD COLUMN file_mtime TEXT NOT NULL DEFAULT ''`,
        )
      }
      database.exec(`
      UPDATE session_references
      SET source_id = CASE provider
        WHEN 'claude' THEN 'local-claude'
        WHEN 'codex' THEN 'local-codex'
        ELSE 'local'
      END
      WHERE source_id = 'local'
    `)

      const scanSourceColumns = tableColumns(database, 'scans')
      if (!scanSourceColumns.has('source_id')) {
        database.exec(`ALTER TABLE scans ADD COLUMN source_id TEXT NOT NULL DEFAULT 'local'`)
      }
      database.exec(`
      UPDATE scans
      SET source_id = CASE provider
        WHEN 'claude' THEN 'local-claude'
        WHEN 'codex' THEN 'local-codex'
        ELSE 'local'
      END
      WHERE source_id = 'local'
    `)
      if (!scanSourceColumns.has('error_code')) {
        database.exec('ALTER TABLE scans ADD COLUMN error_code TEXT')
      }

      const usageDefinition = normalizedTableDefinition(database, 'usage_events')
      if (!usageColumns.has('started_at')) {
        database.exec('DROP TABLE usage_events')
        database.exec(USAGE_EVENTS_SCHEMA)
      } else if (
        !usageDefinition.includes('UNIQUE(source_id,provider,session_key,project_key,month)')
      ) {
        database.exec(`
        ALTER TABLE usage_events RENAME TO usage_events_before_multi_source;
        CREATE TABLE usage_events (
          id INTEGER PRIMARY KEY,
          source_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          session_key TEXT NOT NULL,
          project_key TEXT NOT NULL,
          month TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT NOT NULL,
          message_count INTEGER NOT NULL,
          project_label TEXT,
          model TEXT,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          cache_write_tokens INTEGER NOT NULL DEFAULT 0,
          schema_version TEXT NOT NULL,
          confidence TEXT NOT NULL,
          UNIQUE(source_id, provider, session_key, project_key, month)
        ) STRICT;
        INSERT INTO usage_events(
          id, source_id, provider, session_key, project_key, month, started_at, ended_at,
          message_count, project_label, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, schema_version, confidence
        )
        SELECT id, source_id, provider, session_key, project_key, month, started_at, ended_at,
               message_count, project_label, model, input_tokens, output_tokens,
               cache_read_tokens, cache_write_tokens, schema_version, confidence
        FROM usage_events_before_multi_source;
        DROP TABLE usage_events_before_multi_source;
      `)
      }

      const referenceDefinition = normalizedTableDefinition(database, 'session_references')
      if (!referenceDefinition.includes('PRIMARYKEY(source_id,provider,session_key)')) {
        database.exec(`
        ALTER TABLE session_references RENAME TO session_references_before_multi_source;
        CREATE TABLE session_references (
          source_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          session_key TEXT NOT NULL,
          native_session_id TEXT NOT NULL,
          source_path TEXT NOT NULL,
          working_directory TEXT NOT NULL,
          content_hash TEXT NOT NULL DEFAULT '',
          byte_size INTEGER NOT NULL DEFAULT 0,
          file_mtime TEXT NOT NULL DEFAULT '',
          captured_at TEXT NOT NULL,
          PRIMARY KEY(source_id, provider, session_key)
        ) STRICT;
        INSERT INTO session_references(
          source_id, provider, session_key, native_session_id, source_path,
          working_directory, content_hash, byte_size, file_mtime, captured_at
        )
        SELECT source_id, provider, session_key, native_session_id, source_path,
               working_directory, content_hash, byte_size, file_mtime, captured_at
        FROM session_references_before_multi_source;
        DROP TABLE session_references_before_multi_source;
      `)
      }

      database.exec(
        'CREATE INDEX IF NOT EXISTS usage_events_month_provider ON usage_events(month, provider)',
      )
      database.exec('CREATE INDEX IF NOT EXISTS usage_events_project ON usage_events(project_key)')
      database.exec(
        'CREATE INDEX IF NOT EXISTS usage_events_source_provider ON usage_events(source_id, provider)',
      )
      database.exec(
        'CREATE INDEX IF NOT EXISTS scans_source_provider_started ON scans(source_id, provider, started_at)',
      )

      const upsertDefault = database.prepare(`
      INSERT INTO history_sources(
        id, provider, kind, name, root_path, root_key, enabled, created_at, updated_at
      ) VALUES (?, ?, 'default', ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        kind = 'default',
        name = excluded.name,
        root_path = excluded.root_path,
        root_key = excluded.root_key,
        enabled = 1,
        updated_at = excluded.updated_at
    `)
      const existingDefaultRoot = database.prepare(
        'SELECT root_key AS rootKey FROM history_sources WHERE id = ?',
      )
      const deleteSourceFileCache = database.prepare(
        'DELETE FROM history_file_cache WHERE source_id = ?',
      )
      const now = new Date().toISOString()
      const defaultRows = [
        {
          id: 'local-claude',
          provider: 'claude' as const,
          name: 'このPC · Claude Code',
          root: normalizeHistoryRoot(defaults.claude),
        },
        {
          id: 'local-codex',
          provider: 'codex' as const,
          name: 'このPC · Codex',
          root: normalizeHistoryRoot(defaults.codex),
        },
      ]
      const restoredBindings = database
        .prepare("SELECT value FROM app_settings WHERE key='restore_source_reconnect'")
        .get()
      for (const source of restoreRequiresReconnect() || restoredBindings ? [] : defaultRows) {
        const rootKey = historyRootKey(source.root)
        const previous = existingDefaultRoot.get(source.id) as { rootKey?: string } | undefined
        // A default source keeps its stable ID when a user changes home
        // directories. Its relative file identities would otherwise collide
        // across roots, so discard only this source's file cache first.
        if (previous?.rootKey && previous.rootKey !== rootKey) {
          deleteSourceFileCache.run(source.id)
        }
        upsertDefault.run(source.id, source.provider, source.name, source.root, rootKey, now, now)
      }
      database
        .prepare(
          `INSERT OR IGNORE INTO schema_migrations(id, checksum, applied_at)
         VALUES (?, ?, ?)`,
        )
        .run(MULTI_SOURCE_MIGRATION_ID, MULTI_SOURCE_MIGRATION_CHECKSUM, now)
      migrateDirectCosts(database)
      migrateHomeCosts(database)
      migrateEquipmentCosts(database)
      migrateDefaultCharges(database)
      database.exec(
        "INSERT OR IGNORE INTO provider_settings(provider, monthly_fee_jpy, unknown_amount_reason) VALUES ('claude', NULL, '既定月額が未入力です。'), ('codex', NULL, '既定月額が未入力です。')",
      )
      migrateMonthlyCharges(database)
      migrateChargePeriods(database)
      if (!tableColumns(database, 'provider_charge_periods').has('evidence_ids_json')) {
        database.exec(
          "ALTER TABLE provider_charge_periods ADD COLUMN evidence_ids_json TEXT CHECK(evidence_ids_json IS NULL OR (json_valid(evidence_ids_json) AND json_type(evidence_ids_json)='array'))",
        )
      }
      if (!tableColumns(database, 'provider_charge_periods').has('contract_confirmation_json')) {
        database.exec("ALTER TABLE provider_charge_periods ADD COLUMN contract_confirmation_json TEXT CHECK(contract_confirmation_json IS NULL OR (json_valid(contract_confirmation_json) AND json_type(contract_confirmation_json)='object'))")
      }
      initializeBalanceSchema(database)
      initializeDatasetIdentity(database)
      initializeCostPresenceSchema(database)
      initializeEquipmentMethodsSchema(database)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }

    const taxUnitColumns = new Set(
      (
        database.prepare(`PRAGMA table_info(planning_tax_units)`).all() as Array<{ name: string }>
      ).map((column) => column.name),
    )
    if (!taxUnitColumns.has('journey_mode')) {
      database.exec(
        `ALTER TABLE planning_tax_units ADD COLUMN journey_mode TEXT NOT NULL DEFAULT 'early'`,
      )
    }
    if (!taxUnitColumns.has('monetization_status')) {
      database.exec(
        `ALTER TABLE planning_tax_units ADD COLUMN monetization_status TEXT NOT NULL DEFAULT 'planned'`,
      )
    }

    // v0.1.0 is unreleased; only developers hold a database where tax_unit_id
    // on planning_project_rules is still NOT NULL. Rules are re-enterable
    // configuration, so dropping and recreating them here is acceptable.
    // planning_project_rules is the child side of the foreign key to
    // planning_tax_units, so dropping it does not touch tax unit rows and does
    // not violate the enabled foreign key constraints.
    const projectRuleColumns = database
      .prepare(`PRAGMA table_info(planning_project_rules)`)
      .all() as Array<{ name: string; notnull: number }>
    const taxUnitIdColumn = projectRuleColumns.find((column) => column.name === 'tax_unit_id')
    if (taxUnitIdColumn?.notnull === 1) {
      database.exec('DROP TABLE planning_project_rules')
      database.exec(PLANNING_PROJECT_RULES_SCHEMA)
    }

    // v0.1.0 is unreleased; only developers hold a database in the old shape.
    // Detect it at startup and rebuild rather than migrating message rows.
    const usageColumns = new Set(
      (database.prepare(`PRAGMA table_info(usage_events)`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    )
    if (usageColumns.size > 0 && !usageColumns.has('started_at')) {
      database.exec('DROP TABLE usage_events')
      database.exec(USAGE_EVENTS_SCHEMA)
    }

    const scanColumns = new Set(
      (database.prepare(`PRAGMA table_info(scans)`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    )
    if (!scanColumns.has('time_zone')) {
      database.exec('ALTER TABLE scans ADD COLUMN time_zone TEXT')
    }

    const providerSettingsColumns = new Set(
      (
        database.prepare(`PRAGMA table_info(provider_settings)`).all() as Array<{ name: string }>
      ).map((column) => column.name),
    )
    if (!providerSettingsColumns.has('contract_started_on')) {
      database.exec('ALTER TABLE provider_settings ADD COLUMN contract_started_on TEXT')
    }
    if (!providerSettingsColumns.has('contract_ended_on')) {
      database.exec('ALTER TABLE provider_settings ADD COLUMN contract_ended_on TEXT')
    }

    const sessionReferenceColumns = new Set(
      (
        database.prepare(`PRAGMA table_info(session_references)`).all() as Array<{ name: string }>
      ).map((column) => column.name),
    )
    if (!sessionReferenceColumns.has('content_hash')) {
      database.exec(
        `ALTER TABLE session_references ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''`,
      )
    }
    if (!sessionReferenceColumns.has('byte_size')) {
      database.exec(
        'ALTER TABLE session_references ADD COLUMN byte_size INTEGER NOT NULL DEFAULT 0',
      )
    }
    if (!sessionReferenceColumns.has('file_mtime')) {
      database.exec(`ALTER TABLE session_references ADD COLUMN file_mtime TEXT NOT NULL DEFAULT ''`)
    }

    // Legacy config-driven classification. project_mappings.product_name was a
    // display label typed against a folder, not a confirmed tax unit, so only
    // the classification is carried over. tax_unit_id is left NULL; assigning
    // a folder to a product now happens on the assignment screen (phase 2).
    const legacyMappings = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_mappings'`)
      .get() as { name?: string } | undefined
    if (legacyMappings?.name) {
      database.exec(`
      INSERT OR IGNORE INTO planning_project_rules(
        id, project_key, provider, effective_from, effective_to,
        tax_unit_id, classification, reason
      )
      SELECT 'migrated-' || project_key, project_key, NULL, '1970-01-01', NULL,
             NULL, classification, '旧設定から移行'
      FROM project_mappings
    `)
      database.exec('DROP TABLE project_mappings')
    }

    databaseSingleton = database
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export class HistorySourceError extends Error {
  readonly code: 'not_found' | 'immutable_default' | 'duplicate' | 'immutable_provider'

  constructor(
    code: 'not_found' | 'immutable_default' | 'duplicate' | 'immutable_provider',
    message: string,
  ) {
    super(message)
    this.code = code
  }
}

function historySourceFromRow(row: {
  id: string
  provider: UsageProvider
  kind: HistorySourceKind
  name: string
  root: string
  enabled: number
  createdAt: string
  updatedAt: string
}): HistorySource {
  return { ...row, enabled: row.enabled === 1 }
}

export function getHistorySources(): HistorySource[] {
  return (
    getDatabase()
      .prepare(
        `SELECT id, provider, kind, name, root_path AS root, enabled,
                created_at AS createdAt, updated_at AS updatedAt
         FROM history_sources
         ORDER BY CASE kind WHEN 'default' THEN 0 ELSE 1 END, provider, name, id`,
      )
      .all() as Array<{
      id: string
      provider: UsageProvider
      kind: HistorySourceKind
      name: string
      root: string
      enabled: number
      createdAt: string
      updatedAt: string
    }>
  ).map(historySourceFromRow)
}

export function getHistorySource(id: string): HistorySource | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, provider, kind, name, root_path AS root, enabled,
              created_at AS createdAt, updated_at AS updatedAt
       FROM history_sources WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string
        provider: UsageProvider
        kind: HistorySourceKind
        name: string
        root: string
        enabled: number
        createdAt: string
        updatedAt: string
      }
    | undefined
  return row ? historySourceFromRow(row) : undefined
}

function isCachedUsage(value: unknown, provider: UsageProvider): value is CachedNormalizedUsage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const requiredStrings = [
    'month',
    'observedAt',
    'sessionKey',
    'projectKey',
    'model',
    'captureMethod',
    'adapter',
    'schemaVersion',
  ]
  const requiredNumbers = [
    'inputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'outputTokens',
    'reasoningTokens',
  ]
  if (candidate.provider !== provider || candidate.confidence === undefined) return false
  if (!['A', 'B', 'C'].includes(String(candidate.confidence))) return false
  if (candidate.projectLabel !== undefined && typeof candidate.projectLabel !== 'string')
    return false
  if (candidate.eventKey !== undefined && typeof candidate.eventKey !== 'string') return false
  if (
    candidate.activeSeconds !== undefined &&
    (typeof candidate.activeSeconds !== 'number' ||
      !Number.isSafeInteger(candidate.activeSeconds) ||
      Number(candidate.activeSeconds) < 0)
  ) {
    return false
  }
  if (candidate.localReference !== undefined) return false
  return (
    requiredStrings.every((key) => typeof candidate[key] === 'string') &&
    requiredNumbers.every(
      (key) =>
        typeof candidate[key] === 'number' &&
        Number.isSafeInteger(candidate[key]) &&
        Number(candidate[key]) >= 0,
    )
  )
}

function parseCachedEvents(
  value: string,
  provider: UsageProvider,
): CachedNormalizedUsage[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || !parsed.every((event) => isCachedUsage(event, provider))) {
      return undefined
    }
    // Rebuild every property explicitly. This is defense in depth for the
    // cache's privacy boundary: even a manually altered SQLite row cannot
    // reintroduce a localReference or arbitrary transcript-shaped payload.
    return parsed.map((event) => {
      const cached = event as CachedNormalizedUsage
      return {
        provider: cached.provider,
        ...(cached.eventKey === undefined ? {} : { eventKey: cached.eventKey }),
        month: cached.month,
        observedAt: cached.observedAt,
        sessionKey: cached.sessionKey,
        projectKey: cached.projectKey,
        ...(cached.projectLabel === undefined ? {} : { projectLabel: cached.projectLabel }),
        model: cached.model,
        inputTokens: cached.inputTokens,
        cacheReadTokens: cached.cacheReadTokens,
        cacheWriteTokens: cached.cacheWriteTokens,
        outputTokens: cached.outputTokens,
        reasoningTokens: cached.reasoningTokens,
        ...(cached.activeSeconds === undefined ? {} : { activeSeconds: cached.activeSeconds }),
        captureMethod: cached.captureMethod,
        adapter: cached.adapter,
        schemaVersion: cached.schemaVersion,
        confidence: cached.confidence,
      }
    })
  } catch {
    return undefined
  }
}

function serializedCachedEvents(events: CachedNormalizedUsage[]): string {
  // Keep the explicit shape synchronized with parseCachedEvents. In
  // particular, spreading an event here would make it too easy for a future
  // localReference-like field to leak into this durable cache.
  return JSON.stringify(
    events.map((event) => ({
      provider: event.provider,
      ...(event.eventKey === undefined ? {} : { eventKey: event.eventKey }),
      month: event.month,
      observedAt: event.observedAt,
      sessionKey: event.sessionKey,
      projectKey: event.projectKey,
      ...(event.projectLabel === undefined ? {} : { projectLabel: event.projectLabel }),
      model: event.model,
      inputTokens: event.inputTokens,
      cacheReadTokens: event.cacheReadTokens,
      cacheWriteTokens: event.cacheWriteTokens,
      outputTokens: event.outputTokens,
      reasoningTokens: event.reasoningTokens,
      ...(event.activeSeconds === undefined ? {} : { activeSeconds: event.activeSeconds }),
      captureMethod: event.captureMethod,
      adapter: event.adapter,
      schemaVersion: event.schemaVersion,
      confidence: event.confidence,
    })),
  )
}

/**
 * Returns all durable cache rows for one source, including a `valid: false`
 * marker for a malformed local row so a later successful scan can repair it
 * and a deletion scan can remove it.
 */
export function getHistoryFileCacheEntries(
  sourceId: string,
  provider: UsageProvider,
): HistoryFileCacheEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT file_key AS fileKey, byte_size AS byteSize, file_mtime AS fileMtime,
              adapter, schema_version AS schemaVersion, events_json AS eventsJson
       FROM history_file_cache
       WHERE source_id = ? AND provider = ?`,
    )
    .all(sourceId, provider) as Array<{
    fileKey: string
    byteSize: number
    fileMtime: string
    adapter: string
    schemaVersion: string
    eventsJson: string
  }>
  return rows.map((row) => {
    const events = parseCachedEvents(row.eventsJson, provider)
    return {
      fileKey: row.fileKey,
      byteSize: row.byteSize,
      fileMtime: row.fileMtime,
      adapter: row.adapter,
      schemaVersion: row.schemaVersion,
      events: events ?? [],
      valid: events !== undefined,
    }
  })
}

export function createHistorySource(input: HistorySourceInput): HistorySource {
  const db = getDatabase()
  const now = new Date().toISOString()
  const id = randomUUID()
  const root = normalizeHistoryRoot(input.root)
  const name = input.name.trim()
  try {
    db.prepare(
      `INSERT INTO history_sources(
         id, provider, kind, name, root_path, root_key, enabled, created_at, updated_at
       ) VALUES (?, ?, 'configured', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.provider,
      name,
      root,
      historyRootKey(root),
      input.enabled === false ? 0 : 1,
      now,
      now,
    )
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed')) {
      throw new HistorySourceError(
        'duplicate',
        '同じProviderとフォルダの読み取り元がすでに登録されています。',
      )
    }
    throw error
  }
  return getHistorySource(id)!
}

export function updateHistorySource(id: string, input: HistorySourceInput): HistorySource {
  const db = getDatabase()
  const current = getHistorySource(id)
  if (!current) {
    throw new HistorySourceError('not_found', '読み取り元が見つかりません。')
  }
  if (current.kind === 'default') {
    throw new HistorySourceError('immutable_default', 'このPCの既定の読み取り元は変更できません。')
  }
  if (current.provider !== input.provider) {
    throw new HistorySourceError(
      'immutable_provider',
      'AIサービスは変更できません。別の読み取り元として追加してください。',
    )
  }

  const root = normalizeHistoryRoot(input.root)
  const rootChanged = historyRootKey(current.root) !== historyRootKey(root)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `UPDATE history_sources
       SET provider = ?, name = ?, root_path = ?, root_key = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.provider,
      input.name.trim(),
      root,
      historyRootKey(root),
      input.enabled === false ? 0 : 1,
      new Date().toISOString(),
      id,
    )
    if (rootChanged) {
      // File identities are relative to the configured root. Reusing them
      // after a root move could attribute a different machine's transcript to
      // this source, so only this source's cache is invalidated.
      db.prepare('DELETE FROM history_file_cache WHERE source_id = ?').run(id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    if (String(error).includes('UNIQUE constraint failed')) {
      throw new HistorySourceError(
        'duplicate',
        '同じProviderとフォルダの読み取り元がすでに登録されています。',
      )
    }
    throw error
  }
  return getHistorySource(id)!
}

export function removeHistorySource(id: string): void {
  const db = getDatabase()
  const current = getHistorySource(id)
  if (!current) {
    throw new HistorySourceError('not_found', '読み取り元が見つかりません。')
  }
  if (current.kind === 'default') {
    throw new HistorySourceError('immutable_default', 'このPCの既定の読み取り元は削除できません。')
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM usage_events WHERE source_id = ?').run(id)
    db.prepare('DELETE FROM session_references WHERE source_id = ?').run(id)
    db.prepare('DELETE FROM history_file_cache WHERE source_id = ?').run(id)
    db.prepare('DELETE FROM scans WHERE source_id = ?').run(id)
    db.prepare('DELETE FROM history_sources WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getHistorySourceScanStatuses(): HistorySourceScanStatus[] {
  const rows = getDatabase()
    .prepare(
      `SELECT source_id AS sourceId, provider, status, completed_at AS completedAt,
              files_seen AS filesSeen, events_written AS eventsWritten,
              error_code AS errorCode
       FROM (
         SELECT scans.*,
                ROW_NUMBER() OVER(
                  PARTITION BY source_id, provider ORDER BY started_at DESC, id DESC
                ) AS rank
         FROM scans
       )
       WHERE rank = 1`,
    )
    .all() as Array<{
    sourceId: string
    provider: UsageProvider
    status: HistorySourceScanStatus['status']
    completedAt: string | null
    filesSeen: number
    eventsWritten: number
    errorCode: HistorySourceScanStatus['errorCode'] | null
  }>
  return rows.map((row) => ({
    sourceId: row.sourceId,
    provider: row.provider,
    status: row.status,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    filesSeen: row.filesSeen,
    eventsWritten: row.eventsWritten,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  }))
}

export function recordHistorySourceScanFailure(
  sourceId: string,
  provider: UsageProvider,
  status: 'unavailable' | 'failed',
  errorCode: 'not_found' | 'not_readable' | 'scan_failed',
): void {
  const now = new Date().toISOString()
  getDatabase()
    .prepare(
      `INSERT INTO scans(
         source_id, provider, started_at, completed_at, time_zone, error_code, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sourceId, provider, now, now, resolvedTimeZone(), errorCode, status)
}

export type ReferenceChange = {
  provider: UsageProvider
  sessionKey: string
  previousHash: string
  currentHash: string
}

export function replaceProviderSessions(
  provider: UsageProvider,
  sessions: UsageSession[],
  diagnostics: { filesSeen: number; malformedLines: number },
): { changedReferences: ReferenceChange[] } {
  return replaceHistorySourceSessions(`local-${provider}`, provider, sessions, diagnostics)
}

export function replaceHistorySourceSessions(
  sourceId: string,
  provider: UsageProvider,
  sessions: UsageSession[],
  diagnostics: { filesSeen: number; malformedLines: number },
  fileCache?: HistoryFileCacheMutation,
): { changedReferences: ReferenceChange[] } {
  const db = getDatabase()
  const insertScan = db.prepare(`
    INSERT INTO scans(source_id, provider, started_at, time_zone, status)
    VALUES (?, ?, ?, ?, 'running')
  `)
  const scanResult = insertScan.run(
    sourceId,
    provider,
    new Date().toISOString(),
    resolvedTimeZone(),
  )
  const scanId = Number(scanResult.lastInsertRowid)

  // Read before the DELETE below overwrites session_references, so the
  // previous content_hash for each session key is still available to diff
  // against the freshly computed one. An empty string is the default left by
  // the migration for rows recorded before hashing existed -- that is not a
  // change, just a gap in history, so it must not be reported as one.
  type StoredSessionReference = {
    nativeSessionId: string
    sourcePath: string
    workingDirectory: string
    contentHash: string
    byteSize: number
    fileMtime: string
  }
  const previousReferences = new Map(
    (
      db
        .prepare(
          `SELECT session_key AS sessionKey, native_session_id AS nativeSessionId,
                  source_path AS sourcePath, working_directory AS workingDirectory,
                  content_hash AS contentHash, byte_size AS byteSize,
                  file_mtime AS fileMtime
           FROM session_references WHERE source_id = ? AND provider = ?`,
        )
        .all(sourceId, provider) as Array<{ sessionKey: string } & StoredSessionReference>
    ).map((row) => [row.sessionKey, row]),
  )
  const previousHashes = new Map(
    [...previousReferences.entries()].map(([sessionKey, reference]) => [
      sessionKey,
      reference.contentHash,
    ]),
  )
  const changedReferences: ReferenceChange[] = []

  const insertSession = db.prepare(`
    INSERT INTO usage_events(
      source_id, provider, session_key, project_key, month, started_at, ended_at,
      message_count, project_label, model, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, schema_version, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, provider, session_key, project_key, month) DO UPDATE SET
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      message_count = excluded.message_count,
      project_label = excluded.project_label,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_write_tokens = excluded.cache_write_tokens,
      schema_version = excluded.schema_version,
      confidence = excluded.confidence
  `)
  const insertReference = db.prepare(`
    INSERT INTO session_references(
      source_id, provider, session_key, native_session_id, source_path,
      working_directory, content_hash, byte_size, file_mtime, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, provider, session_key) DO UPDATE SET
      native_session_id = excluded.native_session_id,
      source_path = excluded.source_path,
      working_directory = excluded.working_directory,
      content_hash = excluded.content_hash,
      byte_size = excluded.byte_size,
      file_mtime = excluded.file_mtime,
      captured_at = excluded.captured_at
  `)
  const deleteCachedFile = db.prepare(
    `DELETE FROM history_file_cache
     WHERE source_id = ? AND provider = ? AND file_key = ?`,
  )
  const upsertCachedFile = db.prepare(`
    INSERT INTO history_file_cache(
      source_id, provider, file_key, byte_size, file_mtime, adapter,
      schema_version, events_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, provider, file_key) DO UPDATE SET
      byte_size = excluded.byte_size,
      file_mtime = excluded.file_mtime,
      adapter = excluded.adapter,
      schema_version = excluded.schema_version,
      events_json = excluded.events_json,
      updated_at = excluded.updated_at
  `)
  const capturedAt = new Date().toISOString()

  try {
    db.exec('BEGIN IMMEDIATE')
    db.prepare('DELETE FROM usage_events WHERE source_id = ? AND provider = ?').run(
      sourceId,
      provider,
    )
    db.prepare('DELETE FROM session_references WHERE source_id = ? AND provider = ?').run(
      sourceId,
      provider,
    )
    for (const item of sessions) {
      insertSession.run(
        sourceId,
        item.provider,
        item.sessionKey,
        item.projectKey,
        item.month,
        item.startedAt,
        item.endedAt,
        item.messageCount,
        item.projectLabel ?? null,
        item.model ?? null,
        item.inputTokens,
        item.outputTokens,
        item.cacheReadTokens,
        item.cacheWriteTokens,
        item.schemaVersion,
        item.confidence,
      )
      // A reused cache event deliberately has no raw local reference. Retain
      // the already-persisted local-only reference for the same surviving
      // session, rather than making an unchanged scan erase preview/resume.
      const localReference = item.localReference ?? previousReferences.get(item.sessionKey)
      if (localReference) {
        insertReference.run(
          sourceId,
          item.provider,
          item.sessionKey,
          localReference.nativeSessionId,
          localReference.sourcePath,
          localReference.workingDirectory,
          localReference.contentHash,
          localReference.byteSize,
          localReference.fileMtime,
          capturedAt,
        )
        const previousHash = previousHashes.get(item.sessionKey)
        // An empty hash on either side means "not recorded", not "changed".
        // Previously empty: the row predates hashing. Currently empty: this
        // scan could not hash the file (a partial read, or the file vanished
        // between the read and the stat). Calling that a content change would
        // put a deletion behind a message that says changes are normal.
        if (
          previousHash !== undefined &&
          previousHash !== '' &&
          localReference.contentHash !== '' &&
          previousHash !== localReference.contentHash
        ) {
          changedReferences.push({
            provider: item.provider,
            sessionKey: item.sessionKey,
            previousHash,
            currentHash: localReference.contentHash,
          })
        }
      }
    }
    if (fileCache) {
      for (const fileKey of new Set(fileCache.deleteFileKeys)) {
        deleteCachedFile.run(sourceId, provider, fileKey)
      }
      const updatedAt = new Date().toISOString()
      for (const cached of fileCache.upsert) {
        upsertCachedFile.run(
          sourceId,
          provider,
          cached.fileKey,
          cached.byteSize,
          cached.fileMtime,
          cached.adapter,
          cached.schemaVersion,
          serializedCachedEvents(cached.events),
          updatedAt,
        )
      }
    }
    db.prepare(
      `
      UPDATE scans
      SET completed_at = ?, files_seen = ?, events_written = ?,
          malformed_lines = ?, status = 'complete'
      WHERE id = ?
    `,
    ).run(
      new Date().toISOString(),
      diagnostics.filesSeen,
      sessions.length,
      diagnostics.malformedLines,
      scanId,
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.prepare(
      `
      UPDATE scans SET completed_at = ?, status = 'failed' WHERE id = ?
    `,
    ).run(new Date().toISOString(), scanId)
    throw error
  }

  return { changedReferences }
}

/**
 * Timezones recorded by the most recent COMPLETED scan of each provider.
 *
 * Both filters matter. A scan row is inserted with the current zone before any
 * work happens, so without `status = 'complete'` a rescan that was killed or
 * failed would clear the warning while the stored months are still attributed
 * the old way. And a user can scan one provider alone, which must not clear the
 * warning for the other provider's still-stale months.
 */
export function getLastScanTimeZones(db: DatabaseSync = getDatabase()): Record<string, string> {
  const rows = db
    .prepare(
      `SELECT logical_source_id AS sourceId, provider, time_zone AS timeZone
       FROM (
         SELECT scans.*,
                CASE
                  WHEN source_id = 'local' THEN 'local-' || provider
                  ELSE source_id
                END AS logical_source_id,
                ROW_NUMBER() OVER(
                  PARTITION BY
                    CASE
                      WHEN source_id = 'local' THEN 'local-' || provider
                      ELSE source_id
                    END,
                    provider
                  ORDER BY started_at DESC, id DESC
                ) AS rank
         FROM scans
         WHERE time_zone IS NOT NULL AND status = 'complete'
       )
       WHERE rank = 1`,
    )
    .all() as Array<{ sourceId: string; provider: string; timeZone: string }>
  return Object.fromEntries(
    rows.map((row) => [
      row.sourceId === `local-${row.provider}` ? row.provider : `${row.sourceId}:${row.provider}`,
      row.timeZone,
    ]),
  )
}

export function getUsageOverview(db: DatabaseSync = getDatabase()): UsageOverview {
  const providers = db
    .prepare(
      `
    SELECT provider, month,
           COUNT(*) AS sessions,
           COUNT(DISTINCT project_key) AS projects,
           SUM(input_tokens) AS inputTokens,
           SUM(output_tokens) AS outputTokens,
           SUM(cache_read_tokens) AS cacheReadTokens,
           SUM(cache_write_tokens) AS cacheWriteTokens,
           MIN(started_at) AS firstObservedAt,
           MAX(ended_at) AS lastObservedAt
    FROM usage_events
    GROUP BY provider, month
    ORDER BY month, provider
  `,
    )
    .all() as UsageOverview['providers']

  const recentScans = db
    .prepare(
      `
    SELECT source_id AS sourceId, provider, started_at AS startedAt,
           completed_at AS completedAt,
           files_seen AS filesSeen, events_written AS eventsWritten,
           malformed_lines AS malformedLines, status
    FROM scans
    ORDER BY id DESC
    LIMIT 10
  `,
    )
    .all() as UsageOverview['recentScans']

  return { providers, recentScans }
}

export type UsageSessionRow = {
  sourceId: string
  sourceName: string
  provider: UsageProvider
  sessionKey: string
  projectKey: string
  month: string
  startedAt: string
  endedAt: string
  messageCount: number
  projectLabel: string | null
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export function getUsageSessions(db: DatabaseSync = getDatabase()): UsageSessionRow[] {
  return db
    .prepare(
      `
    SELECT usage_events.source_id AS sourceId, history_sources.name AS sourceName,
           usage_events.provider, session_key AS sessionKey, project_key AS projectKey,
           month, started_at AS startedAt, ended_at AS endedAt,
           message_count AS messageCount, project_label AS projectLabel, model,
           input_tokens AS inputTokens, output_tokens AS outputTokens,
           cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
    FROM usage_events
    JOIN history_sources ON history_sources.id = usage_events.source_id
    ORDER BY month, usage_events.provider, project_key, started_at, session_key
  `,
    )
    .all() as UsageSessionRow[]
}

export function getSessionsForProject(projectKey: string): UsageSessionRow[] {
  return getDatabase()
    .prepare(
      `SELECT usage_events.source_id AS sourceId, history_sources.name AS sourceName,
              usage_events.provider, session_key AS sessionKey, project_key AS projectKey,
              month, started_at AS startedAt, ended_at AS endedAt,
              message_count AS messageCount, project_label AS projectLabel, model,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
       FROM usage_events
       JOIN history_sources ON history_sources.id = usage_events.source_id
       WHERE project_key = ?
       ORDER BY started_at DESC, session_key`,
    )
    .all(projectKey) as UsageSessionRow[]
}

export type SessionReferenceRow = {
  sourceId: string
  nativeSessionId: string
  sourcePath: string
  workingDirectory: string
  capturedAt: string
}

export function getSessionReference(
  provider: UsageProvider,
  sessionKey: string,
  sourceId?: string,
): SessionReferenceRow | undefined {
  const sourceClause = sourceId ? 'AND source_id = ?' : ''
  return getDatabase()
    .prepare(
      `
    SELECT source_id AS sourceId, native_session_id AS nativeSessionId, source_path AS sourcePath,
           working_directory AS workingDirectory, captured_at AS capturedAt
    FROM session_references WHERE provider = ? AND session_key = ? ${sourceClause}
  `,
    )
    .get(...(sourceId ? [provider, sessionKey, sourceId] : [provider, sessionKey])) as
    SessionReferenceRow | undefined
}

export function getConfiguration(
  db: DatabaseSync = getDatabase(),
): LocalConfiguration & { chargePeriods: ProviderChargePeriod[] } {
  const providerRows = db
    .prepare(
      `SELECT provider, monthly_fee_jpy AS amount, unknown_amount_reason AS unknownAmountReason,
              contract_started_on AS startedOn, contract_ended_on AS endedOn
       FROM provider_settings`,
    )
    .all() as Array<{
    provider: string
    amount: number | null
    unknownAmountReason: string | null
    startedOn: string | null
    endedOn: string | null
  }>
  const byProvider = new Map(providerRows.map((row) => [row.provider, row]))

  function contractFor(provider: 'claude' | 'codex'): ProviderContract {
    const row = byProvider.get(provider)
    const contract: ProviderContract = {}
    if (row?.startedOn) contract.startedOn = row.startedOn
    if (row?.endedOn) contract.endedOn = row.endedOn
    return contract
  }

  const ratioRow = db
    .prepare(
      `
    SELECT value FROM app_settings WHERE key = 'unobserved_ratio'
  `,
    )
    .get() as { value?: string } | undefined
  const monthlyCharges = db
    .prepare(
      `
    SELECT provider, month, amount_jpy AS amountJpy, unknown_amount_reason AS unknownAmountReason
    FROM provider_month_charges
    ORDER BY month, provider
  `,
    )
    .all()
    .map((row) => {
      const { unknownAmountReason, ...charge } = row
      return { ...charge, ...(unknownAmountReason === null ? {} : { unknownAmountReason }) }
    }) as LocalConfiguration['monthlyCharges']
  const chargePeriods = db
    .prepare(
      `SELECT id, provider, plan_name AS planName,
              service_started_on AS serviceStartedOn,
              service_ended_on AS serviceEndedOn,
              billed_on AS billedOn, amount_jpy AS amountJpy, unknown_amount_reason AS unknownAmountReason, note, evidence_ids_json AS evidenceIdsJson, contract_confirmation_json AS contractConfirmationJson
       FROM provider_charge_periods
       ORDER BY service_started_on, provider, id`,
    )
    .all() as Array<
    Omit<ProviderChargePeriod, 'evidenceIds' | 'contractConfirmation'> & {
      billedOn: string | null
      note: string | null
      evidenceIdsJson: string | null
      contractConfirmationJson: string | null
    }
  >

  return {
    charges: {
      claude:
        byProvider.get('claude')?.amount === null
          ? null
          : Number(byProvider.get('claude')?.amount ?? 0),
      codex:
        byProvider.get('codex')?.amount === null
          ? null
          : Number(byProvider.get('codex')?.amount ?? 0),
    },
    ...(providerRows.some((row) => row.unknownAmountReason !== null)
      ? {
          unknownChargeReasons: Object.fromEntries(
            providerRows
              .filter((row) => row.unknownAmountReason !== null)
              .map((row) => [row.provider, row.unknownAmountReason!]),
          ),
        }
      : {}),
    monthlyCharges,
    contracts: { claude: contractFor('claude'), codex: contractFor('codex') },
    chargePeriods: chargePeriods.map((period) => ({
      id: period.id,
      provider: period.provider,
      planName: period.planName,
      serviceStartedOn: period.serviceStartedOn,
      serviceEndedOn: period.serviceEndedOn,
      amountJpy: period.amountJpy,
      ...(period.unknownAmountReason ? { unknownAmountReason: period.unknownAmountReason } : {}),
      ...(period.billedOn ? { billedOn: period.billedOn } : {}),
      ...(period.note ? { note: period.note } : {}),
      ...(period.contractConfirmationJson === null ? {} : { contractConfirmation: JSON.parse(period.contractConfirmationJson) as ProviderChargePeriod['contractConfirmation'] }),
      ...(period.evidenceIdsJson === null
        ? {}
        : { evidenceIds: JSON.parse(period.evidenceIdsJson) as string[] }),
    })),
    unobservedRatio:
      ratioRow?.value == null || ratioRow.value === 'null' ? null : Number(ratioRow.value),
  }
}

export function saveConfiguration(
  configuration: LocalConfiguration,
  db: DatabaseSync = getDatabase(),
): void {
  const updateCharge = db.prepare(`
    UPDATE provider_settings
    SET monthly_fee_jpy = ?, unknown_amount_reason = ?, contract_started_on = ?, contract_ended_on = ?
    WHERE provider = ?
  `)
  const insertMonthlyCharge = db.prepare(`
    INSERT INTO provider_month_charges(provider, month, amount_jpy, unknown_amount_reason)
    VALUES (?, ?, ?, ?)
  `)
  const insertChargePeriod = db.prepare(`
    INSERT INTO provider_charge_periods(
      id, provider, plan_name, service_started_on, service_ended_on,
      billed_on, amount_jpy, note, unknown_amount_reason, evidence_ids_json, contract_confirmation_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  db.exec('SAVEPOINT devtax_config_write')
  try {
    for (const provider of ['claude', 'codex'] as const) {
      const contract = configuration.contracts[provider]
      updateCharge.run(
        configuration.charges[provider],
        configuration.unknownChargeReasons?.[provider] ?? null,
        contract?.startedOn ?? null,
        contract?.endedOn ?? null,
        provider,
      )
    }
    db.prepare(
      `
      INSERT INTO app_settings(key, value) VALUES ('unobserved_ratio', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    ).run(String(configuration.unobservedRatio))
    db.exec('DELETE FROM provider_month_charges')
    for (const charge of configuration.monthlyCharges) {
      insertMonthlyCharge.run(
        charge.provider,
        charge.month,
        charge.amountJpy,
        charge.unknownAmountReason ?? null,
      )
    }
    if (configuration.chargePeriods !== undefined) {
      db.exec('DELETE FROM provider_charge_periods')
      for (const period of configuration.chargePeriods) {
        insertChargePeriod.run(
          period.id,
          period.provider,
          period.planName,
          period.serviceStartedOn,
          period.serviceEndedOn,
          period.billedOn ?? null,
          period.amountJpy,
          period.note ?? null,
          period.unknownAmountReason ?? null,
          period.evidenceIds === undefined ? null : JSON.stringify(period.evidenceIds),
          period.contractConfirmation === undefined ? null : JSON.stringify(period.contractConfirmation),
        )
      }
    }
    advanceWorkspaceRevision(db)
    db.exec('RELEASE devtax_config_write')
  } catch (error) {
    db.exec('ROLLBACK TO devtax_config_write')
    db.exec('RELEASE devtax_config_write')
    throw error
  }
}
