import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('dashboard observation reuse', () => {
  let root: string
  let database: typeof import('../../src/server/database.ts')
  let scanner: typeof import('../../src/server/historySources.ts')
  let dashboard: typeof import('../../src/server/dashboard.ts')
  const originalHome = process.env.HOME
  const originalProfile = process.env.USERPROFILE

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'devtax-observation-cache-'))
    const projects = join(root, 'home', '.claude', 'projects')
    cpSync(resolve('fixtures/claude'), projects, { recursive: true })
    const history = join(projects, 'synthetic-history.jsonl')
    writeFileSync(
      history,
      readFileSync(history, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line !== 'not valid json')
        .join('\n'),
    )
    process.env.DEVTAX_RADAR_DATA_DIR = join(root, 'data')
    process.env.HOME = join(root, 'home')
    process.env.USERPROFILE = join(root, 'home')
    vi.resetModules()
    database = await import('../../src/server/database.ts')
    scanner = await import('../../src/server/historySources.ts')
    dashboard = await import('../../src/server/dashboard.ts')
  })

  afterEach(() => {
    database.getDatabase().close()
    delete process.env.DEVTAX_RADAR_DATA_DIR
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalProfile
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('reuses unchanged observations and recomputes after any write', async () => {
    await scanner.scanHistorySources(['claude'])
    const first = dashboard.readDashboardObservation()
    expect(first.sessions.length).toBeGreaterThan(0)
    expect(dashboard.readDashboardObservation()).toBe(first)
    expect(Object.isFrozen(first.sessions)).toBe(true)
    expect(Object.isFrozen(first.sessions[0])).toBe(true)

    database.saveConfiguration({
      charges: { claude: 30_000, codex: 0 },
      monthlyCharges: [],
      contracts: { claude: {}, codex: {} },
      unobservedRatio: 0,
    })
    const afterWrite = dashboard.readDashboardObservation()
    expect(afterWrite).not.toBe(first)
    expect(afterWrite.sessions).toEqual(first.sessions)
    expect(dashboard.buildDashboard().meta.sessionCount).toBe(first.sessions.length)

    const db = database.getDatabase()
    db.exec('BEGIN')
    try {
      // Inside a transaction the rows could still roll back, so nothing is reused or kept.
      expect(dashboard.readDashboardObservation()).not.toBe(afterWrite)
    } finally {
      db.exec('ROLLBACK')
    }
    expect(dashboard.readDashboardObservation()).toBe(afterWrite)
  })
})
