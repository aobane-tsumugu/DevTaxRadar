import { chargeContractBasis } from '../../src/core/chargePeriods.js'
import { describe, expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { mergeWorkspaceDrafts, type WorkspaceContents } from '../../src/core/workspaceMerge.js'

function initial(): WorkspaceContents {
  return {
    configuration: {
      charges: { claude: 1000, codex: 2000 },
      contracts: { claude: {}, codex: {} },
      monthlyCharges: [],
      chargePeriods: [],
      unobservedRatio: null,
    },
    planning: {
      ...emptyPlanningSnapshot(2026),
      directCosts: [
        {
          id: 'domain',
          costType: 'domain',
          incurredOn: '2026-01-01',
          amountJpy: 1000,
          directlyAttributable: false,
          treatment: 'general',
          evidenceIds: [],
        },
      ],
    },
  }
}

describe('workspace three-way record comparison', () => {
  it('keeps invoice amounts and contract confirmations together during conflicts', () => {
    const base = initial()
    const period = {
      id: 'a',
      provider: 'claude' as const,
      planName: '合成',
      serviceStartedOn: '2026-01-01',
      serviceEndedOn: '2026-01-31',
      amountJpy: 1000,
    }
    base.configuration.chargePeriods = [period]
    const local = structuredClone(base),
      latest = structuredClone(base)
    local.configuration.chargePeriods![0]!.contractConfirmation = {
      reference: '契約A',
      reason: '明細照合',
      confirmedAt: '2026-09-09T00:00:00Z',
      basis: chargeContractBasis(period),
    }
    latest.configuration.chargePeriods![0]!.amountJpy = 2000
    expect(mergeWorkspaceDrafts(base, local, latest).contents).toBeNull()
    const selected = mergeWorkspaceDrafts(base, local, latest, {
      [JSON.stringify(['chargePeriods', 'a'])]: 'local',
    }).contents!
    expect(selected.configuration.chargePeriods).toEqual(local.configuration.chargePeriods)
  })
  it('chooses the default charge amount and its unknown reason together', () => {
    const base = initial(),
      local = structuredClone(base),
      latest = structuredClone(base)
    local.configuration.charges.claude = null
    local.configuration.unknownChargeReasons = { claude: '請求書待ち' }
    latest.configuration.charges.claude = 0
    expect(mergeWorkspaceDrafts(base, local, latest).contents).toBeNull()
    const mine = mergeWorkspaceDrafts(base, local, latest, { 'charges:claude': 'local' }).contents!
    expect(mine.configuration.charges.claude).toBeNull()
    expect(mine.configuration.unknownChargeReasons).toEqual({ claude: '請求書待ち' })
    const theirs = mergeWorkspaceDrafts(base, local, latest, {
      'charges:claude': 'latest',
    }).contents!
    expect(theirs.configuration.charges.claude).toBe(0)
    expect(theirs.configuration.unknownChargeReasons).toBeUndefined()
  })
  it('compares annual declarations by year and category even with different generated IDs', () => {
    const base = initial(),
      local = structuredClone(base),
      latest = structuredClone(base)
    const record = {
      id: 'local-id',
      taxYear: 2026,
      category: 'home' as const,
      status: 'not-applicable' as const,
      reason: '自宅費用なし',
      recordedAt: '2026-09-08T00:00:00Z',
    }
    local.planning.costPresence = [record]
    latest.planning.costPresence = [
      { ...record, id: 'other-id', status: 'deferred', reason: '照合待ち' },
      { ...record, id: 'next-year', taxYear: 2027 },
    ]
    const comparison = mergeWorkspaceDrafts(base, local, latest)
    expect(comparison.contents).toBeNull()
    expect(comparison.changes.filter((row) => row.conflict)).toHaveLength(1)
    const resolved = mergeWorkspaceDrafts(base, local, latest, {
      [JSON.stringify(['costPresence', '2026:home'])]: 'local',
    })
    expect(resolved.contents?.planning.costPresence).toEqual([
      record,
      latest.planning.costPresence[1],
    ])
    base.planning.costPresence = [record]
    local.planning.costPresence = []
    expect(mergeWorkspaceDrafts(base, local, latest).contents).toBeNull()
  })

  it('keeps independent changes, keyed additions and deletions, without mutating inputs', () => {
    const base = initial(),
      local = structuredClone(base),
      latest = structuredClone(base)
    local.configuration.charges.claude = 3000
    local.configuration.monthlyCharges = [{ provider: 'codex', month: '2025-12', amountJpy: 4000 }]
    local.planning.directCosts = []
    latest.configuration.charges.codex = 5000
    latest.planning.profile.notes = '最新の活動メモ'
    const result = mergeWorkspaceDrafts(base, local, latest)
    expect(result.contents?.configuration.charges).toEqual({ claude: 3000, codex: 5000 })
    expect(result.contents?.configuration.monthlyCharges).toEqual(
      local.configuration.monthlyCharges,
    )
    expect(result.contents?.planning.directCosts).toEqual([])
    expect(result.contents?.planning.profile.notes).toBe('最新の活動メモ')
    expect(result.changes).toHaveLength(5)
    expect(result.changes.every((row) => row.choice && !row.conflict)).toBe(true)
    result.contents!.configuration.charges.claude = 9999
    expect(local.configuration.charges.claude).toBe(3000)
    expect(base.configuration.charges.claude).toBe(1000)
  })

  it('requires an explicit choice for null versus zero and preserves whole records rather than mixing facts', () => {
    const base = initial(),
      local = structuredClone(base),
      latest = structuredClone(base)
    base.configuration.unobservedRatio = 0.1
    local.configuration.unobservedRatio = null
    latest.configuration.unobservedRatio = 0
    local.planning.directCosts[0]!.amountJpy = 5000
    latest.planning.directCosts[0]!.note = '最新側で対応理由を確認'
    const comparison = mergeWorkspaceDrafts(base, local, latest)
    expect(comparison.contents).toBeNull()
    expect(comparison.changes.filter((row) => row.conflict)).toHaveLength(2)
    const selected = mergeWorkspaceDrafts(base, local, latest, {
      unobservedRatio: 'latest',
      [JSON.stringify(['directCosts', 'domain'])]: 'local',
    })
    expect(selected.contents?.configuration.unobservedRatio).toBe(0)
    expect(selected.contents?.planning.directCosts[0]).toEqual(local.planning.directCosts[0])
    expect(selected.contents?.planning.directCosts[0]?.note).toBeUndefined()
  })

  it('distinguishes deletion from modification and handles concurrent additions with the same ID', () => {
    const base = initial(),
      local = structuredClone(base),
      latest = structuredClone(base)
    local.planning.directCosts = []
    latest.planning.directCosts[0]!.amountJpy = 2000
    local.configuration.monthlyCharges = [{ provider: 'claude', month: '2026-07', amountJpy: 100 }]
    latest.configuration.monthlyCharges = [{ provider: 'claude', month: '2026-07', amountJpy: 200 }]
    const comparison = mergeWorkspaceDrafts(base, local, latest)
    expect(comparison.contents).toBeNull()
    expect(comparison.changes.every((row) => row.conflict)).toBe(true)
    const selected = mergeWorkspaceDrafts(
      base,
      local,
      latest,
      Object.fromEntries(comparison.changes.map((row) => [row.key, 'local' as const])),
    )
    expect(selected.contents?.planning.directCosts).toEqual([])
    expect(selected.contents?.configuration.monthlyCharges[0]?.amountJpy).toBe(100)
  })

  it('ignores object key order and omitted optional fields, recognizes identical edits, and rejects duplicate IDs', () => {
    const base = initial(),
      local = structuredClone(base),
      latest = structuredClone(base)
    local.planning.directCosts[0] = { ...local.planning.directCosts[0]!, note: undefined }
    latest.planning.directCosts[0] = Object.fromEntries(
      Object.entries(latest.planning.directCosts[0]!).reverse(),
    ) as (typeof latest.planning.directCosts)[number]
    expect(mergeWorkspaceDrafts(base, local, latest).changes).toEqual([])
    local.configuration.unobservedRatio = latest.configuration.unobservedRatio = 0
    expect(mergeWorkspaceDrafts(base, local, latest).changes[0]).toMatchObject({
      conflict: false,
      choice: 'latest',
    })
    local.planning.directCosts.push({ ...local.planning.directCosts[0]! })
    expect(() => mergeWorkspaceDrafts(base, local, latest)).toThrow('重複')
  })
})
