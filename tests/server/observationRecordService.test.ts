import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { FileCapture } from '../../src/accounting/observationRecord.js'
import { readSourceCapture } from '../../src/server/observationRecords.js'
import { recordSourceCapture } from '../../src/server/observationRecordService.js'

const control = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined }))
vi.mock('../../src/server/database.js', () => ({
  getDatabase: () => control.db!,
  getUsageSessions: () => [],
  getLastScanTimeZones: () => ({ codex: 'Asia/Tokyo' }),
}))
vi.mock('../../src/adapters/localTime.js', () => ({ resolvedTimeZone: () => 'UTC' }))

const files: FileCapture[] = [
  {
    fileKey: 'a'.repeat(64),
    state: 'missing-retained',
    adapter: 'codex',
    schemaVersion: '1',
    eventCount: 1,
  },
  {
    fileKey: 'b'.repeat(64),
    state: 'unverified-retained',
    adapter: 'legacy-summary',
    schemaVersion: '1',
    eventCount: 0,
  },
  { fileKey: 'c'.repeat(64), state: 'read', adapter: 'codex', schemaVersion: '1', eventCount: 1 },
  {
    fileKey: 'd'.repeat(64),
    state: 'deferred-missing',
    adapter: 'codex',
    schemaVersion: '1',
    eventCount: 0,
  },
]

describe('retained source capture metadata', () => {
  beforeEach(() => {
    control.db = new DatabaseSync(':memory:')
    control.db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
  })
  afterEach(() => control.db?.close())

  it('does not assign the current scan calendar to unverified legacy summaries', () => {
    recordSourceCapture('local-codex', 'codex', 'full', 'complete', files)
    const capture = readSourceCapture(control.db!, 'local-codex', 'codex')!
    expect(capture.timeZone).toBe('unknown')
    expect(capture.status).toBe('complete')
    expect(capture.files).toEqual(files)
    recordSourceCapture('local-codex', 'codex', 'full', 'complete', [files[2]!])
    expect(readSourceCapture(control.db!, 'local-codex', 'codex')!.timeZone).toBe('UTC')
  })

  it.each(['unavailable', 'failed'] as const)(
    'preserves prior retention evidence when a scan is %s',
    (status) => {
      recordSourceCapture('local-codex', 'codex', 'full', 'complete', files)
      recordSourceCapture('local-codex', 'codex', 'incremental', status)
      const capture = readSourceCapture(control.db!, 'local-codex', 'codex')!
      expect(capture.status).toBe(status)
      expect(capture.timeZone).toBe('unknown')
      expect(capture.files.map((file) => file.state)).toEqual([
        'missing-retained',
        'unverified-retained',
        'deferred-previous',
        'deferred-missing',
      ])
    },
  )
})
