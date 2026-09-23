import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { AnnualCostProjection } from '../../src/accounting/costs.js'
import type { BalanceMovement, BalanceSnapshot } from '../../src/accounting/types.js'
import { applyCostLinkSuggestion, suggestCostLink } from '../../src/core/balanceCostDraft.js'

type Addition = Extract<BalanceMovement, { kind: 'addition' }>
function fixture() {
  const movement: Addition = {
    id: 'draft',
    kind: 'addition',
    accountId: 'account',
    occurredOn: '2026-07-31',
    amountJpy: NaN,
    sourceIds: ['user-evidence'],
    decisionId: 'decision',
    reason: '選択した費用を取り込む',
  }
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'account',
        taxUnitId: 'unit',
        name: '制作中',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    movements: [movement],
    pendingDecisions: [],
  }
  const costs: AnnualCostProjection = {
    version: 1,
    engineVersion: 'cost-projection/1',
    year: 2026,
    invariantSatisfied: true,
    sources: [
      {
        id: 'direct:invoice',
        kind: 'direct',
        label: '合成請求',
        originalAmountJpy: 10000,
        currency: 'JPY',
        evidenceIds: [],
        origin: 'entered',
      },
    ],
    bases: [
      {
        id: 'basis',
        sourceId: 'direct:invoice',
        parentContributionIds: [],
        affectedTaxUnitIds: ['unit'],
        period: { startedOn: '2026-07-01', endedOn: '2026-07-31' },
        amount: { status: 'known', amountJpy: 10000 },
        method: { id: 'fixture', version: '1', explanation: '合成' },
        warnings: [],
      },
    ],
    contributions: [
      {
        id: 'cost',
        basisId: 'basis',
        target: { kind: 'tax-unit', taxUnitId: 'unit' },
        amountJpy: 10000,
        reason: '合成',
        evidenceIds: [],
        sourceIds: ['direct:invoice'],
      },
    ],
    totals: {
      knownBasisJpy: 10000,
      taxUnitJpy: 10000,
      generalJpy: 0,
      privateJpy: 0,
      unallocatedJpy: 0,
      unobservedJpy: 0,
      roundingJpy: 0,
      unknownBasisIds: [],
    },
    byTaxUnit: [
      {
        taxUnitId: 'unit',
        name: '合成',
        amountJpy: 10000,
        contributionIds: ['cost'],
        unknownBasisIds: [],
      },
    ],
  }
  return { movement, snapshot, costs }
}
function previous(amount = 4000, date = '2026-07-31'): Addition {
  return {
    id: 'used',
    kind: 'addition',
    accountId: 'account',
    occurredOn: date,
    amountJpy: amount,
    sourceIds: ['direct:invoice'],
    decisionId: 'decision',
    reason: '以前の対応',
    costAllocations: [{ costYear: 2026, contributionId: 'cost', amountJpy: amount }],
  }
}
function reject(change: (f: ReturnType<typeof fixture>) => void, pattern?: RegExp) {
  const f = fixture()
  change(f)
  const original = structuredClone(f)
  const result = suggestCostLink(f.snapshot, f.movement, f.costs, 'cost')
  assert.equal(result.available, false)
  if (!result.available && pattern) assert.match(result.reason, pattern)
  assert.throws(() => applyCostLinkSuggestion(f.snapshot, f.movement, f.costs, 'cost'))
  assert.deepEqual(f, original)
}

