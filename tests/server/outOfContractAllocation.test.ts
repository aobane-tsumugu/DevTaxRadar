import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

type ProbeGuidance = { title: string; severity: string }

type ProbeResult = {
  guidance: ProbeGuidance[]
  monthCount: number
  allocations: ProbeRow[]
}

type ProbeRow = {
  id: string
  month: string
  amount: number
  taxCandidate: string
  sessionDate: string
}

function runProbe(): ProbeResult {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'devtax-out-of-contract-'))
  temporaryDirectories.push(dataDirectory)

  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', resolve('tests/server/helpers/out-of-contract-probe.ts')],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, DEVTAX_RADAR_DATA_DIR: dataDirectory },
    },
  )
  return JSON.parse(stdout) as ProbeResult
}

describe('out-of-contract allocation rows', () => {
  it('keeps both halves of a month-crossing session as separately keyed rows', () => {
    const rows = runProbe().allocations.filter((row) => row.taxCandidate === '契約期間外')

    // Both stored rows share one sessionKey. If the row id omitted the month,
    // these two would collide and React would drop one from the table.
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.id)).size).toBe(2)
    expect(rows.map((row) => row.month).sort()).toEqual(['2026年6月', '2026年7月'])
  })

  it('allocates no money to a provider whose contract starts later', () => {
    const rows = runProbe().allocations

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.amount === 0)).toBe(true)
  })

  it('shows the local calendar date the exclusion rule actually used', () => {
    const rows = runProbe().allocations.filter((row) => row.taxCandidate === '契約期間外')

    // A raw ISO timestamp would still contain 'T' and 'Z'; the displayed value
    // must be the local YYYY-MM-DD the contract comparison was made against.
    for (const row of rows) {
      expect(row.sessionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('contract period guidance', () => {
  it('names the contract period as the reason when no month is left', () => {
    // The probe stores a contract starting in 2030 while every session is from
    // 2026, so the chart has nothing to draw. Without this entry the empty
    // chart would read as "you never scanned anything", sending the user to
    // re-scan instead of to the date they mistyped.
    const result = runProbe()

    expect(result.monthCount).toBe(0)
    const titles = result.guidance.map((item) => item.title)
    expect(titles).toContain('契約期間が利用履歴と重なっていません')
    expect(titles).not.toContain('契約期間が未入力です')
  })
})
