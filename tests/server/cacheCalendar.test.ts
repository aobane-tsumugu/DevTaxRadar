import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('redecodes an unchanged numeric cache on restart without rewriting its stored calendar', () => {
  const data = mkdtempSync(join(tmpdir(), 'devtax-cache-calendar-'))
  try {
    const read = (timeZone: string) => JSON.parse(execFileSync(process.execPath, [
      '--import', 'tsx', resolve('tests/server/helpers/cached-calendar-probe.ts'),
    ], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, TZ: timeZone, DEVTAX_RADAR_DATA_DIR: data, HOME: data, USERPROFILE: data },
    })) as {
      entries: Array<{ fileKey: string; valid: boolean; events: Array<{ month: string; inputTokens: number }> }>
      freshMonth: string
      storedMonth: string
    }
    const utc = read('UTC')
    const japan = read('Asia/Tokyo')
    for (const [result, month] of [[utc, '2026-07'], [japan, '2026-08']] as const) {
      const valid = result.entries.find((row) => row.fileKey === 'calendar-valid')!
      expect(valid.valid).toBe(true)
      expect(valid.events[0]).toMatchObject({ month, inputTokens: 100 })
      expect(result.freshMonth).toBe(month)
      expect(result.storedMonth).toBe('2026-07')
      expect(result.entries.find((row) => row.fileKey === 'calendar-invalid')).toMatchObject({ valid: false, events: [] })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_PAYLOAD')
    }
  } finally {
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
