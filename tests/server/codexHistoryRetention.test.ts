import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRuleRecord } from '../../src/planning/types.js'

type UsagePoint = { at: string; input: number; output?: number }

const privatePrompt = 'SYNTHETIC_RETENTION_PRIVATE_PROMPT_MUST_NOT_ESCAPE'
const nativeSession = 'synthetic-retention-session'
const workingDirectory = 'C:\\Synthetic\\RetentionProject'
const initialPoints: UsagePoint[] = [
  { at: '2026-04-10T12:00:00.000Z', input: 100, output: 20 },
  { at: '2026-04-20T12:00:00.000Z', input: 250, output: 50 },
]

/** Every input is generated here, never copied from a real home or transcript. */
function writeTranscript(path: string, points = initialPoints, sessionId = nativeSession): string {
  const content =
    [
      {
        type: 'session_meta',
        timestamp: '2026-04-01T12:00:00.000Z',
        payload: {
          id: sessionId,
          timestamp: '2026-04-01T12:00:00.000Z',
          cwd: workingDirectory,
        },
      },
      {
        type: 'turn_context',
        payload: { model: 'gpt-synthetic-retention', private_prompt: privatePrompt },
      },
      ...points.map(({ at, input, output = 0 }) => ({
        type: 'event_msg',
        timestamp: at,
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: 0,
              cache_write_input_tokens: 0,
              output_tokens: output,
              reasoning_output_tokens: 0,
            },
          },
        },
      })),
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n'
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  return content
}

function setMtime(path: string, value: string): void {
  const timestamp = new Date(value)
  utimesSync(path, timestamp, timestamp)
}

