import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  attachCostTreatments, costTreatmentBasis, newCostTreatmentFacts, projectCostTreatments,
} from '../../src/core/costTreatments.js'
import {
  canonicalTreatmentValue, editCostTreatmentFacts, validateCostTreatmentFacts,
} from '../../src/core/costTreatmentFacts.js'
import { costTreatmentMarkdown } from '../../src/core/costTreatmentExport.js'

import { fixture, addFacts } from './helpers/treatmentFixtures.js'

const row = (f: ReturnType<typeof fixture>) => projectCostTreatments(f.costs, f.planning).items[0]!

// Exercise the existing decision function, never a replacement taxonomy or fake calculator.
describe('final allocations to conditional treatments', () => {
  for (const kind of ['subscription', 'home', 'direct', 'equipment'] as const) {
    it(`connects a ${kind} allocation without reusing the original purchase price`, () => {
      const f = fixture(kind, 700)
      f.costs.sources[0]!.originalAmountJpy = 100000
      addFacts(f)
      const before = structuredClone(f)
      const r = row(f)
      assert.equal(r.status, 'conditional')
      assert.equal(r.candidate, 'software-acquisition-cost')
      assert.equal(r.currentYearExpenseJpy, 0)
      assert.equal(r.futureCostJpy, 700)
      assert.deepEqual(f, before)
      assert.deepEqual(r.sourceIds, ['source'])
    })
  }
  for (const purpose of ['ordinary-operation', 'maintenance', 'bug-fix', 'restoration'] as const) {
    it(`uses explicitly supplied ${purpose} facts for current-expense candidates`, () => {
      const f = fixture()
      addFacts(f, { workPurpose: purpose, placedInService: 'after', liabilityFixedAtYearEnd: true })
      assert.equal(row(f).currentYearExpenseJpy, 1000)
      assert.equal(row(f).futureCostJpy, 0)
      assert.equal(row(f).candidate, 'ordinary-expense')
      const report = projectCostTreatments(f.costs, f.planning)
      assert.equal(report.taxTreatmentVerified, false)
      assert.equal(report.automaticPosting, false)
    })
  }
  it('leaves new facts unknown rather than using the current lifecycle or a default purpose', () => {
    const f = fixture()
    const fresh = newCostTreatmentFacts(f.costs, f.planning, 'part', 'facts', '2026-09-18T01:00:00+09:00')
    assert.equal(fresh.workPurpose, 'unknown')
    assert.equal(fresh.placedInService, 'unknown')
    assert.equal(fresh.serviceProvidedInCurrentPeriod, null)
    f.planning.costTreatmentFacts = [fresh]
    assert.equal(row(f).currentYearExpenseJpy, null)
    assert.equal(row(f).futureCostJpy, null)
  })
  for (const unknown of [null, false]) {
    it(`does not assume an ordinary expense when liability confirmation is ${unknown}`, () => {
      const f = fixture()
      addFacts(f, { workPurpose: 'maintenance', placedInService: 'after', liabilityFixedAtYearEnd: unknown })
      assert.equal(row(f).status, 'needs-facts')
      assert.equal(row(f).currentYearExpenseJpy, null)
      assert.ok(row(f).missingFacts.some((m) => m.includes('債務')))
    })
  }
  it('keeps capital improvement amounts unresolved instead of guessing a method or threshold', () => {
    const f = fixture('direct', 100)
    addFacts(f, { workPurpose: 'feature-addition', placedInService: 'after' })
    assert.equal(row(f).candidate, 'capital-expenditure')
    assert.equal(row(f).currentYearExpenseJpy, null)
    assert.equal(row(f).futureCostJpy, null)
  })
  it('treats explicitly unprovided services as a conditional prepaid candidate', () => {
    const f = fixture('subscription', 500)
    addFacts(f, { serviceProvidedInCurrentPeriod: false, paidByYearEnd: true })
    assert.equal(row(f).candidate, 'prepaid-expense')
    assert.equal(row(f).futureCostJpy, 500)
  })
  it('requires actual payment before assigning a numeric prepaid candidate', () => {
    const f = fixture('subscription')
    const fact = addFacts(f, { serviceProvidedInCurrentPeriod: false })
    assert.equal(row(f).futureCostJpy, null)
    fact.paidByYearEnd = false
    assert.equal(row(f).futureCostJpy, null)
    fact.paidByYearEnd = true
    assert.equal(row(f).futureCostJpy, 1000)
  })
  it('does not manufacture an asset cost from a general-purpose allocation', () => {
    const f = fixture()
    f.costs.contributions[0]!.target = { kind: 'general' }
    addFacts(f)
    assert.equal(row(f).futureCostJpy, null)
    assert.ok(row(f).missingFacts.some((m) => m.includes('制作物への配分')))
  })
  it('does not default unknown service performance to provided', () => {
    const f = fixture()
    addFacts(f, { serviceProvidedInCurrentPeriod: null })
    assert.equal(row(f).currentYearExpenseJpy, null)
    assert.equal(row(f).futureCostJpy, null)
  })
  it('does not turn an unprovided service with unknown purpose into a known amount', () => {
    const f = fixture('subscription')
    addFacts(f, { workPurpose: 'unknown', serviceProvidedInCurrentPeriod: false })
    assert.equal(row(f).futureCostJpy, null)
  })
  it('requires work-in-progress and direct attribution for sales production', () => {
    const f = fixture()
    const facts = addFacts(f, { workPurpose: 'sales-production', workInProgressAtPeriodEnd: true })
    assert.equal(row(f).candidate, 'production-cost')
    assert.equal(row(f).futureCostJpy, 1000)
    facts.directlyAttributable = null
    assert.equal(row(f).futureCostJpy, null)
    facts.directlyAttributable = true
    facts.workInProgressAtPeriodEnd = false
    assert.equal(row(f).futureCostJpy, null)
  })
  it('does not classify non-software manufacture as software development', () => {
    const f = fixture()
    addFacts(f, { assetKind: 'other' })
    assert.equal(row(f).futureCostJpy, null)
  })
  it('keeps ordinary equipment use unresolved instead of deducting its annual allocation automatically', () => {
    const f = fixture('equipment')
    addFacts(f, { workPurpose: 'maintenance', placedInService: 'after', liabilityFixedAtYearEnd: true })
    assert.equal(row(f).currentYearExpenseJpy, null)
  })
  it('does not classify equipment acquisition as unprovided service', () => {
    const f = fixture('equipment')
    addFacts(f, { serviceProvidedInCurrentPeriod: false })
    assert.equal(row(f).futureCostJpy, null)
  })
  it('does not count a legacy opening balance as newly incurred cost', () => {
    const f = fixture('opening-balance')
    addFacts(f)
    assert.equal(row(f).status, 'unsupported')
    assert.equal(row(f).futureCostJpy, null)
  })
  it('keeps private, unresolved allocation and unknown amount separate', () => {
    const f = fixture()
    f.costs.contributions[0]!.amountJpy = 700
    f.costs.contributions.push(
      { ...f.costs.contributions[0]!, id: 'private', amountJpy: 100, target: { kind: 'private' } },
      { ...f.costs.contributions[0]!, id: 'unobserved', amountJpy: 200, target: { kind: 'unobserved' } },
    )
    f.costs.bases.push({ ...f.costs.bases[0]!, id: 'unknown-basis', amount: { status: 'unknown', amountJpy: null, reasons: ['金額確認待ち'] } })
    f.costs.totals.unknownBasisIds = ['unknown-basis']
    addFacts(f)
    const r = projectCostTreatments(f.costs, f.planning)
    assert.deepEqual(r.totals, { currentYearExpenseCandidateJpy: 0, futureCostCandidateJpy: 700,
      unresolvedKnownJpy: 200, excludedJpy: 100 })
    assert.equal(r.unknownBases[0]!.reasons[0], '金額確認待ち')
  })
  it('does not let private-purpose facts silently remove business allocations', () => {
    const f = fixture()
    addFacts(f, { workPurpose: 'hobby' })
    assert.equal(row(f).status, 'needs-facts')
    assert.equal(row(f).currentYearExpenseJpy, null)
  })
  it('does not count an already consumed intermediate contribution a second time', () => {
    const f = fixture()
    f.costs.contributions[0]!.consumedByBasisId = 'final-basis'
    f.costs.bases.push({ ...f.costs.bases[0]!, id: 'final-basis', sourceId: undefined, parentContributionIds: ['part'] })
    f.costs.contributions.push({ ...f.costs.contributions[0]!, id: 'final', basisId: 'final-basis', consumedByBasisId: undefined })
    const fact = { ...newCostTreatmentFacts(f.costs, f.planning, 'final', 'facts', '2026-09-18T00:00:00Z'),
      reason: '製作の根拠', workPurpose: 'new-development' as const, placedInService: 'before' as const,
      assetKind: 'software' as const, directlyAttributable: true, serviceProvidedInCurrentPeriod: true, evidenceIds: ['proof'] }
    fact.costBasis = costTreatmentBasis(f.costs, f.planning, 'final', fact.evidenceIds)
    f.planning.costTreatmentFacts = [fact]
    const result = projectCostTreatments(f.costs, f.planning)
    assert.equal(result.items.length, 1)
    assert.equal(result.totals.futureCostCandidateJpy, 1000)
    assert.throws(() => costTreatmentBasis(f.costs, f.planning, 'part'), /中間原価/)
  })
  it('rejects duplicate or missing source IDs and unsafe amounts', () => {
    const f = fixture()
    addFacts(f)
    f.costs.contributions[0]!.sourceIds = ['source', 'source']
    assert.throws(() => row(f), /参照/)
    f.costs.contributions[0]!.sourceIds = ['missing']
    assert.throws(() => row(f), /参照/)
    f.costs.contributions[0]!.sourceIds = ['source']
    f.costs.contributions[0]!.amountJpy = Number.MAX_SAFE_INTEGER + 1
    assert.throws(() => row(f), /整数円/)
  })
  it('rejects a misleading invariant flag if the terminal total does not reconcile', () => {
    const f = fixture()
    f.costs.totals.knownBasisJpy++
    assert.throws(() => row(f), /一致/)
  })
  it('accepts zero as known while leaving an absent condition uncalculated', () => {
    const f = fixture('direct', 0)
    assert.equal(row(f).futureCostJpy, null)
    addFacts(f)
    assert.equal(row(f).futureCostJpy, 0)
    assert.equal(row(f).status, 'conditional')
  })
})

