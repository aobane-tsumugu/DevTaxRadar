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
type ProbeResult = { beforeGuidance: ProbeGuidance[]; afterGuidance: ProbeGuidance[] }

function runProbe(): ProbeResult {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'devtax-timezone-guidance-'))
  temporaryDirectories.push(dataDirectory)

  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', resolve('tests/server/helpers/timezone-guidance-probe.ts')],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, DEVTAX_RADAR_DATA_DIR: dataDirectory },
    },
  )
  return JSON.parse(stdout) as ProbeResult
}

describe('timezone guidance', () => {
  it('does not warn right after a scan, when the recorded zone still matches the current one', () => {
    const { beforeGuidance } = runProbe()
    const titles = beforeGuidance.map((item) => item.title)
    expect(titles).not.toContain('タイムゾーンが走査時と変わっています')
  })

  it('warns when the last scan recorded a timezone different from the current one', () => {
    const { afterGuidance } = runProbe()
    const warning = afterGuidance.find(
      (item) => item.title === 'タイムゾーンが走査時と変わっています',
    )
    expect(warning).toBeDefined()
    expect(warning?.severity).toBe('warning')
  })
})
