import { expect, it } from 'vitest'
import { checkOpeningLotCarry } from '../../src/core/openingLotCarry.js'
import { buildAnnualBalances } from '../../src/core/annualBalances.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'

function fixture() {
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'a',
        name: '当時の残高',
        taxUnitId: 'u',
        kind: 'asset',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 90 },
      },
    ],
    movements: [],
    pendingDecisions: [],
  }
  const prior: NonNullable<Parameters<typeof checkOpeningLotCarry>[0]> = {
    id: 'prior',
    year: 2026,
    projection: buildAnnualBalances(snapshot, 2026),
    materials: {
      costs: {
        version: 1,
        engineVersion: 'cost-projection/1',
        year: 2026,
        sources: [],
        bases: [],
        contributions: [],
        byTaxUnit: [],
        invariantSatisfied: true,
        totals: {
          knownBasisJpy: 0,
          taxUnitJpy: 0,
          generalJpy: 0,
          privateJpy: 0,
          unallocatedJpy: 0,
          unobservedJpy: 0,
          roundingJpy: 0,
          unknownBasisIds: [],
        },
      },
      balanceLotTrace: {
        engineVersion: 'balance-lot-trace/2',
        year: 2026,
        scope: 'explicit-and-unique-cost-lots',
        status: 'consistent',
        movements: [],
        issues: [],
        remaining: [
          {
            sourceKind: 'movement',
            sourceId: 'old',
            accountId: 'a',
            amountJpy: 90,
            untracedJpy: 0,
            lots: [{ costYear: 2025, contributionId: 'c', amountJpy: 100, remainingJpy: 90 }],
          },
        ],
      },
    },
  }
  return { prior, current: buildAnnualBalances(snapshot, 2027) }
}
it('uses the prior remaining amount rather than the acquisition or original source amount', () => {
  const { prior, current } = fixture()
  const result = checkOpeningLotCarry(prior, current)
  current.accounts.push({
    ...current.accounts[0]!,
    accountId: 'new',
    opening: { status: 'known', amountJpy: 50 },
  })
  expect(checkOpeningLotCarry(prior, current)).toMatchObject({
    status: 'incomplete',
    accounts: expect.arrayContaining([
      expect.objectContaining({ accountId: 'new', untracedJpy: 50 }),
    ]),
  })
  current.accounts.pop()
  expect(result).toMatchObject({
    status: 'consistent',
    previousReviewId: 'prior',
    accounts: [{ name: '当時の残高', lots: [{ amountJpy: 90 }], untracedJpy: 0 }],
  })
  prior.projection.accounts[0]!.name = '変更後'
  expect(result.accounts[0]!.name).toBe('当時の残高')
  expect(result.accounts[0]!.lots[0]!.label).toContain('未収録')
  current.accounts[0]!.opening = { status: 'known', amountJpy: 100 }
  expect(checkOpeningLotCarry(prior, current).status).toBe('invalid')
})
it('keeps missing or uncertain provenance incomplete and detects inconsistent frozen totals', () => {
  const { prior, current } = fixture()
  expect(checkOpeningLotCarry(null, current).status).toBe('not-linked')
  const trace = prior.materials!.balanceLotTrace!
  trace.remaining[0]!.lots[0]!.remainingJpy = null
  expect(checkOpeningLotCarry(prior, current)).toMatchObject({
    status: 'incomplete',
    accounts: [{ lots: [], untracedJpy: 90 }],
  })
  trace.remaining[0]!.amountJpy = 80
  expect(checkOpeningLotCarry(prior, current).status).toBe('invalid')
  prior.materials!.balanceLotTrace = undefined
  expect(checkOpeningLotCarry(prior, current).status).toBe('incomplete')
  current.accounts[0]!.opening = { status: 'unknown', amountJpy: null, reasons: ['未確認'] }
  expect(checkOpeningLotCarry(prior, current).accounts[0]!.untracedJpy).toBeNull()
  prior.year = 2025
  expect(checkOpeningLotCarry(prior, current).status).toBe('invalid')
})