describe('facts bound to cost, method and evidence', () => {
  for (const change of ['source-amount', 'method', 'period', 'evidence', 'target'] as const) {
    it(`holds a candidate when ${change} changes even if the allocation total does not`, () => {
      const f = fixture()
      addFacts(f)
      if (change === 'source-amount') f.costs.sources[0]!.originalAmountJpy = 2000
      if (change === 'method') f.costs.bases[0]!.method.explanation = '異なる配賦方法'
      if (change === 'period') f.costs.bases[0]!.period.startedOn = '2026-01-02'
      if (change === 'evidence') f.planning.evidence[0]!.note = '根拠の訂正'
      if (change === 'target') {
        f.planning.taxUnits.push({ ...f.planning.taxUnits[0]!, id: 'other-unit' })
        f.costs.contributions[0]!.target = { kind: 'tax-unit', taxUnitId: 'other-unit' }
      }
      assert.equal(row(f).status, 'stale')
      assert.equal(row(f).futureCostJpy, null)
    })
  }
  it('does not bind private locations, unrelated evidence or future lifecycle events', () => {
    const f = fixture()
    const fact = addFacts(f)
    assert.ok(!fact.costBasis.includes('PRIVATE-LOCAL-REFERENCE'))
    f.planning.evidence[0]!.localReference = 'MOVED-PRIVATE-PATH'
    f.planning.evidence.push({ ...f.planning.evidence[0]!, id: 'unrelated', note: '無関係な記録' })
    f.planning.lifecycleEvents.push({ id: 'future', taxUnitId: 'unit', eventType: 'abandoned',
      occurredOn: '2027-01-01', recordedAt: '2027-01-01T00:00:00Z', evidenceIds: [] })
    f.planning.taxUnits[0]!.lifecycleStatus = 'retired'
    assert.equal(row(f).status, 'conditional')
  })
  it('rejects missing inherited evidence even when the selected evidence is still present', () => {
    const f = fixture()
    f.costs.sources[0]!.evidenceIds.push('missing-inherited-proof')
    addFacts(f)
    assert.equal(row(f).futureCostJpy, null)
  })
  it('detects a supply-date crossing or contradiction instead of applying one state to the period', () => {
    const f = fixture()
    f.planning.lifecycleEvents.push({ id: 'start', taxUnitId: 'unit', eventType: 'internal-use-started',
      occurredOn: '2026-01-15', recordedAt: '2026-01-15T00:00:00Z', evidenceIds: ['proof'] })
    addFacts(f)
    assert.equal(row(f).futureCostJpy, null)
    assert.ok(row(f).missingFacts.some((m) => m.includes('またぐ')))
    f.planning.lifecycleEvents[0]!.occurredOn = '2025-12-01'
    addFacts(f)
    assert.ok(row(f).missingFacts.some((m) => m.includes('不一致')))
  })
  it('does not let an ended or abandoned activity post a new known candidate', () => {
    const f = fixture()
    f.planning.lifecycleEvents.push({ id: 'ended', taxUnitId: 'unit', eventType: 'abandoned',
      occurredOn: '2026-01-20', recordedAt: '2026-01-20T00:00:00Z', evidenceIds: ['proof'] })
    addFacts(f)
    assert.equal(row(f).futureCostJpy, null)
  })
  it('does not alter old no-fact years just because the new code exists', () => {
    const f = fixture()
    assert.strictEqual(attachCostTreatments(f.costs, f.planning), f.costs)
    const nextYearFact = addFacts(f, { costYear: 2027 })
    assert.equal(nextYearFact.costYear, 2027)
    assert.strictEqual(attachCostTreatments(f.costs, f.planning), f.costs)
    nextYearFact.costYear = 2026
    assert.equal(attachCostTreatments(f.costs, f.planning).treatments?.year, 2026)
  })
  it('keeps orphaned condition IDs visible after allocations disappear', () => {
    const f = fixture()
    addFacts(f)
    f.costs.contributions = []
    f.costs.bases = []
    f.costs.totals.knownBasisJpy = 0
    assert.deepEqual(projectCostTreatments(f.costs, f.planning).orphanFactIds, ['facts'])
  })
  it('does not mutate or recalculate a frozen report while exporting', () => {
    const f = fixture()
    addFacts(f)
    const report = projectCostTreatments(f.costs, f.planning)
    const before = structuredClone(report)
    f.costs.contributions[0]!.amountJpy = 12345
    f.planning.evidence[0]!.note = 'later change'
    const text = costTreatmentMarkdown(report)
    assert.ok(text.includes('1,000円'))
    assert.ok(!text.includes('12,345円'))
    assert.equal(costTreatmentMarkdown(undefined), '')
    assert.deepEqual(report, before)
  })
  it('escapes free text without interpreting HTML or markdown links', () => {
    const f = fixture()
    addFacts(f, { reason: '<script>x</script>\n[link](https://example.invalid)' })
    const text = costTreatmentMarkdown(projectCostTreatments(f.costs, f.planning))
    assert.ok(text.includes('\\<script\\>'))
    assert.ok(!text.includes('\n[link]'))
  })
})

