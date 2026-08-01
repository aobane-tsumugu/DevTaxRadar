import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolvedTimeZone } from '../adapters/localTime.js'
import type { UsageProvider } from '../adapters/types.js'
import { getAppDataDirectory } from './paths.js'
import type { UsageSession } from './sessionAggregation.js'

let database: DatabaseSync | undefined

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

export type LocalConfiguration = {
  charges: { claude: number; codex: number }
  monthlyCharges: Array<{
    provider: 'claude' | 'codex'
    month: string
    amountJpy: number
  }>
  unobservedRatio: number
}

const USAGE_EVENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY,
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
    UNIQUE(provider, session_key, project_key, month)
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

export function getDatabase(): DatabaseSync {
  if (database) {
    return database
  }

  const directory = getAppDataDirectory()
  mkdirSync(directory, { recursive: true })
  database = new DatabaseSync(join(directory, 'devtax-radar.db'), {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  })

  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      files_seen INTEGER NOT NULL DEFAULT 0,
      events_written INTEGER NOT NULL DEFAULT 0,
      malformed_lines INTEGER NOT NULL DEFAULT 0,
      time_zone TEXT,
      status TEXT NOT NULL
    ) STRICT;

    ${USAGE_EVENTS_SCHEMA}

    CREATE TABLE IF NOT EXISTS session_references (
      provider TEXT NOT NULL,
      session_key TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY(provider, session_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS provider_settings (
      provider TEXT PRIMARY KEY,
      monthly_fee_jpy INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    INSERT OR IGNORE INTO provider_settings(provider, monthly_fee_jpy)
    VALUES ('claude', 0), ('codex', 0);

    CREATE TABLE IF NOT EXISTS provider_month_charges (
      provider TEXT NOT NULL,
      month TEXT NOT NULL,
      amount_jpy INTEGER NOT NULL,
      PRIMARY KEY(provider, month)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    INSERT OR IGNORE INTO app_settings(key, value)
    VALUES ('unobserved_ratio', '0.10');

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

    CREATE TABLE IF NOT EXISTS planning_equipment (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      equipment_type TEXT NOT NULL,
      acquisition_cost_jpy INTEGER NOT NULL,
      ordered_on TEXT,
      delivered_on TEXT,
      acquired_on TEXT NOT NULL,
      business_use_started_on TEXT,
      converted_from_private INTEGER NOT NULL,
      opening_unamortized_balance_jpy INTEGER,
      business_use_ratio REAL NOT NULL,
      useful_life_years INTEGER,
      role TEXT NOT NULL,
      tax_unit_id TEXT REFERENCES planning_tax_units(id),
      project_allocation_ratio REAL NOT NULL,
      evidence_ids_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS planning_home_costs (
      id TEXT PRIMARY KEY,
      month TEXT NOT NULL,
      category TEXT NOT NULL,
      amount_jpy INTEGER NOT NULL,
      method TEXT NOT NULL,
      business_use_ratio REAL NOT NULL,
      basis TEXT NOT NULL,
      rationale TEXT NOT NULL,
      tax_unit_id TEXT REFERENCES planning_tax_units(id),
      project_allocation_ratio REAL NOT NULL,
      treatment TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS planning_direct_costs (
      id TEXT PRIMARY KEY,
      tax_unit_id TEXT REFERENCES planning_tax_units(id),
      incurred_on TEXT NOT NULL,
      cost_type TEXT NOT NULL,
      amount_jpy INTEGER NOT NULL,
      directly_attributable INTEGER NOT NULL,
      treatment TEXT NOT NULL,
      note TEXT,
      evidence_ids_json TEXT NOT NULL
    ) STRICT;

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

  const taxUnitColumns = new Set(
    (database.prepare(`PRAGMA table_info(planning_tax_units)`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  )
  if (!taxUnitColumns.has('journey_mode')) {
    database.exec(`ALTER TABLE planning_tax_units ADD COLUMN journey_mode TEXT NOT NULL DEFAULT 'early'`)
  }
  if (!taxUnitColumns.has('monetization_status')) {
    database.exec(`ALTER TABLE planning_tax_units ADD COLUMN monetization_status TEXT NOT NULL DEFAULT 'planned'`)
  }

  // v0.1.0 is unreleased; only developers hold a database where tax_unit_id
  // on planning_project_rules is still NOT NULL. Rules are re-enterable
  // configuration, so dropping and recreating them here is acceptable.
  // planning_project_rules is the child side of the foreign key to
  // planning_tax_units, so dropping it does not touch tax unit rows and does
  // not violate the enabled foreign key constraints.
  const projectRuleColumns = database.prepare(`PRAGMA table_info(planning_project_rules)`)
    .all() as Array<{ name: string; notnull: number }>
  const taxUnitIdColumn = projectRuleColumns.find((column) => column.name === 'tax_unit_id')
  if (taxUnitIdColumn?.notnull === 1) {
    database.exec('DROP TABLE planning_project_rules')
    database.exec(PLANNING_PROJECT_RULES_SCHEMA)
  }

  // v0.1.0 is unreleased; only developers hold a database in the old shape.
  // Detect it at startup and rebuild rather than migrating message rows.
  const usageColumns = new Set(
    (database.prepare(`PRAGMA table_info(usage_events)`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  )
  if (usageColumns.size > 0 && !usageColumns.has('started_at')) {
    database.exec('DROP TABLE usage_events')
    database.exec(USAGE_EVENTS_SCHEMA)
  }

  const scanColumns = new Set(
    (database.prepare(`PRAGMA table_info(scans)`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  )
  if (!scanColumns.has('time_zone')) {
    database.exec('ALTER TABLE scans ADD COLUMN time_zone TEXT')
  }

  // Legacy config-driven classification. project_mappings.product_name was a
  // display label typed against a folder, not a confirmed tax unit, so only
  // the classification is carried over. tax_unit_id is left NULL; assigning
  // a folder to a product now happens on the assignment screen (phase 2).
  const legacyMappings = database.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_mappings'`,
  ).get() as { name?: string } | undefined
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

  return database
}

export function replaceProviderSessions(
  provider: UsageProvider,
  sessions: UsageSession[],
  diagnostics: { filesSeen: number; malformedLines: number },
): void {
  const db = getDatabase()
  const insertScan = db.prepare(`
    INSERT INTO scans(provider, started_at, time_zone, status)
    VALUES (?, ?, ?, 'running')
  `)
  const scanResult = insertScan.run(provider, new Date().toISOString(), resolvedTimeZone())
  const scanId = Number(scanResult.lastInsertRowid)

  const insertSession = db.prepare(`
    INSERT INTO usage_events(
      provider, session_key, project_key, month, started_at, ended_at,
      message_count, project_label, model, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, schema_version, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, session_key, project_key, month) DO UPDATE SET
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
      provider, session_key, native_session_id, source_path,
      working_directory, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, session_key) DO UPDATE SET
      native_session_id = excluded.native_session_id,
      source_path = excluded.source_path,
      working_directory = excluded.working_directory,
      captured_at = excluded.captured_at
  `)
  const capturedAt = new Date().toISOString()

  try {
    db.exec('BEGIN IMMEDIATE')
    db.prepare('DELETE FROM usage_events WHERE provider = ?').run(provider)
    db.prepare('DELETE FROM session_references WHERE provider = ?').run(provider)
    for (const item of sessions) {
      insertSession.run(
        item.provider, item.sessionKey, item.projectKey, item.month,
        item.startedAt, item.endedAt, item.messageCount,
        item.projectLabel ?? null, item.model ?? null,
        item.inputTokens, item.outputTokens,
        item.cacheReadTokens, item.cacheWriteTokens,
        item.schemaVersion, item.confidence,
      )
      if (item.localReference) {
        insertReference.run(
          item.provider, item.sessionKey,
          item.localReference.nativeSessionId,
          item.localReference.sourcePath,
          item.localReference.workingDirectory,
          capturedAt,
        )
      }
    }
    db.exec('COMMIT')
    db.prepare(`
      UPDATE scans
      SET completed_at = ?, files_seen = ?, events_written = ?,
          malformed_lines = ?, status = 'complete'
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      diagnostics.filesSeen,
      sessions.length,
      diagnostics.malformedLines,
      scanId,
    )
  } catch (error) {
    db.exec('ROLLBACK')
    db.prepare(`
      UPDATE scans SET completed_at = ?, status = 'failed' WHERE id = ?
    `).run(new Date().toISOString(), scanId)
    throw error
  }
}

export function getUsageOverview(): UsageOverview {
  const db = getDatabase()
  const providers = db.prepare(`
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
  `).all() as UsageOverview['providers']

  const recentScans = db.prepare(`
    SELECT provider, started_at AS startedAt, completed_at AS completedAt,
           files_seen AS filesSeen, events_written AS eventsWritten,
           malformed_lines AS malformedLines, status
    FROM scans
    ORDER BY id DESC
    LIMIT 10
  `).all() as UsageOverview['recentScans']

  return { providers, recentScans }
}

export type UsageSessionRow = {
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

export function getUsageSessions(): UsageSessionRow[] {
  return getDatabase().prepare(`
    SELECT provider, session_key AS sessionKey, project_key AS projectKey,
           month, started_at AS startedAt, ended_at AS endedAt,
           message_count AS messageCount, project_label AS projectLabel, model,
           input_tokens AS inputTokens, output_tokens AS outputTokens,
           cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
    FROM usage_events
    ORDER BY month, provider, project_key, started_at
  `).all() as UsageSessionRow[]
}

export type SessionReferenceRow = {
  nativeSessionId: string
  sourcePath: string
  workingDirectory: string
  capturedAt: string
}

export function getSessionReference(
  provider: UsageProvider,
  sessionKey: string,
): SessionReferenceRow | undefined {
  return getDatabase().prepare(`
    SELECT native_session_id AS nativeSessionId, source_path AS sourcePath,
           working_directory AS workingDirectory, captured_at AS capturedAt
    FROM session_references WHERE provider = ? AND session_key = ?
  `).get(provider, sessionKey) as SessionReferenceRow | undefined
}

export function getConfiguration(): LocalConfiguration {
  const db = getDatabase()
  const charges = Object.fromEntries(
    (db.prepare('SELECT provider, monthly_fee_jpy AS amount FROM provider_settings').all() as Array<{
      provider: string
      amount: number
    }>).map((row) => [row.provider, row.amount]),
  )
  const ratioRow = db.prepare(`
    SELECT value FROM app_settings WHERE key = 'unobserved_ratio'
  `).get() as { value?: string } | undefined
  const monthlyCharges = db.prepare(`
    SELECT provider, month, amount_jpy AS amountJpy
    FROM provider_month_charges
    ORDER BY month, provider
  `).all() as LocalConfiguration['monthlyCharges']

  return {
    charges: {
      claude: Number(charges.claude ?? 0),
      codex: Number(charges.codex ?? 0),
    },
    monthlyCharges,
    unobservedRatio: Number(ratioRow?.value ?? 0.1),
  }
}

export function saveConfiguration(configuration: LocalConfiguration): void {
  const db = getDatabase()
  const updateCharge = db.prepare(`
    UPDATE provider_settings SET monthly_fee_jpy = ? WHERE provider = ?
  `)
  const insertMonthlyCharge = db.prepare(`
    INSERT INTO provider_month_charges(provider, month, amount_jpy)
    VALUES (?, ?, ?)
  `)

  db.exec('BEGIN IMMEDIATE')
  try {
    updateCharge.run(configuration.charges.claude, 'claude')
    updateCharge.run(configuration.charges.codex, 'codex')
    db.prepare(`
      INSERT INTO app_settings(key, value) VALUES ('unobserved_ratio', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(configuration.unobservedRatio))
    db.exec('DELETE FROM provider_month_charges')
    for (const charge of configuration.monthlyCharges) {
      insertMonthlyCharge.run(charge.provider, charge.month, charge.amountJpy)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
