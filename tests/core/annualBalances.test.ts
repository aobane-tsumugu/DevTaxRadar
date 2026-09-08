import { describe, expect, it } from 'vitest'
import { buildAnnualBalances, BalanceValidationError } from '../../src/core/annualBalances.js'
import type {
  BalanceAccount,
  BalanceMovement,
  BalanceSnapshot,
} from '../../src/accounting/types.js'

function account(id: string, amountJpy = 0): BalanceAccount {
  return {
    id,
    taxUnitId: 'unit-a',
    name: id,
    kind: id === 'work' ? 'construction' : 'asset',
    openingYear: 2026,
    opening: { status: 'known', amountJpy },
  }
}

function movement(
  id: string,
  occurredOn: string,
  amountJpy: number,
  posting:
    | Pick<Extract<BalanceMovement, { kind: 'transfer' }>, 'kind' | 'fromAccountId' | 'toAccountId'>
    | { kind: 'addition' | 'expense' | 'reduction'; accountId: string },
): BalanceMovement {
  return {
    id,
    occurredOn,
    amountJpy,
    sourceIds: [`source-${id}`],
    decisionId: `decision-${id}`,
    reason: '合成例で採用した扱い',
    ...posting,
  }
}

function example(): BalanceSnapshot {
  return {
    version: 1,
    accounts: [account('work', 20_000), account('asset')],
    movements: [
      movement('cost-26', '2026-03-01', 30_000, { kind: 'addition', accountId: 'work' }),
      movement('complete-26', '2026-07-01', 40_000, {
        kind: 'transfer',
        fromAccountId: 'work',
        toAccountId: 'asset',
      }),
      movement('expense-26', '2026-12-31', 4_000, { kind: 'expense', accountId: 'asset' }),
      movement('cost-27', '2027-03-01', 12_000, { kind: 'addition', accountId: 'work' }),
      movement('complete-27', '2027-07-01', 15_000, {
        kind: 'transfer',
        fromAccountId: 'work',
        toAccountId: 'asset',
      }),
      movement('expense-27', '2027-12-31', 6_000, { kind: 'expense', accountId: 'asset' }),
    ],
    pendingDecisions: [],
  }
}

function known(amountJpy: number) {
  return { status: 'known', amountJpy }
}

it('carries a question until its resolution year without posting money or erasing earlier years', () => {
  const s = example()
  s.pendingDecisions = [
    {
      id: 'q',
      taxUnitId: 'unit-a',
      taxYear: 2026,
      amount: { status: 'unknown', amountJpy: null, reasons: ['未確認'] },
      accountIds: ['work'],
      sourceIds: ['receipt'],
      reasons: ['扱いを相談中'],
    },
  ]
  const before = buildAnnualBalances(s, 2026)
  const later = buildAnnualBalances(s, 2027)
  s.pendingDecisions[0]!.resolution = {
    taxYear: 2027,
    decisionId: 'answer',
    reason: '資料を確認して判断',
  }
  expect(buildAnnualBalances(s, 2026)).toEqual(before)
  const resolved = buildAnnualBalances(s, 2027)
  expect(resolved.pendingDecisions).toEqual([])
  expect(resolved.accounts[0]!.pendingDecisionIds).toEqual([])
  expect(resolved.totals).toEqual(later.totals)
  expect(s.pendingDecisions[0]!.reasons).toEqual(['扱いを相談中'])
  s.pendingDecisions[0]!.resolution!.taxYear = 2025
  expect(() => buildAnnualBalances(s, 2027)).toThrow('発生年より前')
})

