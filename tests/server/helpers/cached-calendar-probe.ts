import { getDatabase, getHistoryFileCacheEntries } from '../../../src/server/database.js'
import { localMonthFromTimestamp } from '../../../src/adapters/localTime.js'

const db = getDatabase()
try {
  const event = {
    provider: 'claude',
    eventKey: 'opaque-message',
    month: '2026-07',
    observedAt: '2026-07-31T23:50:00.000Z',
    sessionKey: 'opaque-session',
    projectKey: 'opaque-project',
    model: 'synthetic',
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    captureMethod: 'synthetic-cache-fixture',
    adapter: 'synthetic/1',
    schemaVersion: 'synthetic/1',
    confidence: 'A',
    prompt: 'PRIVATE_PAYLOAD_MUST_NOT_SURVIVE_CACHE_DECODE',
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO history_file_cache(
      source_id, provider, file_key, byte_size, file_mtime,
      adapter, schema_version, events_json, updated_at
    ) VALUES('local-claude', 'claude', ?, 100, '2026-08-01T00:00:00Z',
             'synthetic/1', 'synthetic/1', ?, '2026-08-01T00:00:00Z')
  `)
  insert.run('calendar-valid', JSON.stringify([event]))
  insert.run('calendar-invalid', JSON.stringify([{ ...event, observedAt: 'not-a-date' }]))
  const entries = getHistoryFileCacheEntries('local-claude', 'claude')
  const stored = db
    .prepare(
      `SELECT events_json AS json FROM history_file_cache
    WHERE source_id='local-claude' AND provider='claude' AND file_key='calendar-valid'`,
    )
    .get() as { json: string }
  process.stdout.write(
    JSON.stringify({
      entries: entries.map(({ fileKey, valid, events }) => ({ fileKey, valid, events })),
      freshMonth: localMonthFromTimestamp(event.observedAt),
      storedMonth: (JSON.parse(stored.json) as Array<{ month: string }>)[0]!.month,
    }),
  )
} finally {
  db.close()
}