describe('Codex history retention lifecycle', () => {
  let root: string
  let home: string
  let activeRoot: string
  let archiveRoot: string
  let database: typeof import('../../src/server/database.ts')
  let scanner: typeof import('../../src/server/historySources.ts')
  let observations: typeof import('../../src/server/usageObservations.ts')
  let captures: typeof import('../../src/server/observationRecords.ts')
  let assignments: typeof import('../../src/server/sessionAssignment.ts')
  const originalHome = process.env.HOME
  const originalProfile = process.env.USERPROFILE
  const originalDataDirectory = process.env.DEVTAX_RADAR_DATA_DIR

  async function loadModules(): Promise<void> {
    vi.resetModules()
    database = await import('../../src/server/database.ts')
    scanner = await import('../../src/server/historySources.ts')
    observations = await import('../../src/server/usageObservations.ts')
    captures = await import('../../src/server/observationRecords.ts')
    assignments = await import('../../src/server/sessionAssignment.ts')
  }

  async function restart(): Promise<void> {
    database.getDatabase().close()
    await loadModules()
  }

  function sessions(sourceId = 'local-codex') {
    return database.getUsageSessions().filter((row) => row.sourceId === sourceId)
  }

  function exactObservations(sourceId = 'local-codex') {
    return observations.readUsageObservations(database.getDatabase(), sessions(sourceId))
  }

  function sourceCapture(sourceId = 'local-codex') {
    return captures.readSourceCapture(database.getDatabase(), sourceId, 'codex')
  }

  async function scan(mode: 'incremental' | 'full' = 'incremental', sourceId = 'local-codex') {
    return await scanner.scanHistorySources(['codex'], [sourceId], mode)
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'devtax-codex-retention-'))
    home = join(root, 'isolated-home')
    activeRoot = join(home, '.codex', 'sessions')
    archiveRoot = join(home, '.codex', 'archived_sessions')
    mkdirSync(activeRoot, { recursive: true })
    mkdirSync(archiveRoot, { recursive: true })
    process.env.HOME = home
    process.env.USERPROFILE = home
    process.env.DEVTAX_RADAR_DATA_DIR = join(root, 'data')
    await loadModules()
  })

  afterEach(() => {
    database.getDatabase().close()
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalProfile
    if (originalDataDirectory === undefined) delete process.env.DEVTAX_RADAR_DATA_DIR
    else process.env.DEVTAX_RADAR_DATA_DIR = originalDataDirectory
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('preserves IDs, exact observations and assignment through archive moves, rescans and restart', async () => {
    const active = join(activeRoot, '2026', '04', 'synthetic-session.jsonl')
    const archived = join(archiveRoot, 'synthetic-session.jsonl')
    const content = writeTranscript(active)
    await scan()
    const before = sessions()
    const points = exactObservations()
    expect(before).toHaveLength(1)
    expect(points).toHaveLength(2)
    expect(points.every((point) => point.timePrecision === 'instant')).toBe(true)
    const rules: ProjectRuleRecord[] = [
      {
        id: 'synthetic-retention-assignment',
        projectKey: before[0].projectKey,
        provider: 'codex',
        effectiveFrom: '2026-04-01',
        taxUnitId: 'synthetic-tax-unit',
        classification: 'new-development',
      },
    ]
    const assigned = points.map((point) =>
      assignments.resolveSessionAssignment(point, rules, 'UTC'),
    )
    expect(assigned.every((assignment) => assignment.ruleId === rules[0].id)).toBe(true)

    renameSync(active, archived)
    for (const mode of ['incremental', 'incremental', 'full'] as const) {
      expect((await scan(mode)).sources[0]?.status).toBe('complete')
      expect(sessions()).toEqual(before)
      expect(exactObservations()).toEqual(points)
    }
    await restart()
    await scan('full')
    expect(sessions()).toEqual(before)
    expect(exactObservations()).toEqual(points)

    renameSync(archived, active)
    for (const mode of ['incremental', 'full', 'incremental'] as const) {
      await scan(mode)
      expect(sessions()).toEqual(before)
      expect(exactObservations()).toEqual(points)
      expect(
        exactObservations().map((point) =>
          assignments.resolveSessionAssignment(point, rules, 'UTC'),
        ),
      ).toEqual(assigned)
    }
    expect(readFileSync(active, 'utf8')).toBe(content)
  })

  it('chooses active over a newer divergent archive copy and retains the last surviving authority', async () => {
    const active = join(activeRoot, 'synthetic-session.jsonl')
    const archived = join(archiveRoot, 'synthetic-session.jsonl')
    writeTranscript(active)
    setMtime(active, '2026-05-01T00:00:00.000Z')
    await scan()
    const liveSessions = sessions()
    const livePoints = exactObservations()

    writeTranscript(archived, [
      { at: '2026-04-15T12:00:00.000Z', input: 600, output: 60 },
      { at: '2026-05-15T12:00:00.000Z', input: 900, output: 90 },
    ])
    setMtime(archived, '2026-06-01T00:00:00.000Z')
    for (const mode of ['incremental', 'full', 'incremental'] as const) {
      const result = await scan(mode)
      expect(result.sources[0]?.diagnostics).toMatchObject({ filesDiscovered: 2 })
      expect(sessions()).toEqual(liveSessions)
      expect(exactObservations()).toEqual(livePoints)
    }

    rmSync(active)
    await scan()
    const archivedSessions = sessions()
    const archivedPoints = exactObservations()
    expect(archivedSessions.map((session) => [session.month, session.inputTokens])).toEqual([
      ['2026-04', 600],
      ['2026-05', 300],
    ])
    expect(archivedPoints.every((point) => point.timePrecision === 'instant')).toBe(true)
    expect(archivedPoints).toHaveLength(2)

    rmSync(archived)
    for (const mode of ['incremental', 'full'] as const) {
      await scan(mode)
      expect(sessions()).toEqual(archivedSessions)
      expect(exactObservations()).toEqual(archivedPoints)
    }
    await restart()
    await scan('full')
    expect(sessions()).toEqual(archivedSessions)
    expect(exactObservations()).toEqual(archivedPoints)
  })

  it('selects one complete same-rank copy by mtime and resolves equal-mtime copies deterministically', async () => {
    const first = join(activeRoot, 'a-synthetic.jsonl')
    const second = join(activeRoot, 'z-synthetic.jsonl')
    writeTranscript(first, [{ at: '2026-04-12T12:00:00.000Z', input: 100 }])
    writeTranscript(second, [{ at: '2026-05-12T12:00:00.000Z', input: 400 }])
    setMtime(first, '2026-06-01T00:00:00.000Z')
    setMtime(second, '2026-06-02T00:00:00.000Z')
    await scan()
    expect(sessions()).toHaveLength(1)
    expect(sessions()[0]).toMatchObject({ month: '2026-05', inputTokens: 400 })
    expect(exactObservations()).toEqual([
      expect.objectContaining({ month: '2026-05', inputTokens: 400, timePrecision: 'instant' }),
    ])

    setMtime(second, '2026-06-01T00:00:00.000Z')
    await scan('full')
    const tiedSessions = sessions()
    const tiedPoints = exactObservations()
    expect(tiedSessions).toHaveLength(1)
    expect([100, 400]).toContain(tiedSessions[0].inputTokens)
    expect(tiedPoints).toHaveLength(1)
    expect(tiedPoints[0].timePrecision).toBe('instant')
    const firstContent = readFileSync(first, 'utf8')
    const secondContent = readFileSync(second, 'utf8')
    rmSync(first)
    rmSync(second)
    // Reverse creation order while keeping the same file identities and mtimes.
    writeFileSync(second, secondContent)
    writeFileSync(first, firstContent)
    setMtime(first, '2026-06-01T00:00:00.000Z')
    setMtime(second, '2026-06-01T00:00:00.000Z')
    await restart()
    for (const mode of ['full', 'incremental', 'full'] as const) {
      await scan(mode)
      expect(sessions()).toEqual(tiedSessions)
      expect(exactObservations()).toEqual(tiedPoints)
    }
  })

  it('does not let a newly modified incompatible duplicate replace the accepted winner', async () => {
    const previous = join(activeRoot, 'synthetic-older.jsonl')
    const current = join(activeRoot, 'synthetic-current.jsonl')
    writeTranscript(previous, [{ at: '2026-04-12T12:00:00.000Z', input: 100 }])
    writeTranscript(current, [{ at: '2026-05-12T12:00:00.000Z', input: 400 }])
    setMtime(previous, '2026-06-01T00:00:00.000Z')
    setMtime(current, '2026-06-02T00:00:00.000Z')
    await scan()
    const before = sessions()
    const points = exactObservations()
    expect(before).toEqual([expect.objectContaining({ month: '2026-05', inputTokens: 400 })])
    writeFileSync(previous, '{"type":"synthetic-incompatible-record"}\n')
    setMtime(previous, '2026-06-03T00:00:00.000Z')

    for (const mode of ['incremental', 'full', 'incremental'] as const) {
      const result = await scan(mode)
      expect(result.sources[0]?.diagnostics).toMatchObject({ filesDeferred: 1 })
      expect(sessions()).toEqual(before)
      expect(exactObservations()).toEqual(points)
    }
    await restart()
    await scan('full')
    expect(sessions()).toEqual(before)
    expect(exactObservations()).toEqual(points)
  })

  it('retains numerical cache and exact observations after deletion without persisting transcript content', async () => {
    const active = join(activeRoot, 'synthetic-session.jsonl')
    writeTranscript(active)
    await scan()
    const before = sessions()
    const points = exactObservations()
    rmSync(active)

    for (const mode of ['incremental', 'incremental', 'full'] as const) {
      const result = await scan(mode)
      expect(result.sources[0]).toMatchObject({ status: 'complete', events: 1 })
      expect(result.sources[0]?.diagnostics).toMatchObject({
        filesDiscovered: 0,
        filesMissingRetained: 1,
      })
      expect(result.providers.codex?.diagnostics).toMatchObject({ filesMissingRetained: 1 })
      expect(sessions()).toEqual(before)
      expect(exactObservations()).toEqual(points)
      expect(database.getHistoryFileCacheEntries('local-codex', 'codex')).toEqual([
        expect.objectContaining({ sourceState: 'missing', valid: true }),
      ])
      expect(sourceCapture()?.files).toContainEqual(
        expect.objectContaining({ state: 'missing-retained', eventCount: 2 }),
      )
    }
    await restart()
    await scan('full')
    expect(sessions()).toEqual(before)
    expect(exactObservations()).toEqual(points)

    const stored = JSON.stringify({
      cache: database.getDatabase().prepare('SELECT * FROM history_file_cache').all(),
      capture: sourceCapture(),
      observations: exactObservations(),
    })
    for (const forbidden of [privatePrompt, nativeSession, workingDirectory, home, active]) {
      expect(stored).not.toContain(forbidden)
    }
  })

  it('uses the current accepted session across all months, including a zero-usage replacement', async () => {
    const active = join(activeRoot, 'synthetic-session.jsonl')
    writeTranscript(active, [
      { at: '2026-04-10T12:00:00.000Z', input: 100 },
      { at: '2026-05-10T12:00:00.000Z', input: 300 },
    ])
    await scan()
    const sessionKey = sessions()[0].sessionKey
    const projectKey = sessions()[0].projectKey
    expect(sessions().map((session) => session.month)).toEqual(['2026-04', '2026-05'])

    writeTranscript(active, [{ at: '2026-06-10T12:00:00.000Z', input: 25 }])
    await scan('full')
    expect(sessions()).toEqual([
      expect.objectContaining({ sessionKey, projectKey, month: '2026-06', inputTokens: 25 }),
    ])
    expect(exactObservations()).toEqual([
      expect.objectContaining({ month: '2026-06', inputTokens: 25, timePrecision: 'instant' }),
    ])

    writeTranscript(active, [{ at: '2026-06-10T12:00:00.000Z', input: 0 }])
    await scan('full')
    expect(sessions()).toEqual([])
    expect(exactObservations()).toEqual([])
    expect(database.getHistoryFileCacheEntries('local-codex', 'codex')).toEqual([
      expect.objectContaining({ sourceState: 'present', valid: true, events: [] }),
    ])
    rmSync(active)
    await restart()
    await scan('full')
    expect(sessions()).toEqual([])
    expect(exactObservations()).toEqual([])
  })

  it('preserves accepted zero usage when both the zero active file and nonzero archive disappear', async () => {
    const active = join(activeRoot, 'synthetic-session.jsonl')
    const archived = join(archiveRoot, 'synthetic-session.jsonl')
    writeTranscript(active)
    cpSync(active, archived)
    await scan()
    expect(sessions()).toHaveLength(1)

    writeTranscript(active, [{ at: '2026-04-20T12:00:00.000Z', input: 0 }])
    for (const mode of ['full', 'incremental'] as const) {
      await scan(mode)
      expect(sessions()).toEqual([])
      expect(exactObservations()).toEqual([])
    }
    rmSync(active)
    rmSync(archived)
    for (const mode of ['incremental', 'full', 'incremental'] as const) {
      await scan(mode)
      expect(sessions()).toEqual([])
      expect(exactObservations()).toEqual([])
    }
    await restart()
    await scan('full')
    expect(sessions()).toEqual([])
    expect(exactObservations()).toEqual([])
  })

  it('keeps active subdirectories and the archive root in separate opaque file namespaces', async () => {
    writeTranscript(
      join(activeRoot, 'archived_sessions', 'synthetic-session.jsonl'),
      initialPoints,
      'synthetic-active-nested-session',
    )
    writeTranscript(
      join(archiveRoot, 'synthetic-session.jsonl'),
      initialPoints,
      'synthetic-archived-session',
    )
    for (const mode of ['incremental', 'full', 'incremental'] as const) {
      await scan(mode)
      expect(sessions()).toHaveLength(2)
      const cached = database.getHistoryFileCacheEntries('local-codex', 'codex')
      expect(cached).toHaveLength(2)
      expect(new Set(cached.map((file) => file.fileKey)).size).toBe(2)
      expect(exactObservations()).toHaveLength(4)
      expect(exactObservations().every((point) => point.timePrecision === 'instant')).toBe(true)
    }
  })

  it('discovers an archive-only default source and preserves totals when both roots disappear', async () => {
    rmSync(activeRoot, { recursive: true })
    rmSync(archiveRoot, { recursive: true })
    expect((await scan()).sources).toEqual([
      expect.objectContaining({ sourceId: 'local-codex', status: 'unavailable', events: 0 }),
    ])
    const archived = join(archiveRoot, 'synthetic-archive-only.jsonl')
    writeTranscript(archived)
    const result = await scan()
    expect(result.sources).toEqual([
      expect.objectContaining({ sourceId: 'local-codex', status: 'complete', events: 1 }),
    ])
    const before = sessions()
    const points = exactObservations()
    expect(before).toHaveLength(1)
    expect(
      (await scanner.listHistorySourceViews()).find((source) => source.id === 'local-codex'),
    ).toMatchObject({ availability: 'available', lastScan: { status: 'complete' } })
    rmSync(archiveRoot, { recursive: true })
    for (const mode of ['incremental', 'full'] as const) {
      expect((await scan(mode)).sources[0]?.status).toBe('unavailable')
      expect(sessions()).toEqual(before)
      expect(exactObservations()).toEqual(points)
    }
  })

  it('does not broaden an explicitly configured root to sibling archives', async () => {
    const configuredRoot = join(root, 'configured', 'sessions')
    const siblingArchive = join(root, 'configured', 'archived_sessions')
    mkdirSync(configuredRoot, { recursive: true })
    writeTranscript(join(siblingArchive, 'synthetic-excluded.jsonl'))
    const source = database.createHistorySource({
      provider: 'codex',
      name: 'Synthetic configured source',
      root: configuredRoot,
    })
    let result = await scan('incremental', source.id)
    expect(result.sources[0]?.diagnostics).toMatchObject({ filesDiscovered: 0 })
    expect(sessions(source.id)).toEqual([])

    const included = join(configuredRoot, 'synthetic-included.jsonl')
    writeTranscript(included, initialPoints, 'synthetic-configured-session')
    result = await scan('full', source.id)
    expect(result.sources[0]?.diagnostics).toMatchObject({ filesDiscovered: 1 })
    expect(sessions(source.id)).toHaveLength(1)
    const before = sessions(source.id)
    rmSync(included)
    await scan('full', source.id)
    expect(sessions(source.id)).toEqual(before)
    expect(database.getHistoryFileCacheEntries(source.id, 'codex')).toHaveLength(1)
  })

  it('deduplicates within a source while keeping matching native sessions from other sources separate', async () => {
    const active = join(activeRoot, 'synthetic-session.jsonl')
    writeTranscript(active)
    cpSync(active, join(archiveRoot, 'synthetic-session.jsonl'))
    const configuredRoot = join(root, 'synthetic-other-machine')
    writeTranscript(join(configuredRoot, 'synthetic-session.jsonl'))
    const source = database.createHistorySource({
      provider: 'codex',
      name: 'Synthetic other machine',
      root: configuredRoot,
    })
    await scanner.scanHistorySources(['codex'])
    const all = database.getUsageSessions()
    expect(all).toHaveLength(2)
    expect(new Set(all.map((row) => row.sourceId))).toEqual(new Set(['local-codex', source.id]))
    expect(new Set(all.map((row) => row.sessionKey)).size).toBe(2)
    expect(new Set(all.map((row) => row.projectKey)).size).toBe(2)
    expect(all.map((row) => row.inputTokens)).toEqual([250, 250])
  })

  it('preserves legacy summaries without a file cache as explicitly unverified coarse usage', async () => {
    database
      .getDatabase()
      .prepare(
        `
      INSERT INTO usage_events(
        source_id, provider, session_key, project_key, month, started_at, ended_at,
        message_count, project_label, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, schema_version, confidence
      ) VALUES (?, 'codex', ?, ?, '2026-04', '2026-04-10T12:00:00.000Z',
        '2026-04-20T12:00:00.000Z', 2, 'Synthetic legacy project', NULL,
        250, 50, 0, 0, 'codex-local-v1', 'high')
    `,
      )
      .run('local-codex', 'session_synthetic_legacy', 'project_synthetic_legacy')
    const before = sessions()
    expect(database.getHistoryFileCacheEntries('local-codex', 'codex')).toEqual([])
    for (const mode of ['incremental', 'incremental', 'full'] as const) {
      const result = await scan(mode)
      expect(result.sources[0]?.diagnostics).toMatchObject({ sessionsUnverifiedRetained: 1 })
      expect(result.providers.codex?.diagnostics).toMatchObject({ sessionsUnverifiedRetained: 1 })
      expect(sessions()).toEqual(before)
      expect(exactObservations()).toEqual([{ ...before[0], timePrecision: 'unknown' }])
      expect(sourceCapture()?.files).toContainEqual(
        expect.objectContaining({ state: 'unverified-retained' }),
      )
      expect(sourceCapture()?.timeZone).toBe('unknown')
      expect(database.getLastScanTimeZones().codex).toBe('unknown')
    }
    await restart()
    await scan('full')
    expect(sessions()).toEqual(before)
    expect(exactObservations()[0].timePrecision).toBe('unknown')
  })

  it('preserves a stored summary as unverified when its only missing file cache is corrupt', async () => {
    const active = join(activeRoot, 'synthetic-session.jsonl')
    writeTranscript(active)
    await scan()
    const before = sessions()
    database
      .getDatabase()
      .prepare("UPDATE history_file_cache SET events_json = ? WHERE source_id = 'local-codex'")
      .run('{"synthetic":"invalid-cache"}')
    rmSync(active)

    for (const mode of ['incremental', 'full'] as const) {
      const result = await scan(mode)
      expect(result.sources[0]?.diagnostics).toMatchObject({ sessionsUnverifiedRetained: 1 })
      expect(sessions()).toEqual(before)
      expect(exactObservations()).toEqual([{ ...before[0], timePrecision: 'unknown' }])
      expect(sourceCapture()?.files).toContainEqual(
        expect.objectContaining({ state: 'unverified-retained' }),
      )
    }
    await restart()
    await scan('full')
    expect(sessions()).toEqual(before)
    expect(exactObservations()[0].timePrecision).toBe('unknown')
  })

  it('migrates the old cache with a verified backup and the same schema hash as a fresh database', async () => {
    const active = join(activeRoot, 'synthetic-session.jsonl')
    writeTranscript(active)
    await scan()
    const before = sessions()
    const points = exactObservations()
    const { databaseSchemaHash } = await import('../../src/server/dataBundle.ts')
    const freshSchemaHash = databaseSchemaHash(database.getDatabase())
    const cachedEvents = database
      .getDatabase()
      .prepare('SELECT file_key, events_json FROM history_file_cache ORDER BY file_key')
      .all()
    database.getDatabase().exec(`
      ALTER TABLE history_file_cache DROP COLUMN source_state;
      ALTER TABLE history_file_cache DROP COLUMN source_rank;
      ALTER TABLE history_file_cache DROP COLUMN session_keys_json;
    `)
    await restart()
    expect(sessions()).toEqual(before)
    expect(exactObservations()).toEqual(points)
    expect(databaseSchemaHash(database.getDatabase())).toBe(freshSchemaHash)
    expect(
      database
        .getDatabase()
        .prepare('SELECT file_key, events_json FROM history_file_cache ORDER BY file_key')
        .all(),
    ).toEqual(cachedEvents)
    const dataDirectory = join(root, 'data')
    const backups = readdirSync(dataDirectory).filter((name) =>
      name.includes('before-codex-history-retention-'),
    )
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(dataDirectory, backups[0]), { readOnly: true })
    try {
      expect(backup.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(
        backup
          .prepare('SELECT file_key, events_json FROM history_file_cache ORDER BY file_key')
          .all(),
      ).toEqual(cachedEvents)
      expect(
        backup
          .prepare('PRAGMA table_info(history_file_cache)')
          .all()
          .map((row) => row.name),
      ).not.toContain('source_state')
    } finally {
      backup.close()
    }
    rmSync(active)
    await scan('full')
    expect(sessions()).toEqual(before)
    expect(exactObservations()).toEqual(points)
    await restart()
    await scan()
    expect(
      readdirSync(dataDirectory).filter((name) => name.includes('before-codex-history-retention-')),
    ).toHaveLength(1)
    expect(sessions()).toEqual(before)
  })

  it('keeps root-change summaries coarse until the reconnected source supplies current observations', async () => {
    const previousRoot = join(root, 'configured-before')
    const nextRoot = join(root, 'configured-after')
    writeTranscript(join(previousRoot, 'synthetic-session.jsonl'), [
      { at: '2026-04-10T12:00:00.000Z', input: 100 },
      { at: '2026-05-10T12:00:00.000Z', input: 300 },
    ])
    mkdirSync(nextRoot)
    const source = database.createHistorySource({
      provider: 'codex',
      name: 'Synthetic reconnect source',
      root: previousRoot,
    })
    await scan('incremental', source.id)
    const before = sessions(source.id)
    await scanner.updateConfiguredHistorySource(source.id, {
      provider: 'codex',
      name: source.name,
      root: nextRoot,
    })
    expect(database.getHistoryFileCacheEntries(source.id, 'codex')).toEqual([])
    for (const mode of ['incremental', 'full'] as const) {
      const result = await scan(mode, source.id)
      expect(result.sources[0]?.diagnostics?.sessionsUnverifiedRetained).toBeGreaterThan(0)
      expect(sessions(source.id)).toEqual(before)
      expect(exactObservations(source.id).every((row) => row.timePrecision === 'unknown')).toBe(
        true,
      )
    }
    await restart()
    await scan('full', source.id)
    expect(sessions(source.id)).toEqual(before)
    writeTranscript(join(nextRoot, 'synthetic-session.jsonl'), [
      { at: '2026-06-10T12:00:00.000Z', input: 40 },
    ])
    await scan('full', source.id)
    expect(sessions(source.id)).toEqual([
      expect.objectContaining({
        sessionKey: before[0].sessionKey,
        projectKey: before[0].projectKey,
        month: '2026-06',
        inputTokens: 40,
      }),
    ])
    expect(exactObservations(source.id)).toEqual([
      expect.objectContaining({ inputTokens: 40, timePrecision: 'instant' }),
    ])
  })
})
