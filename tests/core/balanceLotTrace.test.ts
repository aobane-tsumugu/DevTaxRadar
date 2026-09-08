import { describe, expect, it } from 'vitest'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { traceBalanceLots } from '../../src/core/balanceLotTrace.js'
import { balanceSnapshotSchema } from '../../src/accounting/balanceSchema.js'
import { projectAnnualCosts } from '../../src/core/costProjection.js'

function fixture(mixed = false) {
  const costs = projectAnnualCosts(
    {
      version: 1,
      taxUnits: [{ id: 'u', name: '合成' }],
      sources: [
        {
          id: 's',
          kind: 'direct',
          label: '合成',
          originalAmountJpy: 100,
          currency: 'JPY',
          evidenceIds: [],
          origin: 'entered',
        },
      ],
      bases: [
        {
          id: 'b',
          sourceId: 's',
          parentContributionIds: [],
          affectedTaxUnitIds: ['u'],
          period: { startedOn: '2026-01-01', endedOn: '2026-12-31' },
          amount: { status: 'known', amountJpy: 100 },
          method: { id: 'fixture', version: '1', explanation: '合成' },
          warnings: [],
        },
      ],
      contributions: (mixed ? [60, 40] : [100]).map((amountJpy, i) => ({
        id: 'c' + i,
        basisId: 'b',
        target: { kind: 'tax-unit' as const, taxUnitId: 'u' },
        amountJpy,
        reason: '合成',
        evidenceIds: [],
      })),
    },
    2026,
  )
  const common = { occurredOn: '2026-01-01', sourceIds: ['s'], decisionId: 'd', reason: '合成' }
  const snapshot: BalanceSnapshot = {
    version: 1,
    pendingDecisions: [],
    accounts: ['a', 'b'].map((id) => ({
      id,
      taxUnitId: 'u',
      name: id,
      kind: 'construction',
      openingYear: 2026,
      opening: { status: 'known', amountJpy: 0 },
    })),
    movements: [
      {
        ...common,
        id: 'add',
        kind: 'addition',
        accountId: 'a',
        amountJpy: 100,
        costAllocations: costs.contributions.map((c) => ({
          costYear: 2026,
          contributionId: c.id,
          amountJpy: c.amountJpy,
        })),
      },
      {
        ...common,
        id: 'transfer',
        kind: 'transfer',
        fromAccountId: 'a',
        toAccountId: 'b',
        amountJpy: 100,
        balanceAllocations: [{ sourceKind: 'movement', sourceId: 'add', amountJpy: 100 }],
      },
      {
        ...common,
        id: 'expense',
        kind: 'expense',
        accountId: 'b',
        amountJpy: 40,
        balanceAllocations: [{ sourceKind: 'movement', sourceId: 'transfer', amountJpy: 40 }],
      },
    ],
  }
  return { costs, snapshot }
}

