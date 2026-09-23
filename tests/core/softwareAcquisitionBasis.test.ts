import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { assembleSoftwareAcquisitionBasis as assemble } from '../../src/core/softwareAcquisitionBasis.js'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace.js'

import { fixture } from './helpers/softwareAcquisitionFixtures.js'
type Context = ReturnType<typeof fixture>

function externalFixture(): Context {
  const f = fixture()
  f.snapshot.accounts[0]!.openingYear = 2026
  f.snapshot.accounts[0]!.opening = { status: 'known', amountJpy: 60000 }
  f.snapshot.movements.shift()
  f.remaining[0] = {
    sourceKind: 'opening',
    sourceId: 'construction',
    accountId: 'construction',
    name: '制作中',
    availableOn: '2026-01-01',
    amountJpy: 60000,
    untracedJpy: 60000,
    lots: [],
    sourceIds: ['proof'],
  }
  f.snapshot.pendingDecisions = [
    {
      id: 'external-opening:synthetic',
      taxUnitId: 'software',
      taxYear: 2026,
      accountIds: ['construction'],
      amount: { status: 'known', amountJpy: 60000 },
      sourceIds: ['proof'],
      reasons: ['外部期首：制作中の未費用化原価', '2025年以前の製作費'],
      resolution: { taxYear: 2026, decisionId: 'opening-decision', reason: '期首の対象範囲を確認' },
    },
  ]
  f.confirmedDecisionIds = ['opening-decision']
  return f
}

