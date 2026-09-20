import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { fixture, addFacts } from './helpers/treatmentFixtures.js'
import { canonicalTreatmentValue } from '../../src/core/costTreatmentFacts.js'
import { newAnnualMethodFacts } from '../../src/core/costMethodConnection.js'
import { projectCostTreatments } from '../../src/core/costTreatments.js'
import { draftTreatmentDecision } from '../../src/core/costTreatmentDraft.js'
import { treatmentDecisionBindingMatches } from '../../src/core/treatmentDecisionBinding.js'

function prepared(legacy = false) {
  const f = fixture(); const fact = addFacts(f)
  fact.methodComparison = newAnnualMethodFacts(2026, 'part')
  const decision = draftTreatmentDecision(f.costs, f.planning, 'part', 'decision', '2026-09-19T00:00:00Z')
  if (legacy) decision.treatmentBinding!.basis = canonicalTreatmentValue({
    version: 1, item: projectCostTreatments(f.costs, f.planning).items[0], fact,
  })
  return { ...f, fact, decision }
}

describe('production facts and unadopted comparisons are separate', () => {
  for (const legacy of [false, true]) {
    it(`keeps ${legacy ? 'existing v1' : 'new v2'} judgment when only display horizon changes`, () => {
      const f = prepared(legacy); const original = structuredClone(f.decision)
      f.fact.methodComparison!.throughYear++
      f.fact.recordedAt = '2026-09-19T02:00:00Z'
      assert.equal(treatmentDecisionBindingMatches(f.decision, f.costs, f.planning), true)
      assert.deepEqual(f.decision, original)
    })
    it(`keeps ${legacy ? 'v1' : 'v2'} production judgment when an unadopted alternative changes`, () => {
      const f = prepared(legacy)
      f.fact.methodComparison!.reason = '比較上の別案'
      f.fact.methodComparison!.roundingConfirmed = true
      f.fact.methodComparison!.usefulLifeYears = 5
      assert.equal(treatmentDecisionBindingMatches(f.decision, f.costs, f.planning), true)
      delete f.fact.methodComparison
      assert.equal(treatmentDecisionBindingMatches(f.decision, f.costs, f.planning), true)
    })
    for (const change of ['reason', 'proof', 'amount', 'purpose', 'directness'] as const) {
      it(`still invalidates ${legacy ? 'v1' : 'v2'} when production ${change} changes`, () => {
        const f = prepared(legacy)
        if (change === 'reason') f.fact.reason += '根拠の変更'
        if (change === 'proof') f.planning.evidence[0]!.note += '証拠の変更'
        if (change === 'amount') f.costs.sources[0]!.originalAmountJpy++
        if (change === 'purpose') f.fact.workPurpose = 'maintenance'
        if (change === 'directness') f.fact.directlyAttributable = false
        assert.equal(treatmentDecisionBindingMatches(f.decision, f.costs, f.planning), false)
      })
    }
  }
  it('does not ignore identity or selection mismatches', () => {
    const f = prepared()
    for (const patch of [{ taxYear: 2025 }, { taxUnitId: 'other' }, { selectedCandidate: 'ordinary-expense' }])
      assert.equal(treatmentDecisionBindingMatches({ ...f.decision, ...patch }, f.costs, f.planning), false)
  })
  it('rejects unknown binding versions and extra root fields', () => {
    const f = prepared()
    const saved = JSON.parse(f.decision.treatmentBinding!.basis)
    for (const value of [{ ...saved, version: 3 }, { ...saved, ignored: true }, { version: 2, fact: saved.fact }]) {
      f.decision.treatmentBinding!.basis = canonicalTreatmentValue(value)
      assert.equal(treatmentDecisionBindingMatches(f.decision, f.costs, f.planning), false)
    }
  })
  it('new records never contain a comparison horizon in their production binding', () => {
    const f = prepared(); const basis = JSON.parse(f.decision.treatmentBinding!.basis)
    assert.equal(basis.version, 2)
    assert.equal(basis.fact.methodComparison, undefined)
    assert.equal(basis.fact.recordedAt, undefined)
    assert.equal(basis.fact.costBasis, f.fact.costBasis)
  })
})
