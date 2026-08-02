import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearHistoryAgeCacheForTests,
  forecastNextLoss,
  readCleanupPeriod,
  readHistoryAge,
  readHistoryAgeCached,
} from '../../src/server/retention.ts'

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

  it('reports an array instead of calling it the default, matching the write path', () => {
    expect(readCleanupPeriod(writeSettings('[1,2,3]')).status).toBe('unreadable')
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

  // GET /api/runtime calls readHistoryAge synchronously on every page load,
  // so a slow walk blocks Fastify's single event loop thread each time. This
  // times a synthetic tree of a few thousand files -- the same order of
  // magnitude as a real ~/.claude/projects directory -- to check that
  // assumption against a committed measurement instead of a guess.
  it('visits every file exactly once across a few thousand of them', () => {
    const root = temporaryDirectory()
    // Enough files to exercise the recursive walk without making the test
    // itself an I/O stress test -- it flaked at 3,000 under a loaded machine.
    const fileCount = 600
    const directoryCount = 30
    const directories = Array.from({ length: directoryCount }, (_, index) => {
      const directory = join(root, `project-${index}`)
      mkdirSync(directory, { recursive: true })
      return directory
    })
    for (let index = 0; index < fileCount; index += 1) {
      const directory = directories[index % directoryCount]!
      writeFileSync(join(directory, `session-${index}.jsonl`), '{}\n', 'utf8')
    }

    const age = readHistoryAge(root)

    // Counting rather than timing. A wall-clock ceiling here flakes on a loaded
    // machine while proving little: an exact count catches a double-visit (the
    // realistic regression, e.g. a junction-guard change) deterministically.
    // The real-world cost (~130-155ms against a 3,738 file / ~910 MiB history)
    // is recorded in retention.ts, where it motivates readHistoryAgeCached.
    expect(age.fileCount).toBe(fileCount)
    expect(age.oldestModifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('readHistoryAgeCached', () => {
  afterEach(() => {
    clearHistoryAgeCacheForTests()
  })

  it('reuses the cached result until the TTL elapses', () => {
    const root = temporaryDirectory()
    writeFileSync(join(root, 'a.jsonl'), '{}\n', 'utf8')

    expect(readHistoryAgeCached(root, 1_000).fileCount).toBe(1)

    // A second file appears without the clock moving -- still served from
    // cache, so the count must not change yet.
    writeFileSync(join(root, 'b.jsonl'), '{}\n', 'utf8')
    expect(readHistoryAgeCached(root, 1_000 + 59_000).fileCount).toBe(1)

    // Past the 60s TTL: the walk reruns and picks up the new file.
    expect(readHistoryAgeCached(root, 1_000 + 60_001).fileCount).toBe(2)
  })

  it('caches each root directory independently', () => {
    const rootA = temporaryDirectory()
    const rootB = temporaryDirectory()
    writeFileSync(join(rootA, 'a.jsonl'), '{}\n', 'utf8')

    expect(readHistoryAgeCached(rootA, 0).fileCount).toBe(1)
    expect(readHistoryAgeCached(rootB, 0).fileCount).toBe(0)
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

  it('reports no forecast when the local date could not be resolved', () => {
    const age = { oldestModifiedOn: '2026-07-20', fileCount: 3 }
    expect(forecastNextLoss(age, period, '')).toEqual({ alreadyLosing: false })
  })

  it('cannot forecast when the settings file is unreadable', () => {
    const age = { oldestModifiedOn: '2026-07-20', fileCount: 3 }
    const unreadable = { status: 'unreadable' as const, reason: 'JSONを解析できません' }
    expect(forecastNextLoss(age, unreadable, '2026-08-02')).toEqual({ alreadyLosing: false })
  })
})
