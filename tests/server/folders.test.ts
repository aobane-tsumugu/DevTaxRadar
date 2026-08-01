import { describe, expect, it } from 'vitest'
import type { UsageSessionRow } from '../../src/server/database.js'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { summarizeFolders } from '../../src/server/folders.js'

function session(overrides: Partial<UsageSessionRow> = {}): UsageSessionRow {
  return {
    provider: 'claude',
    sessionKey: 'session_a',
    projectKey: 'project_a',
    month: '2026-07',
    startedAt: '2026-07-15T01:00:00.000Z',
    endedAt: '2026-07-15T02:00:00.000Z',
    messageCount: 5,
    projectLabel: 'my-app',
    model: 'claude-opus-5',
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  }
}

function planning(rules: PlanningSnapshot['projectRules'] = []): PlanningSnapshot {
  return {
    ...emptyPlanningSnapshot(2026),
    taxUnits: [
      {
        id: 'unit-a',
        name: '公開アプリ A',
        unitType: 'new-software',
        usageMode: 'external',
        revenueModel: 'sales',
        lifecycleStatus: 'developing',
      },
    ],
    projectRules: rules,
  }
}

describe('summarizeFolders', () => {
  it('同じフォルダのセッションを1件へまとめる', () => {
    const folders = summarizeFolders(
      [session({ sessionKey: 'a' }), session({ sessionKey: 'b', messageCount: 3 })],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders).toHaveLength(1)
    expect(folders[0]).toMatchObject({
      projectKey: 'project_a',
      label: 'my-app',
      sessionCount: 2,
      messageCount: 8,
    })
  })

  it('利用期間を最初と最後のセッションから求める', () => {
    const folders = summarizeFolders(
      [
        session({
          sessionKey: 'a',
          startedAt: '2026-05-01T01:00:00.000Z',
          endedAt: '2026-05-01T02:00:00.000Z',
        }),
        session({
          sessionKey: 'b',
          startedAt: '2026-07-20T01:00:00.000Z',
          endedAt: '2026-07-20T02:00:00.000Z',
        }),
      ],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders[0]?.firstUsedOn).toBe('2026-05-01')
    expect(folders[0]?.lastUsedOn).toBe('2026-07-20')
  })

  it('利用したAIサービスを重複なく列挙する', () => {
    const folders = summarizeFolders(
      [
        session({ sessionKey: 'a', provider: 'claude' }),
        session({ sessionKey: 'b', provider: 'codex' }),
        session({ sessionKey: 'c', provider: 'claude' }),
      ],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders[0]?.providers).toEqual(['claude', 'codex'])
  })

  it('ルールがなければ未割当として返す', () => {
    const folders = summarizeFolders([session()], planning(), 'Asia/Tokyo')

    expect(folders[0]?.assignments).toEqual([])
    expect(folders[0]?.unassignedSessionCount).toBe(1)
  })

  it('適用中のルールを割当として返す', () => {
    const folders = summarizeFolders(
      [session()],
      planning([
        {
          id: 'rule-1',
          projectKey: 'project_a',
          effectiveFrom: '2026-01-01',
          taxUnitId: 'unit-a',
          classification: 'new-development',
        },
      ]),
      'Asia/Tokyo',
    )

    expect(folders[0]?.assignments).toEqual([
      {
        ruleId: 'rule-1',
        taxUnitId: 'unit-a',
        taxUnitName: '公開アプリ A',
        classification: 'new-development',
        effectiveFrom: '2026-01-01',
        effectiveTo: undefined,
        provider: undefined,
        sessionCount: 1,
      },
    ])
    expect(folders[0]?.unassignedSessionCount).toBe(0)
  })

  it('期間で分かれたルールをそれぞれの適用件数とともに返す', () => {
    const folders = summarizeFolders(
      [
        session({
          sessionKey: 'a',
          startedAt: '2026-07-05T01:00:00.000Z',
          endedAt: '2026-07-05T02:00:00.000Z',
        }),
        session({
          sessionKey: 'b',
          startedAt: '2026-07-25T01:00:00.000Z',
          endedAt: '2026-07-25T02:00:00.000Z',
        }),
      ],
      planning([
        {
          id: 'rule-early',
          projectKey: 'project_a',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-07-14',
          taxUnitId: 'unit-a',
          classification: 'new-development',
        },
        {
          id: 'rule-late',
          projectKey: 'project_a',
          effectiveFrom: '2026-07-15',
          taxUnitId: 'unit-a',
          classification: 'maintenance',
        },
      ]),
      'Asia/Tokyo',
    )

    expect(folders[0]?.assignments.map((item) => [item.ruleId, item.sessionCount])).toEqual([
      ['rule-early', 1],
      ['rule-late', 1],
    ])
  })

  it('制作物を指定しないルールは分類だけを返す', () => {
    const folders = summarizeFolders(
      [session()],
      planning([
        {
          id: 'rule-private',
          projectKey: 'project_a',
          effectiveFrom: '2026-01-01',
          classification: 'private',
        },
      ]),
      'Asia/Tokyo',
    )

    expect(folders[0]?.assignments[0]).toMatchObject({
      taxUnitId: undefined,
      taxUnitName: undefined,
      classification: 'private',
    })
  })

  it('利用量の多い順に並べる', () => {
    const folders = summarizeFolders(
      [
        session({ projectKey: 'small', sessionKey: 'a', projectLabel: 'small' }),
        session({ projectKey: 'big', sessionKey: 'b', projectLabel: 'big' }),
        session({ projectKey: 'big', sessionKey: 'c', projectLabel: 'big' }),
      ],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders.map((folder) => folder.projectKey)).toEqual(['big', 'small'])
  })

  it('ラベルがなければ末尾6文字から表示名を作る', () => {
    const folders = summarizeFolders(
      [session({ projectLabel: null, projectKey: 'project_abcdef123456' })],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders[0]?.label).toBe('Project 123456')
  })
})