describe('software acquisition summary of existing remaining pools', () => {
  it('combines 2025 60000 and 2026 60000 into 120000, not 60000 or 240000', () => {
    const f = fixture(),
      before = structuredClone(f),
      report = assemble(f)
    assert.equal(report.status, 'ready')
    assert.equal(report.knownSubtotalJpy, 120000)
    assert.equal(report.amountJpy, 120000)
    assert.deepEqual(
      report.lots.map((row) => [row.costYear, row.contributionId, row.amountJpy]),
      [
        [2025, 'part', 60000],
        [2026, 'part', 60000],
      ],
    )
    assert.equal(report.automaticPosting, false)
    assert.deepEqual(f, before)
  })
  it('uses remaining cost, not the original cost already expensed or reduced', () => {
    const f = fixture()
    f.remaining[0]!.amountJpy = 20000
    f.remaining[0]!.lots[0]!.remainingJpy = 20000
    assert.equal(assemble(f).amountJpy, 80000)
  })
  it('does not resurrect fully used source pools from raw projections', () => {
    const f = fixture()
    f.remaining = []
    const report = assemble(f)
    assert.equal(report.status, 'empty')
    assert.equal(report.amountJpy, null)
    assert.equal(report.knownSubtotalJpy, 0)
  })
  it('keeps a known subtotal while one balance is unknown', () => {
    const f = fixture()
    f.remaining[0]!.amountJpy = null
    f.remaining[0]!.untracedJpy = null
    f.remaining[0]!.lots[0]!.remainingJpy = null
    const report = assemble(f)
    assert.equal(report.knownSubtotalJpy, 60000)
    assert.equal(report.amountJpy, null)
    assert.equal(report.status, 'needs-review')
  })
  it('does not call an unknown additional basis a complete small asset', () => {
    const f = fixture()
    f.costs[1]!.bases.push({
      ...f.costs[1]!.bases[0]!,
      id: 'unknown',
      amount: { status: 'unknown', amountJpy: null, reasons: ['金額不明'] },
    })
    const report = assemble(f)
    assert.equal(report.amountJpy, null)
    assert.equal(report.knownSubtotalJpy, 120000)
  })
  it('does not block a software on an unknown basis of a different unit', () => {
    const f = fixture()
    f.costs[1]!.bases.push({
      ...f.costs[1]!.bases[0]!,
      id: 'other',
      affectedTaxUnitIds: ['other-unit'],
      amount: { status: 'unknown', amountJpy: null, reasons: ['無関係'] },
    })
    assert.equal(assemble(f).amountJpy, 120000)
  })
  it('shows unincorporated raw costs separately instead of double-adding them to stock', () => {
    const f = fixture()
    f.snapshot.movements.pop()
    f.remaining.pop()
    const report = assemble(f)
    assert.equal(report.knownSubtotalJpy, 60000)
    assert.equal(report.amountJpy, null)
    assert.deepEqual(report.unincorporated, [
      { costYear: 2026, contributionId: 'part', amountJpy: 60000 },
    ])
  })
  it('does not demand that a confirmed ordinary expense be added to software stock', () => {
    const f = fixture()
    f.snapshot.movements.pop()
    f.remaining.pop()
    f.costs[1]!.treatments = {
      version: 1,
      engineVersion: 'cost-treatment/1',
      year: 2026,
      taxTreatmentVerified: false,
      automaticPosting: false,
      unknownBases: [],
      orphanFactIds: [],
      totals: {
        currentYearExpenseCandidateJpy: 60000,
        futureCostCandidateJpy: 0,
        unresolvedKnownJpy: 0,
        excludedJpy: 0,
      },
      items: [
        {
          contributionId: 'part',
          basisId: 'basis',
          sourceIds: ['direct:2026'],
          taxUnitId: 'software',
          label: '通常業務',
          amountJpy: 60000,
          status: 'conditional',
          candidate: 'ordinary-expense',
          currentYearExpenseJpy: 60000,
          futureCostJpy: 0,
          reasons: [],
          missingFacts: [],
          appliedRuleIds: [],
        },
      ],
    }
    assert.equal(assemble(f).amountJpy, 60000)
  })
  it('does not include private/general or another construction account', () => {
    const f = fixture()
    f.remaining.push({
      ...f.remaining[0]!,
      sourceId: 'other',
      accountId: 'different-account',
      amountJpy: 90000,
    })
    assert.equal(assemble(f).amountJpy, 120000)
  })
  it('does not include a future source in an earlier completion amount', () => {
    const f = fixture()
    f.remaining[1]!.availableOn = '2027-01-01'
    assert.equal(assemble(f).amountJpy, 60000)
  })
  it('rejects duplicate source identities', () => {
    const f = fixture()
    f.remaining.push(structuredClone(f.remaining[0]!))
    assert.throws(() => assemble(f), /重複/)
  })
  it('rejects duplicate year projections instead of silently replacing a source version', () => {
    const f = fixture()
    f.costs.push(structuredClone(f.costs[0]!))
    assert.throws(() => assemble(f), /重複/)
  })
  it('rejects overclaiming the same year/contribution across multiple pools', () => {
    const f = fixture()
    f.remaining[1]!.lots[0]!.costYear = 2025
    assert.throws(() => assemble(f), /元の配分額/)
  })
  it('holds missing, intermediate and privately allocated source references', () => {
    for (const kind of ['missing', 'intermediate', 'private']) {
      const f = fixture()
      if (kind === 'missing') f.costs.shift()
      if (kind === 'intermediate') f.costs[0]!.contributions[0]!.consumedByBasisId = 'later-basis'
      if (kind === 'private') f.costs[0]!.contributions[0]!.target = { kind: 'private' }
      assert.equal(assemble(f).amountJpy, null)
    }
  })
  it('holds mismatched traced totals without converting the remainder to known zero', () => {
    const f = fixture()
    f.remaining[0]!.lots[0]!.remainingJpy = 1
    assert.equal(assemble(f).amountJpy, null)
  })
  it('holds an untraced movement instead of treating its note as an external opening', () => {
    const f = fixture()
    f.remaining[0]!.untracedJpy = 60000
    f.remaining[0]!.lots = []
    assert.equal(assemble(f).amountJpy, null)
  })
  it('rejects malformed money and dates', () => {
    const f = fixture()
    f.remaining[0]!.amountJpy = -1
    assert.throws(() => assemble(f), /金額/)
    assert.throws(() => assemble({ ...fixture(), occurredOn: '2026-02-30' }), /日付/)
  })
  it('does not assemble prepaid, another asset type or an unknown account', () => {
    const f = fixture()
    f.snapshot.accounts[0]!.kind = 'prepaid'
    assert.throws(() => assemble(f), /制作中/)
    const g = fixture()
    g.planning.taxUnits[0]!.unitType = 'sales-production'
    assert.throws(() => assemble(g), /ソフトウェア/)
    assert.throws(() => assemble({ ...fixture(), constructionAccountId: 'missing' }))
  })
})

