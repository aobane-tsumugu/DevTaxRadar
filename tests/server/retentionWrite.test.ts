import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeCleanupPeriod } from '../../src/server/retention.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function settingsWith(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-retention-write-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'settings.json')
  writeFileSync(path, contents, 'utf8')
  return path
}

describe('writeCleanupPeriod', () => {
  it('changes only cleanupPeriodDays and keeps every other key', () => {
    const path = settingsWith(
      JSON.stringify({ model: 'opus', permissions: { allow: ['Read'] }, cleanupPeriodDays: 30 }),
    )
    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(true)
    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(written.cleanupPeriodDays).toBe(400)
    expect(written.model).toBe('opus')
    expect(written.permissions).toEqual({ allow: ['Read'] })
  })

  it('adds the key when it was absent', () => {
    const path = settingsWith(JSON.stringify({ model: 'opus' }))
    expect(writeCleanupPeriod(path, 180, '20260802T120000').ok).toBe(true)
    expect(
      (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>).cleanupPeriodDays,
    ).toBe(180)
  })

  it('writes a backup beside the original before touching it', () => {
    const path = settingsWith(JSON.stringify({ model: 'opus', cleanupPeriodDays: 30 }))
    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The file name only -- the API surfaces this, and it must not leak a path.
    expect(result.backupFileName).toBe('settings.json.devtax-backup-20260802T120000')
    const backupPath = `${path}.devtax-backup-20260802T120000`
    expect(existsSync(backupPath)).toBe(true)
    const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as Record<string, unknown>
    expect(backup.cleanupPeriodDays).toBe(30)
  })

  it('never overwrites an earlier backup when two writes share a suffix', () => {
    const path = settingsWith(JSON.stringify({ model: 'opus', cleanupPeriodDays: 30 }))

    const first = writeCleanupPeriod(path, 400, '20260802T120000')
    const second = writeCleanupPeriod(path, 500, '20260802T120000')

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.backupFileName).not.toBe(first.backupFileName)

    // The first backup must still hold the ORIGINAL value. If the second write
    // had clobbered it, the only copy of 30 would be gone forever.
    const firstBackup = JSON.parse(
      readFileSync(join(dirname(path), first.backupFileName as string), 'utf8'),
    ) as Record<string, unknown>
    expect(firstBackup.cleanupPeriodDays).toBe(30)
  })

  it('does not create a backup when there was no file to back up', () => {
    const directory = mkdtempSync(join(tmpdir(), 'devtax-retention-write-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'settings.json')

    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backupFileName).toBeUndefined()
    expect(readdirSync(directory)).toEqual(['settings.json'])
  })

  it('refuses an array and leaves the file byte-identical', () => {
    const path = settingsWith('[1,2,3]')
    const before = readFileSync(path, 'utf8')

    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('keeps every key of a settings file with many entries', () => {
    const original = {
      model: 'opus',
      language: 'ja',
      permissions: { allow: ['Read', 'Edit'], deny: [] },
      enabledPlugins: ['a', 'b'],
      autoUpdatesChannel: 'stable',
      tui: { theme: 'dark' },
      cleanupPeriodDays: 30,
    }
    const path = settingsWith(JSON.stringify(original))

    expect(writeCleanupPeriod(path, 400, '20260802T120000').ok).toBe(true)

    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(written).toEqual({ ...original, cleanupPeriodDays: 400 })
  })

  it('leaves no temporary file behind after a successful write', () => {
    const path = settingsWith(JSON.stringify({ cleanupPeriodDays: 30 }))
    expect(writeCleanupPeriod(path, 400, '20260802T120000').ok).toBe(true)
    expect(readdirSync(dirname(path)).filter((name) => name.includes('devtax-tmp'))).toEqual([])
  })

  it('refuses to write when the JSON cannot be parsed, and leaves the file alone', () => {
    const path = settingsWith('{ this is not json')
    const before = readFileSync(path, 'utf8')

    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('creates the file when it does not exist yet', () => {
    const directory = mkdtempSync(join(tmpdir(), 'devtax-retention-write-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'settings.json')

    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(true)
    expect(
      (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>).cleanupPeriodDays,
    ).toBe(400)
  })

  it('reports the previous value so the screen can show what changed', () => {
    const path = settingsWith(JSON.stringify({ cleanupPeriodDays: 30 }))
    const result = writeCleanupPeriod(path, 400, '20260802T120000')
    expect(result.ok && result.previousDays).toBe(30)
  })
})
