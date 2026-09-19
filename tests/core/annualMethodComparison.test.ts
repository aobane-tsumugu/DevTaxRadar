import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { compareAnnualMethods, validateAnnualMethodFacts, validMethodDate, type AnnualMethodFacts } from '../../src/core/annualMethodComparison.js'
import { newAnnualMethodFacts, methodComparisonScope } from '../../src/core/costMethodConnection.js'
import { projectCostTreatments, costTreatmentBasis } from '../../src/core/costTreatments.js'
import { costTreatmentMarkdown } from '../../src/core/costTreatmentExport.js'
import { fixture, addFacts } from './helpers/treatmentFixtures.js'
const profile = { filingType: 'blue', incomeCategory: 'business' }
function facts(patch: Partial<AnnualMethodFacts> = {}): AnnualMethodFacts {
  return { ...newAnnualMethodFacts(2026, 'part'), assetKind: 'software', completeCostConfirmed: true,
    businessOnly: true, acquiredOn: '2026-04-01', usedOn: '2026-07-01', usefulLifeYears: 5,
    taxpayer: 'individual', ordinaryConditions: true, rentalUse: 'none', throughYear: 2033,
    eligibleSmallBusiness: true, annualSpecialUsedJpy: 0, businessMonths: 12,
    statementReady: true, roundingConfirmed: true, reason: '合成の資産全体額・方式・期間の比較', ...patch }
}
const run = (amount = 180001, patch: Partial<AnnualMethodFacts> = {}) => compareAnnualMethods(amount, facts(patch), profile, 'facts', 2026)
const scenario = (method: string, amount = 180001, patch: Partial<AnnualMethodFacts> = {}) => run(amount, patch).scenarios.find((row) => row.method === method)!
describe('explicit whole-asset annual alternatives', () => {
  it('uses the published rate, monthly portion, and zero software residual', () => {
    const s = scenario('straight-line')
    assert.equal(s.years![0]!.expenseJpy, 18001)
    assert.equal(s.years!.at(-1)!.closingJpy, 0)
    assert.equal(s.years!.reduce((sum, row) => sum + row.expenseJpy, 0), 180001)
  })
  it('retains one yen for tangible equipment', () => {
    const s = scenario('straight-line', 180001, { assetKind: 'tangible-equipment', usefulLifeYears: 4 })
    assert.equal(s.years!.at(-1)!.closingJpy, 1)
    assert.equal(s.years!.reduce((sum, row) => sum + row.expenseJpy, 0), 180000)
  })
  it('keeps pool years independent of the first month and caps the final year', () => {
    const s = scenario('three-year-pool', 180001, { usedOn: '2026-12-31' })
    assert.deepEqual(s.years!.slice(0, 3).map((row) => row.expenseJpy), [60001, 60001, 59999])
    assert.equal(s.years![3]!.expenseJpy, 0)
  })
  for (const [cost, method, expected] of [
    [99999, 'immediate-expense', 'conditional'], [100000, 'immediate-expense', 'not-eligible'],
    [100000, 'three-year-pool', 'conditional'], [199999, 'three-year-pool', 'conditional'],
    [200000, 'three-year-pool', 'not-eligible'], [399999, 'blue-special', 'conditional'],
    [400000, 'blue-special', 'not-eligible'],
  ] as const) it(`${cost}: ${method} boundary is ${expected}`, () => assert.equal(scenario(method, cost).status, expected))
  it('keeps the pre-April-2026 special threshold separate', () => {
    assert.equal(scenario('blue-special', 300000, { acquiredOn: '2026-03-31' }).status, 'not-eligible')
    assert.equal(scenario('blue-special', 299999, { acquiredOn: '2026-03-31' }).status, 'conditional')
  })
  it('does not default missing other-asset usage or business months to zero/twelve', () => {
    for (const patch of [{ annualSpecialUsedJpy: null }, { businessMonths: null }, { statementReady: null }])
      assert.equal(scenario('blue-special', 180001, patch).years, null)
  })
  it('excludes nonprimary rental from all small-asset alternatives, not ordinary depreciation', () => {
    const r = run(150000, { rentalUse: 'other' })
    assert.equal(r.scenarios[0]!.status, 'conditional')
    for (const s of r.scenarios.slice(1)) assert.equal(s.years, null)
  })
  it('requires rental facts but never blocks the ordinary alternative by inventing a rental condition', () => {
    assert.equal(scenario('three-year-pool', 150000, { rentalUse: 'unknown' }).status, 'missing-facts')
    assert.equal(scenario('straight-line', 150000, { rentalUse: 'unknown' }).status, 'conditional')
  })
  it('respects the shortened-year aggregate cap', () => {
    assert.equal(scenario('blue-special', 200000, { annualSpecialUsedJpy: 1400000, businessMonths: 6 }).status, 'not-eligible')
    assert.equal(scenario('blue-special', 100000, { annualSpecialUsedJpy: 1400000, businessMonths: 6 }).status, 'conditional')
  })
  for (const [name, patch] of [
    ['whole amount', { completeCostConfirmed: null }], ['mixed/private', { businessOnly: false }],
    ['missing date', { usedOn: null }],
    ['unknown taxpayer', { taxpayer: 'unknown' }], ['special adjustment', { ordinaryConditions: false }],
    ['corporation', { taxpayer: 'corporation' }], ['reverse dates', { usedOn: '2026-03-01' }],
  ] as const) it(`keeps ${name} uncalculated rather than zero`, () => {
    assert.ok(run(150000, patch).scenarios.every((row) => row.years === null))
  })
  it('does not assume a statutory life or support an unverified software category', () => {
    assert.equal(scenario('straight-line', 150000, { usefulLifeYears: null }).status, 'missing-facts')
    assert.equal(scenario('straight-line', 150000, { usefulLifeYears: 4 }).status, 'unsupported')
  })
  it('does not extend a special tax rule beyond its verified period', () => {
    const r = compareAnnualMethods(150000, facts({ acquiredOn: '2030-01-01', usedOn: '2030-01-01', throughYear: 2035 }), profile, 'facts', 2030)
    assert.equal(r.scenarios.find((row) => row.method === 'blue-special')!.status, 'unsupported')
  })
  it('reads actual prior closing instead of recreating historical depreciation', () => {
    const f = facts({ assetKind: 'tangible-equipment', acquiredOn: '2024-01-01', usedOn: '2024-01-01', usefulLifeYears: 4 })
    assert.equal(compareAnnualMethods(200000, f, profile, 'facts', 2026).status, 'missing-facts')
    const r = compareAnnualMethods(200000, f, profile, 'facts', 2026, { taxYear: 2025, amountJpy: 77777, reference: '合成の前年資料' })
    assert.equal(r.scenarios[0]!.years![0]!.openingJpy, 77777)
    assert.ok(r.scenarios.slice(1).every((s) => s.years === null))
  })
  it('preserves annual conservation and safe integers over boundary values', () => {
    for (const amount of [1, 2, 99999, 100000, 199999, 200000, 399999, 400000, Number.MAX_SAFE_INTEGER]) {
      for (const s of run(amount).scenarios) for (const row of s.years ?? []) {
        assert.equal(BigInt(row.openingJpy) + BigInt(row.additionsJpy) - BigInt(row.expenseJpy), BigInt(row.closingJpy))
        assert.ok(Number.isSafeInteger(row.closingJpy) && row.closingJpy >= 0)
      }
    }
  })
  it('rejects fake calendar dates and unknown input fields', () => {
    assert.equal(validMethodDate('2026-02-30'), false)
    assert.equal(validMethodDate('2024-02-29'), true)
    assert.throws(() => validateAnnualMethodFacts({ ...facts(), guessed: true }))
    assert.throws(() => validateAnnualMethodFacts(facts({ contributionIds: ['part', 'part'] })))
    assert.throws(() => run(150000, { throughYear: 2151 }))
  })
})
describe('method comparison connected to real treatment projection and renderer', () => {
  function connected() {
    const f = fixture('direct', 180001); const fact = addFacts(f)
    f.planning.profile = { ...f.planning.profile, ...profile } as typeof f.planning.profile
    fact.methodComparison = facts({ acquiredOn: '2026-04-01' })
    fact.methodComparison.scopeBasis = methodComparisonScope(f.costs, f.planning, fact, costTreatmentBasis)
    return { ...f, fact }
  }
  it('attaches comparisons without adding mutually exclusive amounts to candidate totals', () => {
    const f = connected(); const report = projectCostTreatments(f.costs, f.planning)
    assert.equal(report.methodComparisons?.[0]?.amountJpy, 180001)
    assert.equal(report.totals.futureCostCandidateJpy, 180001)
    const md = costTreatmentMarkdown(report)
    assert.match(md, /方法別の条件付き年次比較/)
    assert.match(md, /2026年（仮定）/)
    assert.ok(!md.includes('PRIVATE-LOCAL-REFERENCE'))
  })
  it('marks same-amount evidence changes stale', () => {
    const f = connected(); f.planning.evidence[0]!.note += '変更'
    assert.equal(projectCostTreatments(f.costs, f.planning).methodComparisons![0]!.status, 'stale')
  })
  it('does not accept mere binding refresh when lifecycle facts contradict software creation', () => {
    const f = connected()
    f.planning.lifecycleEvents.push({ id: 'abandoned', taxUnitId: 'unit', eventType: 'abandoned', occurredOn: '2026-01-10', recordedAt: '2026-01-10T00:00:00Z', evidenceIds: ['proof'] })
    f.fact.costBasis = costTreatmentBasis(f.costs, f.planning, 'part', ['proof'])
    f.fact.methodComparison!.scopeBasis = methodComparisonScope(f.costs, f.planning, f.fact, costTreatmentBasis)
    assert.equal(projectCostTreatments(f.costs, f.planning).methodComparisons![0]!.status, 'missing-facts')
  })
  it('blocks overlapping asset groups and unknown cost bases', () => {
    const f = connected()
    f.costs.bases.push({ ...f.costs.bases[0]!, id: 'unknown', amount: { status: 'unknown', amountJpy: null, reasons: ['未確認'] } })
    assert.equal(projectCostTreatments(f.costs, f.planning).methodComparisons![0]!.status, 'missing-facts')
  })
  it('leaves no-fact old projections free of new fields', () => {
    const f = fixture()
    assert.equal(projectCostTreatments(f.costs, f.planning).methodComparisons, undefined)
    assert.equal(costTreatmentMarkdown(undefined), '')
  })
})

