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
      unknown: LocalConfiguration
      confirmedNone: LocalConfiguration
      unknownDefault: LocalConfiguration
      zeroDefault: LocalConfiguration
    }

    expect(result.initial.contracts).toEqual({ claude: {}, codex: {} })
    expect(result.initial.charges).toEqual({ claude: null, codex: null })
    expect(result.initial.unknownChargeReasons).toEqual({
      claude: '既定月額が未入力です。',
      codex: '既定月額が未入力です。',
    })
    expect(result.initial.unobservedRatio).toBeNull()
    expect(result.saved.unobservedRatio).toBe(0.1)
    expect(result.unknown.unobservedRatio).toBeNull()
    expect(result.confirmedNone.unobservedRatio).toBe(0)
    expect(result.unknownDefault.charges).toEqual({ claude: null, codex: 0 })
    expect(result.unknownDefault.unknownChargeReasons).toEqual({ claude: '請求書を確認中' })
    expect(result.zeroDefault.charges).toEqual({ claude: 0, codex: 0 })
    expect(result.zeroDefault.unknownChargeReasons).toBeUndefined()
    expect(result.saved.contracts).toEqual({
      claude: { startedOn: '2026-07-18' },
      codex: { startedOn: '2026-01-05', endedOn: '2026-05-31' },
    })
    expect(result.cleared.contracts).toEqual({ claude: {}, codex: {} })
  })
})