describe('annual balance projection', () => {
  it('connects construction and asset balances across years without expensing transfers', () => {
    const first = buildAnnualBalances(example(), 2026)
    const second = buildAnnualBalances(example(), 2027)
    expect(first.accounts.find((row) => row.accountId === 'work')).toMatchObject({
      opening: known(20_000),
      additionsJpy: 30_000,
      transfersOutJpy: 40_000,
      closing: known(10_000),
      expensesJpy: 0,
    })
    expect(first.accounts.find((row) => row.accountId === 'asset')).toMatchObject({
      opening: known(0),
      transfersInJpy: 40_000,
      expensesJpy: 4_000,
      closing: known(36_000),
    })
    expect(second.accounts.find((row) => row.accountId === 'work')).toMatchObject({
      opening: known(10_000),
      closing: known(7_000),
    })
    expect(second.accounts.find((row) => row.accountId === 'asset')).toMatchObject({
      opening: known(36_000),
      closing: known(45_000),
    })
    expect(first.totals).toMatchObject({
      knownOpeningJpy: 20_000,
      knownClosingJpy: 46_000,
      expensesJpy: 4_000,
      transfersInJpy: 40_000,
      transfersOutJpy: 40_000,
      unknownAccountIds: [],
    })
    expect(second.totals).toMatchObject({
      knownOpeningJpy: 46_000,
      knownClosingJpy: 52_000,
      expensesJpy: 6_000,
      additionsJpy: 12_000,
    })
    for (const projection of [first, second]) {
      for (const row of projection.accounts) {
        expect(row.closing.amountJpy).toBe(
          (row.opening.amountJpy ?? 0) +
            row.additionsJpy +
            row.transfersInJpy -
            row.transfersOutJpy -
            row.expensesJpy -
            row.reductionsJpy,
        )
      }
    }
  })

  it('keeps source and decision provenance on input and returns both sides of one transfer', () => {
    const data = example()
    const before = structuredClone(data)
    const result = buildAnnualBalances(data, 2026)
    expect(result.accounts.every((row) => row.movementIds.includes('complete-26'))).toBe(true)
    expect(data).toEqual(before)
    result.accounts[0].movementIds.push('not-a-real-movement')
    expect(data).toEqual(before)
  })

  it('does not turn an unknown opening into zero or a computed closing', () => {
    const data = example()
    data.accounts[1].opening = {
      status: 'unknown',
      amountJpy: null,
      reasons: ['転用時の残高を確認する'],
    }
    const result = buildAnnualBalances(data, 2027)
    const row = result.accounts.find((entry) => entry.accountId === 'asset')!
    expect(row.opening).toEqual(data.accounts[1].opening)
    expect(row.closing).toEqual(data.accounts[1].opening)
    expect(row.transfersInJpy).toBe(15_000)
    expect(row.expensesJpy).toBe(6_000)
    expect(result.totals.unknownAccountIds).toEqual(['asset'])
    expect(result.totals.knownClosingJpy).toBe(7_000)
    if (row.closing.status === 'unknown') row.closing.reasons.push('変更')
    expect(data.accounts[1].opening.reasons).toEqual(['転用時の残高を確認する'])
  })

  it('lists unresolved amounts without posting them to future balances', () => {
    const data = example()
    data.pendingDecisions = [
      {
        id: 'pending',
        taxUnitId: 'unit-a',
        taxYear: 2026,
        amount: known(500) as { status: 'known'; amountJpy: number },
        accountIds: ['asset'],
        reasons: ['供用の事実が不足'],
        sourceIds: ['invoice-pending'],
      },
    ]
    const result = buildAnnualBalances(data, 2026)
    expect(result.totals.knownClosingJpy).toBe(46_000)
    expect(result.accounts.find((row) => row.accountId === 'asset')?.pendingDecisionIds).toEqual([
      'pending',
    ])
    expect(result.pendingDecisions).toEqual(data.pendingDecisions)
    result.pendingDecisions[0].reasons.push('出力の編集')
    expect(data.pendingDecisions[0].reasons).toEqual(['供用の事実が不足'])
    const nextYear = buildAnnualBalances(data, 2027)
    expect(nextYear.pendingDecisions).toEqual(data.pendingDecisions)
    expect(nextYear.accounts.find((row) => row.accountId === 'asset')?.pendingDecisionIds).toEqual([
      'pending',
    ])
    expect(nextYear.totals.knownClosingJpy).toBe(52_000)
  })

  it('separates reductions from expenses and permits cross-unit transfers', () => {
    const data = example()
    data.accounts[1].taxUnitId = 'improvement-a'
    data.movements.push(
      movement('retire-part', '2027-12-31', 5_000, { kind: 'reduction', accountId: 'asset' }),
    )
    const result = buildAnnualBalances(data, 2027)
    expect(result.totals).toMatchObject({
      expensesJpy: 6_000,
      reductionsJpy: 5_000,
      knownClosingJpy: 47_000,
    })
  })

  it('has no year leakage and can show an empty year or later unchanged balances', () => {
    expect(buildAnnualBalances(example(), 2025).accounts).toEqual([])
    const result = buildAnnualBalances(example(), 2028)
    expect(result.totals).toMatchObject({
      knownOpeningJpy: 52_000,
      knownClosingJpy: 52_000,
      additionsJpy: 0,
      expensesJpy: 0,
    })
    expect(result.accounts.every((row) => row.movementIds.length === 0)).toBe(true)
  })

  it('is independent of input record order and uses simultaneous same-day postings', () => {
    const data = example()
    expect(
      buildAnnualBalances(
        {
          ...data,
          accounts: [...data.accounts].reverse(),
          movements: [...data.movements].reverse(),
        },
        2027,
      ),
    ).toEqual(buildAnnualBalances(data, 2027))
    const sameDay: BalanceSnapshot = {
      version: 1,
      accounts: [account('asset')],
      pendingDecisions: [],
      movements: [
        movement('out', '2026-03-01', 100, { kind: 'expense', accountId: 'asset' }),
        movement('in', '2026-03-01', 100, { kind: 'addition', accountId: 'asset' }),
      ],
    }
    expect(buildAnnualBalances(sameDay, 2026).totals.knownClosingJpy).toBe(0)
  })

  it('rejects a negative historical balance even if a later addition would cover it', () => {
    const data: BalanceSnapshot = {
      version: 1,
      accounts: [account('asset')],
      pendingDecisions: [],
      movements: [
        movement('out', '2026-02-01', 100, { kind: 'expense', accountId: 'asset' }),
        movement('in', '2026-03-01', 100, { kind: 'addition', accountId: 'asset' }),
      ],
    }
    expect(() => buildAnnualBalances(data, 2027)).toThrow(/その日までの残高/)
  })

  it.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid yen %s',
    (amountJpy) => {
      const data = example()
      data.movements[0].amountJpy = amountJpy
      expect(() => buildAnnualBalances(data, 2026)).toThrow(BalanceValidationError)
    },
  )

  it('rejects overflow instead of silently rounding a large integer total', () => {
    const data = example()
    data.accounts[0].opening = { status: 'known', amountJpy: Number.MAX_SAFE_INTEGER }
    expect(() => buildAnnualBalances(data, 2026)).toThrow(/整数円を超え/)
  })

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-01', 'not-a-date'])(
    'rejects invalid calendar dates %s',
    (occurredOn) => {
      const data = example()
      data.movements[0].occurredOn = occurredOn
      expect(() => buildAnnualBalances(data, 2026)).toThrow(BalanceValidationError)
    },
  )

  it('accepts a leap day and rejects movement before the opening year', () => {
    const data: BalanceSnapshot = {
      version: 1,
      accounts: [account('asset')],
      pendingDecisions: [],
      movements: [movement('leap', '2028-02-29', 100, { kind: 'addition', accountId: 'asset' })],
    }
    expect(buildAnnualBalances(data, 2028).totals.knownClosingJpy).toBe(100)
    data.accounts[0].openingYear = 2029
    expect(() => buildAnnualBalances(data, 2028)).toThrow(/期首より前/)
  })

  it('rejects duplicate movements instead of double posting', () => {
    const data = example()
    data.movements.push(structuredClone(data.movements[0]))
    expect(() => buildAnnualBalances(data, 2026)).toThrow(/重複/)
  })

  it('rejects dangling, self-transfer and missing provenance references', () => {
    const data = example()
    data.movements[1] = movement('bad', '2026-07-01', 10, {
      kind: 'transfer',
      fromAccountId: 'work',
      toAccountId: 'missing',
    })
    expect(() => buildAnnualBalances(data, 2026)).toThrow(/見つかりません/)
    data.movements[1] = movement('bad', '2026-07-01', 10, {
      kind: 'transfer',
      fromAccountId: 'work',
      toAccountId: 'work',
    })
    expect(() => buildAnnualBalances(data, 2026)).toThrow(/同じ残高/)
    data.movements = [movement('bad', '2026-07-01', 10, { kind: 'addition', accountId: 'work' })]
    data.movements[0].sourceIds = []
    expect(() => buildAnnualBalances(data, 2026)).toThrow(/根拠ID/)
  })
})
