import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { buildAnnualBalances } from '../../src/core/annualBalances.js'
import { checkBalanceReferences } from '../../src/core/balanceReferences.js'
import { decisionIsConfirmed } from '../../src/core/decisionConfirmation.js'
import {
  confirmSoftwareAnnualDecision,
  softwareAnnualDecisionProposal,
} from '../../src/core/softwareAnnualDecision.js'
import {
  draftSoftwareAcquisition,
  inspectSoftwareAcquisition,
} from '../../src/core/softwareAcquisitionDraft.js'
import {
  chooseSoftwareMethod,
  draftSoftwareYearExpense,
} from '../../src/core/softwareMethodDraft.js'
import { planningSaveSchema } from '../../src/planning/schema.js'
import { acquisitionFixture, methodFixture } from './helpers/softwareMethodFixture.js'

function januaryFixture() {
  const f = acquisitionFixture()
  const cost2026 = f.costs.find((row) => row.year === 2026)!
  cost2026.bases[0]!.period.endedOn = '2026-01-01'
  f.snapshot.movements.find((row) => row.id === 'add:2026')!.occurredOn = '2026-01-01'
  const makeDecision = (year: number) => ({
    id: 'decision:' + year,
    taxUnitId: 'software',
    taxYear: year,
    engineVersion: 'manual-decision/1',
    candidate: 'software-acquisition-cost',
    selectedCandidate: 'software-acquisition-cost',
    status: 'confirmed' as const,
    reason: '合成の取得原価確認',
    createdAt: year + '-01-01T00:00:00Z',
    confirmedAt: year + '-01-01T01:00:00Z',
  })
  f.planning.decisions = [makeDecision(2025), makeDecision(2026)]
  f.snapshot.accounts.push({
    id: 'asset',
    name: '完成ソフト',
    taxUnitId: 'software',
    kind: 'asset',
    openingYear: 2026,
    opening: { status: 'known', amountJpy: 0 },
  })
  const basis = inspectSoftwareAcquisition(
    f.snapshot,
    f.planning,
    f.costs,
    'production',
    '2026-01-01',
  )
  const acquisitionId = 'balance-use:11111111-1111-4111-8111-111111111111'
  f.snapshot = draftSoftwareAcquisition(f.snapshot, f.planning, f.costs, {
    requestId: acquisitionId.slice('balance-use:'.length),
    constructionAccountId: 'production',
    toAccountId: 'asset',
    occurredOn: '2026-01-01',
    decisionId: 'decision:2026',
    reason: '2年度の同じソフト原価全額を確認',
    evidenceIds: ['proof'],
    completeCostConfirmed: true,
    expectedAmountJpy: 120000,
    expectedSources: basis.sources.map((row) => ({
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      amountJpy: row.amountJpy!,
    })),
  })
  f.snapshot = chooseSoftwareMethod(f.snapshot, f.planning, 'asset', {
    acquisitionMovementId: acquisitionId,
    method: 'straight-line',
    usedOn: '2026-01-01',
    usefulLifeYears: 5,
    businessOnly: true,
    ordinaryConditions: true,
    rentalUse: 'none',
    roundingConfirmed: true,
    allocationPolicy: 'proportional-largest-remainder',
    evidenceIds: ['proof'],
    reason: '業務用ソフト全体原価・5年定額・供用条件を本人確認',
    confirmedAt: '2026-01-01T02:00:00Z',
  })
  return f
}

