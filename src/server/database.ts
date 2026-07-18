import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getAppDataDirectory } from './paths.js'

export type StoredUsageEvent = {
  provider: 'claude' | 'codex'
  month: string
  sessionKey: string
  projectKey: string
  projectLabel?: string
  model?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  observedAt?: string
  schemaVersion: string
  confidence: 'high' | 'medium' | 'low'
}

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

export type ProjectUsageRow = {
  provider: 'claude' | 'codex'
  month: string
  projectKey: string
  projectLabel: string | null
  model: string | null
  sessions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type ProjectMapping = {
  projectKey: string
  productName: string
  assetName: string
  classification: 'new-development' | 'maintenance' | 'feature-addition' | 'private' | 'unclassified'
}

export type LocalConfiguration = {
  charges: { claude: number; codex: number }
  monthlyCharges: Array<{
    provider: 'claude' | 'codex'
    month: string
    amountJpy: number
  }>
  unobservedRatio: number
  mappings: ProjectMapping[]
}

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
      status TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS usage_events (
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

    CREATE INDEX IF NOT EXISTS usage_events_month_provider
      ON usage_events(month, provider);
    CREATE INDEX IF NOT EXISTS usage_events_project
      ON usage_events(project_key);

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

    CREATE TABLE IF NOT EXISTS project_mappings (
      project_key TEXT PRIMARY KEY,
      product_name TEXT NOT NULL,
      asset_name TEXT NOT NULL,
      classification TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    INSERT OR IGNORE INTO app_settings(key, value)
    VALUES ('unobserved_ratio', '0.10');
  `)

  return database
}

export function replaceProviderEvents(
  provider: StoredUsageEvent['provider'],
  events: StoredUsageEvent[],
  diagnostics: { filesSeen: number; malformedLines: number },
): void {
  const db = getDatabase()
  const insertScan = db.prepare(`
    INSERT INTO scans(provider, started_at, status)
    VALUES (?, ?, 'running')
  `)
  const scanResult = insertScan.run(provider, new Date().toISOString())
  const scanId = Number(scanResult.lastInsertRowid)
  const insertEvent = db.prepare(`
    INSERT OR REPLACE INTO usage_events(
      provider, month, session_key, project_key, project_label, model,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      observed_at, schema_version, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  try {
    db.exec('BEGIN IMMEDIATE')
    db.prepare('DELETE FROM usage_events WHERE provider = ?').run(provider)
    for (const event of events) {
      insertEvent.run(
        event.provider,
        event.month,
        event.sessionKey,
        event.projectKey,
        event.projectLabel ?? null,
        event.model ?? null,
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens,
        event.cacheWriteTokens,
        event.observedAt ?? null,
        event.schemaVersion,
        event.confidence,
      )
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
      events.length,
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
    SELECT
      provider,
      month,
      COUNT(DISTINCT session_key) AS sessions,
      COUNT(DISTINCT project_key) AS projects,
      SUM(input_tokens) AS inputTokens,
      SUM(output_tokens) AS outputTokens,
      SUM(cache_read_tokens) AS cacheReadTokens,
      SUM(cache_write_tokens) AS cacheWriteTokens
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

export function getProjectUsage(): ProjectUsageRow[] {
  return getDatabase().prepare(`
    SELECT
      provider,
      month,
      project_key AS projectKey,
      MAX(project_label) AS projectLabel,
      MAX(model) AS model,
      COUNT(DISTINCT session_key) AS sessions,
      SUM(input_tokens) AS inputTokens,
      SUM(output_tokens) AS outputTokens,
      SUM(cache_read_tokens) AS cacheReadTokens,
      SUM(cache_write_tokens) AS cacheWriteTokens
    FROM usage_events
    GROUP BY provider, month, project_key
    ORDER BY month, provider, project_key
  `).all() as ProjectUsageRow[]
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
  const mappings = db.prepare(`
    SELECT project_key AS projectKey, product_name AS productName,
           asset_name AS assetName, classification
    FROM project_mappings
    ORDER BY product_name, project_key
  `).all() as ProjectMapping[]
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
    mappings,
  }
}

export function saveConfiguration(configuration: LocalConfiguration): void {
  const db = getDatabase()
  const updateCharge = db.prepare(`
    UPDATE provider_settings SET monthly_fee_jpy = ? WHERE provider = ?
  `)
  const upsertMapping = db.prepare(`
    INSERT INTO project_mappings(project_key, product_name, asset_name, classification)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_key) DO UPDATE SET
      product_name = excluded.product_name,
      asset_name = excluded.asset_name,
      classification = excluded.classification
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
    db.exec('DELETE FROM project_mappings')
    for (const mapping of configuration.mappings) {
      upsertMapping.run(
        mapping.projectKey,
        mapping.productName,
        mapping.assetName,
        mapping.classification,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
