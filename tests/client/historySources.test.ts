import { describe, expect, it } from 'vitest'

import {
  providerHasEnabledSource,
  recentScanTime,
  sourceAvailabilityCopy,
  sourceTestCopy,
} from '../../src/client/historySources.ts'
import type { HistorySource } from '../../src/client/types.ts'

const source = (patch: Partial<HistorySource> = {}): HistorySource => ({
  id: 'source-1',
  provider: 'claude',
  kind: 'configured',
  name: '経理用NAS',
  root: '\\\\accounting-nas\\history\\projects',
  enabled: true,
  availability: 'available',
  lastScan: { status: 'never' },
  ...patch,
})

describe('history source UI decisions', () => {
  it('reuses a scan only when every chosen enabled source completed it moments ago', () => {
    const now = Date.parse('2026-09-23T04:20:00Z')
    const done = (at: string, patch: Partial<HistorySource> = {}) =>
      source({ lastScan: { status: 'complete', completedAt: at }, ...patch })
    const fresh = [
      done('2026-09-23T04:16:00Z'),
      done('2026-09-23T04:18:00Z', { id: 'x', provider: 'codex' }),
    ]
    expect(recentScanTime(fresh, ['claude', 'codex'], 'incremental', now)?.toISOString()).toBe(
      '2026-09-23T04:16:00.000Z',
    )
    expect(recentScanTime(fresh, ['claude', 'codex'], 'full', now)).toBeUndefined()
    expect(
      recentScanTime([done('2026-09-23T04:00:00Z')], ['claude'], 'incremental', now),
    ).toBeUndefined()
    expect(recentScanTime([source()], ['claude'], 'incremental', now)).toBeUndefined()
    expect(
      recentScanTime(
        [done('2026-09-23T04:16:00Z', { availability: 'unavailable' })],
        ['claude'],
        'incremental',
        now,
      ),
    ).toBeUndefined()
    expect(
      recentScanTime([done('2026-09-23T04:16:00Z')], ['codex'], 'incremental', now),
    ).toBeUndefined()
  })

  it('permits retrying an enabled source even when its last visibility probe failed', () => {
    expect(providerHasEnabledSource([source()], 'claude')).toBe(true)
    expect(providerHasEnabledSource([source({ enabled: false })], 'claude')).toBe(false)
    expect(providerHasEnabledSource([source({ availability: 'unavailable' })], 'claude')).toBe(true)
    expect(providerHasEnabledSource([source()], 'codex')).toBe(false)
  })

  it('explains that unavailable or failed sources retain their previous imports', () => {
    expect(sourceAvailabilityCopy(source({ availability: 'unavailable' }))).toMatchObject({
      tone: 'warning',
      text: expect.stringContaining('前回取り込み分は保持されています'),
    })
    expect(sourceAvailabilityCopy(source({ lastScan: { status: 'failed' } }))).toMatchObject({
      tone: 'warning',
      text: expect.stringContaining('前回取り込み分は保持されています'),
    })
    expect(sourceAvailabilityCopy(source({ enabled: false }))).toMatchObject({
      tone: 'muted',
      text: expect.stringContaining('走査を停止しています'),
    })
  })

  it('uses actionable visibility-test copy without exposing a path', () => {
    expect(sourceTestCopy({ availability: 'available', filesDiscovered: 12 })).toEqual({
      tone: 'ready',
      text: '利用できます。履歴ファイルを12件確認しました。',
    })
    const unavailable = sourceTestCopy({
      availability: 'unavailable',
      filesDiscovered: 0,
      reason: 'not_found',
    })
    expect(unavailable).toMatchObject({
      tone: 'warning',
      text: expect.stringContaining('見つかりません'),
    })
    expect(unavailable.text).not.toContain('accounting-nas')
  })
})