describe('equipment method comparison keeps saved facts authoritative', () => {
  function connectedEquipment() {
    const f = fixture('equipment', 30000)
    f.costs.sources[0] = {
      ...f.costs.sources[0]!, id: 'equipment:device', originalAmountJpy: 180001,
      acquiredOn: '2026-04-01',
    }
    f.costs.bases[0]!.sourceId = 'equipment:device'
    f.costs.contributions[0]!.sourceIds = ['equipment:device']
    f.planning.equipment = [{
      id: 'device', name: '合成の設備', equipmentType: 'pc',
      acquisitionCostJpy: 180001, acquiredOn: '2026-04-01',
      businessUseStartedOn: '2026-07-01', convertedFromPrivate: false,
      businessUseRatio: 1, usefulLifeYears: 4, role: '制作',
      taxUnitId: 'unit', projectAllocationRatio: 1, evidenceIds: ['proof'],
    }]
    f.planning.equipmentMethods = [{
      id: 'annual-device', equipmentId: 'device', taxYear: 2026, taxpayer: 'individual',
      assetKind: 'tangible-equipment', method: 'straight-line', methodReason: '合成条件',
      usefulLifeYears: 4, useThroughYearEnd: 'confirmed', ordinaryTreatment: 'confirmed',
      priorClosing: null, recordedAt: '2026-09-18T00:00:00Z',
    }]
    const fact = addFacts(f, { assetKind: 'other' })
    fact.methodComparison = facts({ assetKind: 'tangible-equipment', usefulLifeYears: 4 })
    const reseal = () => {
      fact.costBasis = costTreatmentBasis(f.costs, f.planning, 'part', ['proof'])
      fact.methodComparison!.scopeBasis = methodComparisonScope(f.costs, f.planning, fact, costTreatmentBasis)
    }
    const report = () => projectCostTreatments(f.costs, f.planning).methodComparisons![0]!
    reseal()
    return { ...f, fact, reseal, report }
  }
  it('compares the whole purchase amount, never the annual allocation', () => {
    const f = connectedEquipment()
    assert.equal(f.report().amountJpy, 180001)
    assert.equal(f.report().status, 'compared')
    assert.equal(f.report().scenarios.find((row) => row.method === 'immediate-expense')!.status, 'not-eligible')
  })
  it('detects an equipment-only fact change even when the cost projection is unchanged', () => {
    const f = connectedEquipment()
    f.planning.equipment[0]!.convertedFromPrivate = true
    assert.equal(f.report().status, 'stale')
    f.reseal()
    assert.equal(f.report().status, 'unsupported')
  })
  it('rejects conflicting service dates even after explicitly refreshing the scope', () => {
    const f = connectedEquipment()
    f.fact.methodComparison!.usedOn = '2026-08-01'
    f.reseal()
    assert.equal(f.report().status, 'stale')
  })
  it('does not allow business-only comparison to replace saved private use', () => {
    const f = connectedEquipment()
    f.planning.equipment[0]!.businessUseRatio = 0.8
    f.reseal()
    assert.equal(f.report().status, 'missing-facts')
    assert.equal(f.report().scenarios.length, 0)
  })
  it('does not treat explicitly unknown annual business use as the old equipment ratio', () => {
    const f = connectedEquipment()
    f.planning.equipmentMethods![0]!.allocation = {
      businessUseRatio: null, projectAllocationRatio: 1, reason: '年度割合を確認中',
    }
    f.reseal()
    assert.equal(f.report().status, 'missing-facts')
  })
  it('uses the explicit annual ratio instead of an unused legacy ratio', () => {
    const f = connectedEquipment()
    f.planning.equipment[0]!.businessUseRatio = 0.8
    f.planning.equipmentMethods![0]!.allocation = {
      businessUseRatio: 1, projectAllocationRatio: 1, reason: '当年は業務専用',
    }
    f.reseal()
    assert.equal(f.report().status, 'compared')
  })
  it('blocks saved interruption, special adjustment and corporate scope', () => {
    for (const patch of [
      { useThroughYearEnd: 'ended-or-interrupted' as const },
      { ordinaryTreatment: 'special-or-adjusted' as const },
      { taxpayer: 'corporation' as const },
      { assetKind: 'intangible' as const },
    ]) {
      const f = connectedEquipment()
      Object.assign(f.planning.equipmentMethods![0]!, patch)
      f.reseal()
      assert.equal(f.report().status, 'unsupported')
    }
  })
  it('does not accept a different useful life without reconciling saved conditions', () => {
    const f = connectedEquipment()
    f.fact.methodComparison!.usefulLifeYears = 5
    f.reseal()
    assert.equal(f.report().status, 'stale')
  })
  it('binds prior-closing evidence even when its amount is unchanged', () => {
    const f = connectedEquipment()
    f.planning.equipmentMethods![0]!.priorClosing = {
      taxYear: 2025, amountJpy: 150000, reference: '保存時の前年資料',
    }
    f.reseal()
    f.planning.equipmentMethods![0]!.priorClosing!.reference = '差し替えた前年資料'
    assert.equal(f.report().status, 'stale')
  })
  it('does not bind unrelated equipment or a future annual method', () => {
    const f = connectedEquipment()
    f.planning.equipment.push({ ...f.planning.equipment[0]!, id: 'unrelated' })
    f.planning.equipmentMethods!.push({ ...f.planning.equipmentMethods![0]!, id: 'future', taxYear: 2027 })
    assert.equal(f.report().status, 'compared')
  })
  it('requires exactly one saved equipment record and one current-year condition', () => {
    const f = connectedEquipment()
    f.planning.equipmentMethods!.push({ ...f.planning.equipmentMethods![0]!, id: 'duplicate' })
    f.reseal()
    assert.equal(f.report().status, 'missing-facts')
    f.planning.equipmentMethods!.pop()
    f.planning.equipment = []
    f.reseal()
    assert.equal(f.report().status, 'missing-facts')
  })
})
