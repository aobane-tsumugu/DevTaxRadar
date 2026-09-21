import { describe, expect, it } from 'vitest'
import { buildTaskHubItems } from '../../src/client/taskHub'
import type { Diagnosis } from '../../src/planning/types'

const diagnosis = (overrides: Partial<Diagnosis> = {}): Diagnosis => ({
  currentPosition: [],
  immediateActions: [],
  eventTriggeredActions: [],
  missingFacts: [],
  ...overrides,
})

describe('buildTaskHubItems', () => {
  it('puts restore and unknown-charge work ahead of annual review', () => {
    const items = buildTaskHubItems({
      restoreRequiresReconnect: true,
      unknownChargeCount: 2,
      unassignedFolderCount: 1,
      unavailableSourceCount: 1,
      taxUnitCount: 1,
      diagnosis: diagnosis(),
    })

    expect(items.slice(0, 4).map((item) => item.id)).toEqual([
      'restore-reconnect',
      'unknown-charges',
      'unassigned-folders',
      'unavailable-sources',
    ])
    expect(items.at(-2)?.id).toBe('annual-review')
    expect(items.at(-1)?.id).toBe('balance-review')
  })

  it('does not claim completion when no urgent task exists', () => {
    const items = buildTaskHubItems({
      restoreRequiresReconnect: false,
      unknownChargeCount: 0,
      unassignedFolderCount: 0,
      unavailableSourceCount: 0,
      taxUnitCount: 1,
      diagnosis: diagnosis(),
    })

    expect(items.map((item) => item.id)).toEqual(['annual-review', 'balance-review'])
    expect(items.every((item) => !/完了|合格/.test(item.title + item.reason))).toBe(true)
  })

  it('keeps diagnosis actions as confirmation work rather than automatic decisions', () => {
    const items = buildTaskHubItems({
      restoreRequiresReconnect: false,
      unknownChargeCount: 0,
      unassignedFolderCount: 0,
      unavailableSourceCount: 0,
      taxUnitCount: 1,
      diagnosis: diagnosis({
        immediateActions: [{
          id: 'confirm-use',
          priority: 'high',
          title: '実際に使い始めた日を確認',
          reason: '年額計算に必要です。',
          trigger: 'now',
        }],
      }),
    })

    expect(items[0]).toMatchObject({
      id: 'diagnosis-confirm-use',
      destination: 'setup',
      priority: 'high',
    })
  })
})
