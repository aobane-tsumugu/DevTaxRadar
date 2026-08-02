import { describe, expect, it } from 'vitest'
import type { NormalizedUsage } from '../../src/adapters/types.ts'
import { aggregateSessions } from '../../src/server/sessionAggregation.ts'

function event(overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return {
    provider: 'claude',
    month: '2026-07',
    observedAt: '2026-07-15T10:00:00.000Z',
    sessionKey: 'session_a',
    projectKey: 'project_a',
    model: 'claude-opus-5',
    inputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 10,
    reasoningTokens: 0,
    captureMethod: 'test',
    adapter: 'test',
    schemaVersion: 'test-v1',
    confidence: 'B',
    ...overrides,
  }
}

describe('aggregateSessions', () => {
  it('同じセッションのメッセージを1行へ畳み込む', () => {
    const sessions = aggregateSessions([
      event({ observedAt: '2026-07-15T10:00:00.000Z', inputTokens: 100, outputTokens: 10 }),
      event({ observedAt: '2026-07-15T11:00:00.000Z', inputTokens: 200, outputTokens: 20 }),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionKey: 'session_a',
      messageCount: 2,
      inputTokens: 300,
      outputTokens: 30,
      startedAt: '2026-07-15T10:00:00.000Z',
      endedAt: '2026-07-15T11:00:00.000Z',
    })
  })

  it('reasoningTokensをoutputTokensへ合算する', () => {
    const sessions = aggregateSessions([event({ outputTokens: 10, reasoningTokens: 5 })])
    expect(sessions[0]?.outputTokens).toBe(15)
  })

  it('入力順が逆でも開始と終了を正しく決める', () => {
    const sessions = aggregateSessions([
      event({ observedAt: '2026-07-15T11:00:00.000Z' }),
      event({ observedAt: '2026-07-15T10:00:00.000Z' }),
    ])
    expect(sessions[0]?.startedAt).toBe('2026-07-15T10:00:00.000Z')
    expect(sessions[0]?.endedAt).toBe('2026-07-15T11:00:00.000Z')
  })

  it('月をまたぐセッションは月ごとに分ける', () => {
    const sessions = aggregateSessions([
      event({ month: '2026-07', observedAt: '2026-07-31T10:00:00.000Z' }),
      event({ month: '2026-08', observedAt: '2026-08-01T10:00:00.000Z' }),
    ])
    expect(sessions).toHaveLength(2)
    expect(sessions.map((session) => session.month)).toEqual(['2026-07', '2026-08'])
  })

  it('プロジェクトが違えば別の行にする', () => {
    const sessions = aggregateSessions([
      event({ projectKey: 'project_a' }),
      event({ projectKey: 'project_b' }),
    ])
    expect(sessions).toHaveLength(2)
  })

  it('最初に現れた生参照とラベルを採用する', () => {
    const sessions = aggregateSessions([
      event({
        projectLabel: 'pairs',
        localReference: {
          nativeSessionId: 'native-1',
          sourcePath: '/a.jsonl',
          workingDirectory: '/work/pairs',
          contentHash: 'hash-native-1',
          byteSize: 100,
          fileMtime: '2026-07-15T10:00:00.000Z',
        },
      }),
      event({ projectLabel: undefined, localReference: undefined }),
    ])
    expect(sessions[0]?.projectLabel).toBe('pairs')
    expect(sessions[0]?.localReference?.nativeSessionId).toBe('native-1')
  })

  it('空配列は空配列を返す', () => {
    expect(aggregateSessions([])).toEqual([])
  })

  it('非UTC形式のタイムスタンプを診断へ計上する', () => {
    const diagnostics = { nonUtcTimestamps: 0 }
    aggregateSessions(
      [
        event({ observedAt: '2026-07-15T10:00:00.000Z' }),
        event({ observedAt: '2026-07-15T10:00:00.000-05:00' }),
      ],
      diagnostics,
    )
    expect(diagnostics.nonUtcTimestamps).toBe(1)
  })

  it('診断オブジェクトを渡さなくても動作する', () => {
    expect(() =>
      aggregateSessions([event({ observedAt: '2026-07-15T10:00:00.000-05:00' })]),
    ).not.toThrow()
  })
})