describe('external or adopted opening is an alternative source, not an extra copy of old costs', () => {
  it('combines a confirmed external opening and current-year addition once', () => {
    const f = externalFixture(),
      report = assemble(f)
    assert.equal(report.amountJpy, 120000)
    assert.deepEqual(report.openingReferences, [
      { kind: 'external', id: 'external-opening:synthetic', amountJpy: 60000 },
    ])
    assert.deepEqual(
      report.lots.map((row) => row.costYear),
      [2026],
    )
    assert.deepEqual(report.unincorporated, [])
  })
  it('holds an unconfirmed external opening and preserves its known amount', () => {
    const f = externalFixture()
    f.confirmedDecisionIds = []
    const report = assemble(f)
    assert.equal(report.amountJpy, null)
    assert.equal(report.knownSubtotalJpy, 120000)
  })
  it('honors the existing external-opening validator result', () => {
    const f = externalFixture()
    f.openingProblems = [{ accountId: 'construction', message: '金額の意味が変化' }]
    assert.equal(assemble(f).amountJpy, null)
  })
  it('does not ignore a missing external proof', () => {
    const f = externalFixture()
    f.planning.evidence = []
    assert.equal(assemble(f).amountJpy, null)
  })
  it('does not add a covered old cost as another current increase', () => {
    const f = externalFixture()
    f.remaining.push({
      ...fixture().remaining[0]!,
      sourceId: 'duplicate-old',
      availableOn: '2026-01-01',
    })
    assert.equal(assemble(f).amountJpy, null)
    assert.match(assemble(f).unresolved.join(' '), /二重/)
  })
  it('requires the exact adopted opening review, never the latest unrelated head', () => {
    const f = externalFixture()
    f.snapshot.accounts[0]!.openingRevisionId = 'saved-review'
    f.snapshot.pendingDecisions = []
    assert.equal(assemble(f).amountJpy, null)
    f.openingReviews = [
      {
        id: 'saved-review',
        year: 2025,
        projection: {
          accounts: [
            {
              accountId: 'construction',
              taxUnitId: 'software',
              kind: 'construction',
              closing: { status: 'known', amountJpy: 60000 },
            },
          ],
        },
      } as BalanceReview,
    ]
    assert.equal(assemble(f).amountJpy, 120000)
    assert.deepEqual(assemble(f).openingReferences, [
      { kind: 'review', id: 'saved-review', amountJpy: 60000 },
    ])
    f.openingReviews[0]!.id = 'a-newer-head'
    assert.equal(assemble(f).amountJpy, null)
  })
  it('does not substitute asset unamortized closing for construction acquisition cost', () => {
    const f = externalFixture()
    f.snapshot.accounts[0]!.openingRevisionId = 'saved-review'
    f.openingReviews = [
      {
        id: 'saved-review',
        year: 2025,
        projection: {
          accounts: [
            {
              accountId: 'construction',
              taxUnitId: 'software',
              kind: 'asset',
              closing: { status: 'known', amountJpy: 60000 },
            },
          ],
        },
      } as BalanceReview,
    ]
    assert.equal(assemble(f).amountJpy, null)
  })
})