describe('cost lots through balance transfers and consumption', () => {
  it('uses explicit mixed lots, rejects overuse hidden by other lots, and preserves unresolved remainders', () => {
    const { costs, snapshot } = fixture(true)
    const link = snapshot.movements[2]!.balanceAllocations![0]!
    link.costAllocations = [{ costYear: 2026, contributionId: 'c0', amountJpy: 40 }]
    expect(
      balanceSnapshotSchema.parse(snapshot).movements[2]!.balanceAllocations![0]!.costAllocations,
    ).toEqual(link.costAllocations)
    let result = traceBalanceLots(snapshot, [costs], 2026)
    expect(result.status).toBe('consistent')
    expect(result.remaining.find((r) => r.sourceId === 'transfer')!.lots).toMatchObject([
      { remainingJpy: 20 },
      { remainingJpy: 40 },
    ])
    snapshot.movements.push({
      ...snapshot.movements[2]!,
      id: 'second',
      amountJpy: 30,
      balanceAllocations: [
        {
          ...link,
          amountJpy: 30,
          costAllocations: [{ costYear: 2026, contributionId: 'c0', amountJpy: 30 }],
        },
      ],
    })
    result = traceBalanceLots(snapshot, [costs], 2026)
    expect(result).toMatchObject({ status: 'invalid', movements: [], remaining: [] })
    expect(result.issues.some((issue) => issue.message.includes('使用合計'))).toBe(true)
    snapshot.movements[3]!.balanceAllocations![0]!.costAllocations![0]!.contributionId = 'c1'
    result = traceBalanceLots(snapshot, [costs], 2026)
    expect(result.status).toBe('consistent')
    expect(result.remaining.find((r) => r.sourceId === 'transfer')!.lots).toMatchObject([
      { remainingJpy: 20 },
      { remainingJpy: 10 },
    ])
    link.costAllocations = []
    expect(
      traceBalanceLots(snapshot, [costs], 2026).movements.find((r) => r.movementId === 'expense'),
    ).toMatchObject({ lots: [], untracedJpy: 40 })
    link.costAllocations = [{ costYear: 2026, contributionId: 'missing', amountJpy: 40 }]
    expect(traceBalanceLots(snapshot, [costs], 2026).status).toBe('invalid')
    link.costAllocations = [{ costYear: 2026, contributionId: 'c0', amountJpy: 41 }]
    expect(() => traceBalanceLots(snapshot, [costs], 2026)).toThrow('原価内訳の合計')
    link.costAllocations = [
      { costYear: 2026, contributionId: 'c0', amountJpy: 20 },
      { costYear: 2026, contributionId: 'c0', amountJpy: 20 },
    ]
    expect(() => traceBalanceLots(snapshot, [costs], 2026)).toThrow('重複指定')
  })
  it('traces a single lot through transfer and partial expense without consuming the original cost twice', () => {
    const { costs, snapshot } = fixture()
    const before = structuredClone(snapshot)
    const result = traceBalanceLots(snapshot, [costs], 2026)
    expect(result.status).toBe('consistent')
    expect(result.movements.find((r) => r.movementId === 'expense')).toMatchObject({
      lots: [{ contributionId: 'c0', amountJpy: 40 }],
      untracedJpy: 0,
    })
    expect(result.remaining.find((r) => r.sourceId === 'add')).toMatchObject({
      amountJpy: 0,
      lots: [{ remainingJpy: 0 }],
    })
    expect(result.remaining.find((r) => r.sourceId === 'transfer')).toMatchObject({
      amountJpy: 60,
      lots: [{ contributionId: 'c0', remainingJpy: 60 }],
      untracedJpy: 0,
    })
    snapshot.movements.reverse()
    const reversed = traceBalanceLots(snapshot, [costs], 2026)
    expect(reversed.movements).toEqual(result.movements)
    expect(reversed.remaining).toEqual(expect.arrayContaining(result.remaining))
    snapshot.movements.reverse()
    expect(snapshot).toEqual(before)
  })
  it('moves a whole mixture exactly but leaves partial selection and remaining lot amounts unknown', () => {
    const { costs, snapshot } = fixture(true)
    const result = traceBalanceLots(snapshot, [costs], 2026)
    expect(result.status).toBe('incomplete')
    expect(
      result.movements.find((r) => r.movementId === 'transfer')!.lots.map((l) => l.amountJpy),
    ).toEqual([60, 40])
    expect(result.movements.find((r) => r.movementId === 'expense')).toMatchObject({
      lots: [],
      untracedJpy: 40,
    })
    expect(result.remaining.find((r) => r.sourceId === 'transfer')).toMatchObject({
      amountJpy: 60,
      lots: [{ remainingJpy: null }, { remainingJpy: null }],
      untracedJpy: null,
    })
    expect(result.issues[0]!.message).toContain('内訳が未確定')
    snapshot.movements.push({
      ...snapshot.movements[2]!,
      id: 'rest',
      amountJpy: 60,
      balanceAllocations: [{ sourceKind: 'movement', sourceId: 'transfer', amountJpy: 60 }],
    })
    const exhausted = traceBalanceLots(snapshot, [costs], 2026)
    expect(exhausted.status).toBe('incomplete')
    expect(exhausted.remaining.find((r) => r.sourceId === 'transfer')).toMatchObject({
      amountJpy: 0,
      lots: [{ remainingJpy: 0 }, { remainingJpy: 0 }],
      untracedJpy: 0,
    })
  })
  it('does not treat a partially documented source or opening as a known single lot', () => {
    const { costs, snapshot } = fixture()
    if (snapshot.movements[0]!.kind !== 'addition') throw new Error('fixture')
    snapshot.movements[0]!.costAllocations![0]!.amountJpy = 60
    let result = traceBalanceLots(snapshot, [costs], 2026)
    expect(result.movements.find((r) => r.movementId === 'transfer')).toMatchObject({
      untracedJpy: 40,
    })
    expect(result.movements.find((r) => r.movementId === 'expense')).toMatchObject({
      lots: [],
      untracedJpy: 40,
    })
    snapshot.movements = []
    snapshot.accounts[0]!.opening = { status: 'known', amountJpy: 80 }
    result = traceBalanceLots(snapshot, [costs], 2026)
    expect(result).toMatchObject({
      status: 'incomplete',
      remaining: expect.arrayContaining([
        expect.objectContaining({ sourceId: 'a', amountJpy: 80, untracedJpy: 80 }),
      ]),
    })
    snapshot.accounts[0]!.opening = { status: 'unknown', amountJpy: null, reasons: ['確認中'] }
    expect(traceBalanceLots(snapshot, [costs], 2026).remaining[0]!.untracedJpy).toBeNull()
  })
  it('refuses tracing invalid flow or cost claims and excludes future movements', () => {
    const { costs, snapshot } = fixture()
    snapshot.movements[2]!.occurredOn = '2027-01-01'
    expect(
      traceBalanceLots(snapshot, [costs], 2026).remaining.find((r) => r.sourceId === 'transfer')!
        .amountJpy,
    ).toBe(100)
    snapshot.movements[2]!.balanceAllocations![0]!.sourceId = 'missing'
    expect(traceBalanceLots(snapshot, [costs], 2027)).toMatchObject({
      status: 'invalid',
      movements: [],
      remaining: [],
    })
    snapshot.movements[2]!.balanceAllocations![0]!.sourceId = 'transfer'
    costs.contributions[0]!.amountJpy = 50
    expect(traceBalanceLots(snapshot, [costs], 2027)).toMatchObject({
      status: 'invalid',
      movements: [],
    })
  })
})