describe('source-bound cost prefill', () => {
  it('fills amount and source references together, without changing decision or inputs', () => {
    const f = fixture(),
      original = structuredClone(f)
    const next = applyCostLinkSuggestion(f.snapshot, f.movement, f.costs, 'cost')
    assert.equal(next.amountJpy, 10000)
    assert.deepEqual(next.costAllocations, [
      { costYear: 2026, contributionId: 'cost', amountJpy: 10000 },
    ])
    assert.deepEqual(next.sourceIds, ['user-evidence', 'direct:invoice'])
    assert.equal(next.decisionId, f.movement.decisionId)
    assert.equal(next.reason, f.movement.reason)
    assert.deepEqual(f, original)
  })
  for (const year of [2026, 2027, 2029])
    it(`counts existing claims in ${year} before prefilling an earlier year`, () => {
      const f = fixture()
      f.snapshot.movements.push(previous(4000, `${year}-07-31`))
      assert.equal(applyCostLinkSuggestion(f.snapshot, f.movement, f.costs, 'cost').amountJpy, 6000)
    })
  it('counts independent claims in different accounts rather than checking only the current account', () => {
    const f = fixture()
    f.snapshot.movements.push({ ...previous(8000), accountId: 'another-account' })
    assert.equal(applyCostLinkSuggestion(f.snapshot, f.movement, f.costs, 'cost').amountJpy, 2000)
  })
  it('does not consume a cost twice when its posted balance is transferred', () => {
    const f = fixture()
    f.snapshot.movements.push(previous(4000), {
      id: 'transfer',
      kind: 'transfer',
      fromAccountId: 'account',
      toAccountId: 'another',
      occurredOn: '2026-08-01',
      amountJpy: 4000,
      sourceIds: ['direct:invoice'],
      decisionId: 'transfer-decision',
      reason: '振替',
      balanceAllocations: [{ sourceKind: 'movement', sourceId: 'used', amountJpy: 4000 }],
    })
    assert.equal(applyCostLinkSuggestion(f.snapshot, f.movement, f.costs, 'cost').amountJpy, 6000)
  })
  it('preserves existing links and makes the explicit replacement total exact', () => {
    const f = fixture()
    f.movement.costAllocations = [{ costYear: 2025, contributionId: 'other', amountJpy: 1234 }]
    f.movement.amountJpy = 99999
    const next = applyCostLinkSuggestion(f.snapshot, f.movement, f.costs, 'cost')
    assert.equal(next.amountJpy, 11234)
    assert.equal(next.costAllocations!.length, 2)
    assert.equal(f.movement.amountJpy, 99999)
  })
  it('blocks repeat selection', () =>
    reject((f) => {
      f.movement.costAllocations = [{ costYear: 2026, contributionId: 'cost', amountJpy: 200 }]
    }, /追加済み/))
  it('does not replace overused amounts by zero', () =>
    reject((f) => {
      f.snapshot.movements.push(previous(11000))
    }, /超え/))
  it('does not generate a zero-cost addition for an exhausted source', () =>
    reject((f) => {
      f.snapshot.movements.push(previous(10000))
    }, /未使用額/))
  it('blocks unlinked historical additions referring to the same original invoice', () =>
    reject((f) => {
      const row = previous()
      delete row.costAllocations
      f.snapshot.movements.push(row)
    }, /未対応額/))
  it('does not block an unrelated unlinked historical invoice', () => {
    const f = fixture()
    const row = previous()
    delete row.costAllocations
    row.sourceIds = ['unrelated']
    f.snapshot.movements.push(row)
    assert.equal(suggestCostLink(f.snapshot, f.movement, f.costs, 'cost').available, true)
  })
  it('rejects private amounts', () =>
    reject((f) => {
      f.costs.contributions[0]!.target = { kind: 'private' }
    }))
  it('rejects unallocated amounts', () =>
    reject((f) => {
      f.costs.contributions[0]!.target = { kind: 'unallocated' }
    }))
  it('rejects another product', () =>
    reject((f) => {
      f.costs.contributions[0]!.target = { kind: 'tax-unit', taxUnitId: 'another' }
    }))
  it('rejects a parent contribution already consumed in another basis', () =>
    reject((f) => {
      f.costs.contributions[0]!.consumedByBasisId = 'child'
    }))
  it('rejects an unknown basis', () =>
    reject((f) => {
      f.costs.bases[0]!.amount = { status: 'unknown', amountJpy: null, reasons: ['不明'] }
    }))
  it('rejects a future cost year', () =>
    reject((f) => {
      f.costs.year = 2027
    }))
  it('rejects a future period within the same year', () =>
    reject((f) => {
      f.movement.occurredOn = '2026-07-01'
    }))
  it('rejects a non-calendar date', () =>
    reject((f) => {
      f.movement.occurredOn = '2026-02-30'
    }))
  it('rejects duplicate original source IDs', () =>
    reject((f) => {
      f.costs.contributions[0]!.sourceIds.push('direct:invoice')
    }))
  it('rejects missing original sources', () =>
    reject((f) => {
      f.costs.sources = []
    }))
  it('rejects duplicate matching contributions', () =>
    reject((f) => {
      f.costs.contributions.push(structuredClone(f.costs.contributions[0]!))
    }))
  it('rejects duplicate draft movement IDs', () =>
    reject((f) => {
      f.snapshot.movements.push(structuredClone(f.movement))
    }))
  it('rejects missing accounts', () =>
    reject((f) => {
      f.snapshot.accounts = []
    }))
  it('rejects an account starting after the posting year', () =>
    reject((f) => {
      f.snapshot.accounts[0]!.openingYear = 2027
    }))
  for (const amount of [NaN, Infinity, -1, 1.1, Number.MAX_SAFE_INTEGER + 1])
    it(`does not estimate the remaining amount from invalid existing claim ${String(amount)}`, () =>
      reject((f) => {
        f.snapshot.movements.push(previous(amount))
      }))
  it('uses exact integer arithmetic when claims exceed MAX_SAFE_INTEGER', () =>
    reject((f) => {
      f.snapshot.movements.push(previous(Number.MAX_SAFE_INTEGER), {
        ...previous(Number.MAX_SAFE_INTEGER),
        id: 'used-again',
      })
    }, /超え/))
  it('rejects overflow of the explicitly updated linked total without mutating the draft', () => {
    const f = fixture()
    f.movement.costAllocations = [
      { costYear: 2025, contributionId: 'older', amountJpy: Number.MAX_SAFE_INTEGER },
    ]
    assert.throws(() => applyCostLinkSuggestion(f.snapshot, f.movement, f.costs, 'cost'), /整数円/)
  })
  it('leaves an unfinished current link alone rather than silently dropping it', () => {
    const f = fixture()
    f.movement.costAllocations = [{ costYear: 2025, contributionId: 'older', amountJpy: NaN }]
    assert.throws(() => applyCostLinkSuggestion(f.snapshot, f.movement, f.costs, 'cost'), /未入力/)
    assert.equal(Number.isNaN(f.movement.costAllocations[0]!.amountJpy), true)
  })
})