describe('C04 structured annual software decision', () => {
  it('T02 confirms 24,000 each year without manual candidate input and reuses same-year confirmation', () => {
    const f = januaryFixture()
    const p2026 = softwareAnnualDecisionProposal(f.snapshot, f.planning, 'asset', 2026)
    assert.equal(p2026.acquisitionAmountJpy, 120000)
    assert.equal(p2026.expenseJpy, 24000)
    assert.equal(p2026.existingDecisionId, undefined)
    const d2026 = confirmSoftwareAnnualDecision(
      p2026,
      'annual-2026',
      '2026-12-31T10:00:00Z',
    )
    assert.equal(decisionIsConfirmed(d2026), true)
    f.planning.decisions.push(d2026)
    assert.equal(
      softwareAnnualDecisionProposal(f.snapshot, f.planning, 'asset', 2026).existingDecisionId,
      d2026.id,
    )
    assert.doesNotThrow(() => planningSaveSchema.parse(f.planning))

    f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, {
      accountId: 'asset',
      year: 2026,
      requestId: '22222222-2222-4222-8222-000000002026',
      decisionId: d2026.id,
      ordinaryYearConfirmed: true,
    })
    let annual = buildAnnualBalances(f.snapshot, 2026).accounts
      .find((row) => row.accountId === 'asset')!
    assert.equal(annual.expensesJpy, 24000)
    assert.equal(annual.closing.amountJpy, 96000)

    assert.throws(() => draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, {
      accountId: 'asset',
      year: 2027,
      requestId: '33333333-3333-4333-8333-000000002027',
      decisionId: d2026.id,
      ordinaryYearConfirmed: true,
    }), /対象年/)

    const p2027 = softwareAnnualDecisionProposal(f.snapshot, f.planning, 'asset', 2027)
    assert.equal(p2027.expenseJpy, 24000)
    const d2027 = confirmSoftwareAnnualDecision(
      p2027,
      'annual-2027',
      '2027-12-31T10:00:00Z',
    )
    f.planning.decisions.push(d2027)
    f.snapshot = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, {
      accountId: 'asset',
      year: 2027,
      requestId: '22222222-2222-4222-8222-000000002027',
      decisionId: d2027.id,
      ordinaryYearConfirmed: true,
    })
    annual = buildAnnualBalances(f.snapshot, 2027).accounts
      .find((row) => row.accountId === 'asset')!
    assert.equal(annual.opening.amountJpy, 96000)
    assert.equal(annual.expensesJpy, 24000)
    assert.equal(annual.closing.amountJpy, 72000)

    const movements = f.snapshot.movements.filter((row) => row.softwareExpense)
    assert.deepEqual(movements.map((row) => row.decisionId), [d2026.id, d2027.id])
    const ids = new Set(movements.map((row) => row.id))
    assert.deepEqual(
      checkBalanceReferences(f.snapshot, f.planning, []).issues
        .filter((row) => ids.has(row.recordId)),
      [],
    )
  })

  it('marks a prior generated decision stale after method/reason changes and never overwrites it', () => {
    const f = januaryFixture()
    const old = confirmSoftwareAnnualDecision(
      softwareAnnualDecisionProposal(f.snapshot, f.planning, 'asset', 2026),
      'annual-old',
      '2026-12-31T10:00:00Z',
    )
    f.planning.decisions.push(old)
    const changed = structuredClone(f.snapshot)
    const method = changed.accounts.find((row) => row.id === 'asset')!.softwareMethod!
    method.reason = '理由を変更して再確認'
    method.confirmedAt = '2026-12-31T11:00:00Z'
    const proposal = softwareAnnualDecisionProposal(changed, f.planning, 'asset', 2026)
    assert.equal(proposal.existingDecisionId, undefined)
    assert.deepEqual(proposal.staleDecisionIds, [old.id])
    const replacement = confirmSoftwareAnnualDecision(
      proposal,
      'annual-new',
      '2026-12-31T12:00:00Z',
    )
    assert.equal(f.planning.decisions.find((row) => row.id === old.id), old)
    assert.notEqual(replacement.id, old.id)
    assert.throws(() => draftSoftwareYearExpense(changed, f.planning, f.costs, {
      accountId: 'asset',
      year: 2026,
      requestId: '22222222-2222-4222-8222-000000002026',
      decisionId: old.id,
      ordinaryYearConfirmed: true,
    }), /一致しません/)
  })

  it('does not create a decision for a zero annual amount', () => {
    const f = methodFixture('immediate-expense', 80000)
    f.planning.decisions = f.planning.decisions
      .filter((row) => row.selectedCandidate !== 'ordinary-expense')
    const p2026 = softwareAnnualDecisionProposal(f.snapshot, f.planning, 'asset', 2026)
    const d2026 = confirmSoftwareAnnualDecision(
      p2026,
      'annual-immediate',
      '2026-12-31T10:00:00Z',
    )
    f.planning.decisions.push(d2026)
    const first = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, {
      accountId: 'asset',
      year: 2026,
      requestId: '22222222-2222-4222-8222-000000002026',
      decisionId: d2026.id,
      ordinaryYearConfirmed: true,
    })
    const p2027 = softwareAnnualDecisionProposal(first, f.planning, 'asset', 2027)
    assert.equal(p2027.expenseJpy, 0)
    assert.equal(p2027.existingDecisionId, undefined)
    assert.throws(
      () => confirmSoftwareAnnualDecision(p2027, 'unused', '2027-01-01T00:00:00Z'),
      /0円/,
    )
    assert.deepEqual(draftSoftwareYearExpense(first, f.planning, f.costs, {
      accountId: 'asset',
      year: 2027,
      requestId: '22222222-2222-4222-8222-000000002027',
      decisionId: '',
      ordinaryYearConfirmed: false,
    }), first)
  })
})
