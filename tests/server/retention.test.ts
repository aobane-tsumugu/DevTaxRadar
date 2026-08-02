import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { forecastNextLoss, readCleanupPeriod, readHistoryAge } from '../../src/server/retention.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-retention-'))
  temporaryDirectories.push(directory)
  return directory
}

function writeSettings(contents: string): string {
  const directory = temporaryDirectory()
  const path = join(directory, 'settings.json')
  writeFileSync(path, contents, 'utf8')
  return path
}

describe('readCleanupPeriod', () => {
  it('reads an explicit cleanupPeriodDays', () => {
    const path = writeSettings(JSON.stringify({ cleanupPeriodDays: 400, model: 'opus' }))
    expect(readCleanupPeriod(path)).toEqual({ status: 'explicit', days: 400 })
  })

  it("falls back to Claude Code's 30 day default when the key is absent", () => {
    const path = writeSettings(JSON.stringify({ model: 'opus' }))
    expect(readCleanupPeriod(path)).toEqual({ status: 'default', days: 30 })
  })

  it('treats a missing file as the default rather than an error', () => {
    const path = join(temporaryDirectory(), 'settings.json')
    expect(readCleanupPeriod(path)).toEqual({ status: 'default', days: 30 })
  })

  it('reports unparsable JSON instead of guessing', () => {
    const path = writeSettings('{ this is not json')
    const period = readCleanupPeriod(path)
    expect(period.status).toBe('unreadable')
  })

  it('reports a non-numeric or non-positive value instead of using it', () => {
    expect(readCleanupPeriod(writeSettings('{"cleanupPeriodDays":"400"}')).status).toBe(
      'unreadable',
    )
    expect(readCleanupPeriod(writeSettings('{"cleanupPeriodDays":0}')).status).toBe('unreadable')
    expect(readCleanupPeriod(writeSettings('{"cleanupPeriodDays":-5}')).status).toBe('unreadable')
  })
})

describe('readHistoryAge', () => {
  it('reports no files for a directory that does not exist', () => {
    expect(readHistoryAge(join(temporaryDirectory(), 'absent'))).toEqual({ fileCount: 0 })
  })

  it('finds the oldest jsonl file across nested directories', () => {
    const root = temporaryDirectory()
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    const older = join(root, 'a', 'old.jsonl')
    const newer = join(root, 'a', 'b', 'new.jsonl')
    writeFileSync(older, '{}\n', 'utf8')
    writeFileSync(newer, '{}\n', 'utf8')
    // 2026-03-20T12:00:00Z and 2026-06-01T12:00:00Z, midday so the local date
    // is the same in every timezone this project supports.
    utimesSync(older, new Date('2026-03-20T12:00:00Z'), new Date('2026-03-20T12:00:00Z'))
    utimesSync(newer, new Date('2026-06-01T12:00:00Z'), new Date('2026-06-01T12:00:00Z'))

    const age = readHistoryAge(root)
    expect(age.fileCount).toBe(2)
    expect(age.oldestModifiedOn).toBe('2026-03-20')
  })

  it('ignores files that are not jsonl', () => {
    const root = temporaryDirectory()
    writeFileSync(join(root, 'notes.txt'), 'x', 'utf8')
    expect(readHistoryAge(root)).toEqual({ fileCount: 0 })
  })
})

describe('forecastNextLoss', () => {
  const period = { status: 'explicit' as const, days: 30 }

  it('returns nothing to forecast when there is no history', () => {
    expect(forecastNextLoss({ fileCount: 0 }, period, '2026-08-02')).toEqual({
      alreadyLosing: false,
    })
  })

  it('counts the days until the oldest file passes the retention period', () => {
    const age = { oldestModifiedOn: '2026-07-20', fileCount: 3 }
    expect(forecastNextLoss(age, period, '2026-08-02')).toEqual({
      nextLossOn: '2026-08-19',
      daysUntilNextLoss: 17,
      alreadyLosing: false,
    })
  })

  it('reports that history is already being lost when the date has passed', () => {
    const age = { oldestModifiedOn: '2026-01-21', fileCount: 3 }
    expect(forecastNextLoss(age, period, '2026-08-02')).toEqual({
      nextLossOn: '2026-02-20',
      daysUntilNextLoss: 0,
      alreadyLosing: true,
    })
  })

  // The most warning-worthy day of all: the oldest transcript expires today.
  it('treats the expiry day itself as already losing', () => {
    const age = { oldestModifiedOn: '2026-07-03', fileCount: 3 }
    expect(forecastNextLoss(age, period, '2026-08-02')).toEqual({
      nextLossOn: '2026-08-02',
      daysUntilNextLoss: 0,
      alreadyLosing: true,
    })
  })

  it('still has one day left on the day before expiry', () => {
    const age = { oldestModifiedOn: '2026-07-04', fileCount: 3 }
    expect(forecastNextLoss(age, period, '2026-08-02')).toEqual({
      nextLossOn: '2026-08-03',
      daysUntilNextLoss: 1,
      alreadyLosing: false,
    })
  })

  it('crosses a leap day without drifting', () => {
    const age = { oldestModifiedOn: '2028-01-30', fileCount: 1 }
    expect(forecastNextLoss(age, period, '2028-02-01').nextLossOn).toBe('2028-02-29')
  })

  it('cannot forecast when the settings file is unreadable', () => {
    const age = { oldestModifiedOn: '2026-07-20', fileCount: 3 }
    const unreadable = { status: 'unreadable' as const, reason: 'JSONを解析できません' }
    expect(forecastNextLoss(age, unreadable, '2026-08-02')).toEqual({ alreadyLosing: false })
  })
})