describe('shared facts validation and record edits', () => {
  for (const patch of [
    { costYear: 1999 }, { id: '' }, { workPurpose: 'invented' }, { extra: 'do not strip' },
    { serviceProvidedInCurrentPeriod: undefined }, { reason: 'x'.repeat(2001) },
    { evidenceIds: ['proof', 'proof'] }, { recordedAt: '2026-02-30T00:00:00Z' },
    { recordedAt: '2026-09-18T24:00:00Z' }, { recordedAt: '2026-09-18T00:00:00' },
    { costBasis: '{' }, { costBasis: '{ "b": 1 }' },
  ]) {
    it(`rejects invalid ${Object.keys(patch).join(',')} without stripping fields`, () => {
      const f = fixture()
      const facts = addFacts(f)
      assert.throws(() => validateCostTreatmentFacts([{ ...facts, ...patch }]))
    })
  }
  it('rejects duplicate identity and duplicate year/contribution natural keys', () => {
    const f = fixture()
    const facts = addFacts(f)
    assert.throws(() => validateCostTreatmentFacts([facts, { ...facts, contributionId: 'other' }]), /重複/)
    assert.throws(() => validateCostTreatmentFacts([facts, { ...facts, id: 'other' }]), /重複/)
  })
  it('compares whole records and never silently edits another tab\'s version', () => {
    const f = fixture()
    const facts = addFacts(f)
    const next = { ...facts, reason: 'explicit changed reason' }
    const changed = editCostTreatmentFacts([facts], next, facts)
    assert.equal(changed[0]!.reason, next.reason)
    assert.throws(() => editCostTreatmentFacts(changed, facts, facts), /別の保存/)
    assert.deepEqual(editCostTreatmentFacts(changed, null, next), [])
    assert.equal(facts.reason, '供用前の製作へ直接対応する根拠を記録')
  })
  it('records partial facts without requiring fake dates, amounts or a confirmation state', () => {
    const f = fixture()
    const facts = newCostTreatmentFacts(f.costs, f.planning, 'part', 'draft', '2026-09-18T00:00:00Z')
    const result = editCostTreatmentFacts([], facts, null)
    validateCostTreatmentFacts(result)
    assert.equal(result[0]!.reason, '')
    assert.equal(result[0]!.workPurpose, 'unknown')
    assert.ok(!Object.hasOwn(result[0]!, 'amountJpy'))
    assert.equal(canonicalTreatmentValue({ b: 1, a: null }), '{"a":null,"b":1}')
  })
})
