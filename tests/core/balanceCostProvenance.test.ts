import { describe, expect, it } from 'vitest'
import type { AnnualCostProjection, CostSnapshot } from '../../src/accounting/costs.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { checkBalanceCostProvenance } from '../../src/core/balanceCostProvenance.js'
import { projectAnnualCosts } from '../../src/core/costProjection.js'
import { validateBalanceSnapshot } from '../../src/core/annualBalances.js'

function costs(): AnnualCostProjection {
  const data: CostSnapshot = {
    version: 1,
    taxUnits: [{ id: 'u', name: '合成制作物' }],
    sources: [
      {
        id: 's',
        kind: 'direct',
        label: '合成支払',
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
        method: { id: 'fixture', version: '1', explanation: '合成配分' },
        warnings: [],
      },
    ],
    contributions: [
      {
        id: 'c',
        basisId: 'b',
        target: { kind: 'tax-unit', taxUnitId: 'u' },
        amountJpy: 100,
        reason: '合成',
        evidenceIds: [],
      },
    ],
  }
  return projectAnnualCosts(data, 2026)
}
function balances(amount = 60): BalanceSnapshot {
  return {
    version: 1,
    accounts: [
      {
        id: 'a',
        taxUnitId: 'u',
        name: '合成',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    pendingDecisions: [],
    movements: [
      {
        id: 'm',
        kind: 'addition',
        accountId: 'a',
        occurredOn: '2026-12-31',
        amountJpy: amount,
        sourceIds: ['s'],
        decisionId: 'd',
        reason: '合成',
        costAllocations: [{ costYear: 2026, contributionId: 'c', amountJpy: amount }],
      },
    ],
  }
}
describe('cost contributions funding balance additions', () => {
  it('keeps unused cost separate from unlinked additions and never consumes costs again on transfer', () => {
    const snapshot = balances()
    snapshot.accounts.push({ ...snapshot.accounts[0]!, id: 'asset', kind: 'asset' })
    snapshot.movements.push({
      id: 't',
      kind: 'transfer',
      fromAccountId: 'a',
      toAccountId: 'asset',
      occurredOn: '2027-01-01',
      amountJpy: 60,
      sourceIds: ['s'],
      decisionId: 'd2',
      reason: '完成',
    })
    const check = checkBalanceCostProvenance(snapshot, [costs()], 2027)
    expect(check.status).toBe('consistent')
    expect(check.contributions[0]).toMatchObject({
      claimedJpy: 60,
      remainingJpy: 40,
      movementIds: ['m'],
    })
    snapshot.movements[0]!.amountJpy = 80
    expect(checkBalanceCostProvenance(snapshot, [costs()], 2027)).toMatchObject({
      status: 'incomplete',
      additions: [{ linkedJpy: 60, unlinkedJpy: 20 }],
    })
  })
  it('detects a second use across years and accounts without changing the earlier year check', () => {
    const snapshot = balances()
    const before = checkBalanceCostProvenance(snapshot, [costs()], 2026)
    snapshot.accounts.push({ ...snapshot.accounts[0]!, id: 'other' })
    snapshot.movements.push({
      ...snapshot.movements[0]!,
      id: 'later',
      kind: 'addition',
      accountId: 'other',
      occurredOn: '2027-01-01',
    })
    expect(checkBalanceCostProvenance(snapshot, [costs()], 2026)).toEqual(before)
    const check = checkBalanceCostProvenance(snapshot, [costs()], 2027)
    expect(check.status).toBe('invalid')
    expect(check.contributions[0]).toMatchObject({
      claimedJpy: 120,
      remainingJpy: null,
      movementIds: ['m', 'later'],
    })
  })
  it('rejects missing, private, consumed, wrong-unit and missing-original-reference links', () => {
    for (const change of [
      (p: AnnualCostProjection) => {
        p.contributions = []
      },
      (p: AnnualCostProjection) => {
        p.contributions[0]!.target = { kind: 'private' }
      },
      (p: AnnualCostProjection) => {
        p.contributions[0]!.consumedByBasisId = 'child'
      },
      (p: AnnualCostProjection) => {
        p.contributions[0]!.target = { kind: 'tax-unit', taxUnitId: 'other' }
      },
      (p: AnnualCostProjection) => {
        p.contributions[0]!.sourceIds = ['missing']
      },
    ]) {
      const p = costs()
      change(p)
      expect(checkBalanceCostProvenance(balances(), [p], 2026).status).toBe('invalid')
    }
    const snapshot = balances()
    if (snapshot.movements[0]!.kind === 'addition')
      snapshot.movements[0]!.costAllocations![0]!.costYear = 2027
    const future = costs()
    future.year = 2027
    expect(checkBalanceCostProvenance(snapshot, [future], 2027).issues[0]!.message).toContain(
      '増加年より後',
    )
  })
  it('retains missing legacy links as incomplete, validates totals, and reports unsafe aggregate claims without unsafe numbers', () => {
    const snapshot = balances()
    if (snapshot.movements[0]!.kind !== 'addition') throw new Error('fixture')
    snapshot.movements[0]!.costAllocations = undefined
    expect(checkBalanceCostProvenance(snapshot, [costs()], 2026).status).toBe('incomplete')
    snapshot.movements[0]!.costAllocations = [
      { costYear: 2026, contributionId: 'c', amountJpy: 61 },
    ]
    expect(() => validateBalanceSnapshot(snapshot)).toThrow('対応額が増加額を超え')
    const max = balances(Number.MAX_SAFE_INTEGER)
    max.accounts.push({ ...max.accounts[0]!, id: 'other' })
    max.movements.push({ ...max.movements[0]!, id: 'extra', kind: 'addition', accountId: 'other' })
    const p = costs()
    p.contributions[0]!.amountJpy = Number.MAX_SAFE_INTEGER
    expect(checkBalanceCostProvenance(max, [p], 2026).contributions[0]).toMatchObject({
      claimedJpy: null,
      remainingJpy: null,
    })
  })
})
