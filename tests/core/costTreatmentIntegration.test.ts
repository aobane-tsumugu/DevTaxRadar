import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { WorkspaceContents } from '../../src/core/workspaceMerge.js'
import type { ReviewMaterials } from '../../src/accounting/reviewMaterials.js'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import { mergeWorkspaceDrafts } from '../../src/core/workspaceMerge.js'
import { workspaceChangeKind, isNewWorkspace } from '../../src/core/workspaceChange.js'
import { historicalReviewMaterials } from '../../src/core/reviewHistory.js'
import { attachCostTreatments } from '../../src/core/costTreatments.js'
import { fixture, addFacts } from './helpers/treatmentFixtures.js'

const configuration: WorkspaceContents['configuration'] = {
  charges: { claude: null, codex: null }, contracts: { claude: {}, codex: {} },
  monthlyCharges: [], chargePeriods: [], unobservedRatio: null,
}
const workspace = (): WorkspaceContents => ({ configuration: structuredClone(configuration), planning: fixture().planning })
const balances: BalanceSnapshot = { version: 1, accounts: [], movements: [], pendingDecisions: [] }
function materials(): ReviewMaterials {
  const f = fixture()
  addFacts(f)
  return { schemaVersion: 1, engineVersion: 'review-materials/1', year: 2026, workspaceRevision: 1,
    timeZone: 'Asia/Tokyo', configuration: structuredClone(configuration), planning: f.planning,
    observations: [], scanTimeZones: {}, recentScans: [], costs: attachCostTreatments(f.costs, f.planning),
    referenceCheck: { engineVersion: 'balance-references/1', status: 'consistent', issues: [] },
    taxTreatmentVerified: false }
}

describe('facts in actual existing workspace merge and save classification', () => {
  it('merges distinct new cost conditions from two tabs without positional merging', () => {
    const base = workspace(), local = structuredClone(base), latest = structuredClone(base)
    const f = fixture(), first = addFacts(f)
    local.planning.costTreatmentFacts = [first]
    latest.planning.costTreatmentFacts = [{ ...first, id: 'second', contributionId: 'another-cost' }]
    const result = mergeWorkspaceDrafts(base, local, latest)
    assert.equal(result.contents?.planning.costTreatmentFacts?.length, 2)
    assert.equal(result.changes.filter((r) => r.label.startsWith('費用の処理条件')).length, 2)
    assert.equal(base.planning.costTreatmentFacts, undefined)
  })
  it('requires an explicit choice when two tabs change conditions for the same allocation', () => {
    const base = workspace()
    base.planning.costTreatmentFacts = [addFacts(fixture())]
    const local = structuredClone(base), latest = structuredClone(base)
    local.planning.costTreatmentFacts![0]!.reason = 'local reason'
    latest.planning.costTreatmentFacts![0]!.workPurpose = 'maintenance'
    const conflict = mergeWorkspaceDrafts(base, local, latest)
    assert.equal(conflict.contents, null)
    assert.equal(conflict.changes.length, 1)
    assert.equal(conflict.changes[0]!.conflict, true)
    const chosen = mergeWorkspaceDrafts(base, local, latest, { [conflict.changes[0]!.key]: 'local' })
    assert.deepEqual(chosen.contents?.planning.costTreatmentFacts, local.planning.costTreatmentFacts)
  })
  it('detects concurrent new facts with different IDs but the same year and cost', () => {
    const base = workspace(), local = structuredClone(base), latest = structuredClone(base)
    local.planning.costTreatmentFacts = [addFacts(fixture())]
    latest.planning.costTreatmentFacts = [{ ...local.planning.costTreatmentFacts[0]!, id: 'new-id' }]
    assert.equal(mergeWorkspaceDrafts(base, local, latest).contents, null)
  })
  it('treats condition changes as calculation-affecting but still permits unrelated note saves', () => {
    const base = workspace(), next = structuredClone(base)
    next.planning.costTreatmentFacts = [addFacts(fixture())]
    assert.equal(workspaceChangeKind(base, next), 'calculation')
    const noteOnly = structuredClone(next)
    noteOnly.planning.profile.notes = 'description only'
    assert.equal(workspaceChangeKind(next, noteOnly), 'notes')
  })
  it('does not call a workspace with orphaned saved facts brand new', () => {
    const current = workspace()
    current.planning.taxUnits = []
    current.planning.evidence = []
    assert.equal(isNewWorkspace(current, 0), true)
    current.planning.costTreatmentFacts = [addFacts(fixture())]
    assert.equal(isNewWorkspace(current, 0), false)
  })
})

describe('historical comparison includes actual facts and selected evidence', () => {
  it('ignores future-year facts in an unrelated prior-year comparison', () => {
    const old = materials(), next = structuredClone(old)
    next.planning.costTreatmentFacts!.push({ ...next.planning.costTreatmentFacts![0]!, id: 'future', costYear: 2027 })
    assert.deepEqual(historicalReviewMaterials(next, balances), historicalReviewMaterials(old, balances))
  })
  it('retains same-year fact changes even when amounts and displayed candidate are unchanged', () => {
    const old = materials(), next = structuredClone(old)
    next.planning.costTreatmentFacts![0]!.reason = 'a different factual basis'
    assert.notDeepEqual(historicalReviewMaterials(next, balances), historicalReviewMaterials(old, balances))
  })
  it('includes fact-only evidence in historical comparisons', () => {
    const old = materials()
    old.planning.evidence.push({ id: 'condition-proof', evidenceType: 'memo', strength: 'self-recorded',
      recordedAt: '2026-01-01T00:00:00Z', note: 'original facts' })
    old.planning.costTreatmentFacts![0]!.evidenceIds.push('condition-proof')
    const next = structuredClone(old)
    next.planning.evidence.find((e) => e.id === 'condition-proof')!.note = 'revised facts'
    assert.notDeepEqual(historicalReviewMaterials(next, balances), historicalReviewMaterials(old, balances))
  })
  it('includes prior-year facts when the adopted year carries their actual cost input', () => {
    const old = materials()
    const prior = structuredClone(old.costs)
    prior.year = 2025
    old.costLinks = { costs: [prior], check: { engineVersion: 'balance-cost-provenance/1', year: 2026,
      status: 'consistent', additions: [], contributions: [], issues: [], scope: 'addition-cost-links-only' } }
    old.planning.costTreatmentFacts!.push({ ...old.planning.costTreatmentFacts![0]!, id: 'prior', costYear: 2025 })
    const next = structuredClone(old)
    next.planning.costTreatmentFacts!.find((r) => r.id === 'prior')!.reason = 'prior year correction'
    assert.notDeepEqual(historicalReviewMaterials(next, balances), historicalReviewMaterials(old, balances))
  })
  it('does not add an empty facts field to old saved history comparisons', () => {
    const a = materials(), b = structuredClone(a)
    delete a.planning.costTreatmentFacts
    b.planning.costTreatmentFacts = []
    assert.deepEqual(historicalReviewMaterials(a, balances), historicalReviewMaterials(b, balances))
  })
})
