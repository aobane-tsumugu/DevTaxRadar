import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalConfiguration } from '../../src/server/database.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('provider contract periods', () => {
  it('stores contract dates per provider and clears them again', () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'devtax-config-'))
    temporaryDirectories.push(dataDirectory)

    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', resolve('tests/server/helpers/configuration-probe.ts')],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: { ...process.env, DEVTAX_RADAR_DATA_DIR: dataDirectory },
      },
    )
    const result = JSON.parse(stdout) as {
      initial: LocalConfiguration
      saved: LocalConfiguration
      cleared: LocalConfiguration
    }

    expect(result.initial.contracts).toEqual({ claude: {}, codex: {} })
    expect(result.saved.contracts).toEqual({
      claude: { startedOn: '2026-07-18' },
      codex: { startedOn: '2026-01-05', endedOn: '2026-05-31' },
    })
    expect(result.cleared.contracts).toEqual({ claude: {}, codex: {} })
  })
})
