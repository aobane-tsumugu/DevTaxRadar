import { describe, expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import {
  activityLedgerSchema,
  scopedActivityFacts,
  type ActivityFact,
} from '../../src/planning/activityFacts.js'
import { planningSnapshotSchema } from '../../src/planning/schema.js'
import { projectProductTimeline } from '../../src/core/productTimeline.js'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'
import {
  projectCostTreatments,
  costTreatmentBasis,
  newCostTreatmentFacts,
} from '../../src/core/costTreatments.js'
import {
  proposeActivityTreatmentFacts,
  applicableActivityFacts,
} from '../../src/core/activityTreatmentReuse.js'
import { mergeWorkspaceDrafts } from '../../src/core/workspaceMerge.js'
import { planningMarkdown } from '../../src/core/planningExport.js'

export function fixture() {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits = ['old', 'new'].map((id) => ({
    id,
    name: id,
    unitType: 'new-software',
    usageMode: 'mixed',
    revenueModel: 'undecided',
    lifecycleStatus: 'developing',
  }))
  planning.evidence = [
    {
      id: 'proof',
      evidenceType: 'memo',
      strength: 'self-recorded',
      recordedAt: '2026-01-01T00:00:00Z',
      note: '確認資料',
      localReference: '/synthetic/private-receipt',
    },
  ]
  const fact: ActivityFact = {
    id: 'use',
    productId: 'product',
    taxUnitId: 'old',
    kind: 'internal-use',
    purpose: 'ordinary-operation',
    state: 'confirmed',
    time: { kind: 'period', startedOn: '2026-01-01', endedOn: '2026-12-31' },
    scope: '旧版の機能A',
    reason: '期間と用途を本人確認',
    recordedAt: '2026-01-01T00:00:00Z',
    evidenceIds: ['proof'],
  }
  planning.activityLedger = {
    version: 1,
    products: [{ id: 'product', name: '制作物' }],
    unitLinks: [
      { id: 'old-link', productId: 'product', taxUnitId: 'old' },
      { id: 'new-link', productId: 'product', taxUnitId: 'new' },
    ],
    facts: [
      fact,
      {
        ...fact,
        id: 'development',
        taxUnitId: 'new',
        kind: 'improvement',
        purpose: 'feature-addition',
        state: 'estimated',
        scope: '改良機能B',
      },
    ],
  }
  planning.directCosts = [
    {
      id: 'old-cost',
      taxUnitId: 'old',
      incurredOn: '2026-01-05',
      costType: 'cloud',
      amountJpy: 100,
      directlyAttributable: true,
      treatment: 'direct',
      evidenceIds: [],
    },
  ]
  const configuration = {
    charges: { claude: null, codex: null },
    contracts: { claude: {}, codex: {} },
    monthlyCharges: [],
    chargePeriods: [],
    unobservedRatio: null,
  }
  return { planning, fact, configuration }
}
// Match the pure cost builder's public input, using only synthetic facts.
function costs(planning: ReturnType<typeof fixture>['planning']) {
  return projectWorkspaceCosts(planning, [])
}
describe('common activity facts', () => {
  it('preserves zero-history product IDs when units and recovered history are bound later', () => {
    const p = emptyPlanningSnapshot()
    p.activityLedger = {
      version: 1,
      products: [{ id: 'zero', name: '履歴なし' }],
      unitLinks: [],
      facts: [],
    }
    expect(projectProductTimeline(planningSnapshotSchema.parse(p))[0]?.id).toBe('zero')
    p.taxUnits = fixture().planning.taxUnits
    p.activityLedger.unitLinks = [{ id: 'bind', productId: 'zero', taxUnitId: 'old' }]
    p.projectRules = [
      {
        id: 'recovered',
        taxUnitId: 'old',
        projectKey: 'opaque-project',
        effectiveFrom: '2025-01-01',
        classification: 'maintenance',
      },
    ]
    const timeline = projectProductTimeline(planningSnapshotSchema.parse(p))
    expect(timeline[0]?.id).toBe('zero')
    expect(timeline[0]?.entries[0]?.state).toContain('事実確認なし')
  })
  it('shows parallel versions and partial release/abandonment without mutating cost or tax states', () => {
    const { planning, fact } = fixture()
    planning.activityLedger!.facts.push(
      {
        ...fact,
        id: 'release',
        kind: 'external-release',
        time: { kind: 'date', occurredOn: '2026-02-01' },
        scope: '機能Aのみ公開',
      },
      {
        ...fact,
        id: 'abandon',
        taxUnitId: 'new',
        kind: 'abandonment',
        state: 'conflicted',
        scope: '改良機能Bの一部だけ中止',
      },
    )
    const before = structuredClone(planning),
      timeline = projectProductTimeline(planning)
    expect(timeline[0]!.entries).toHaveLength(4)
    expect(planning).toEqual(before)
    expect(planningMarkdown(planning)).toContain('矛盾あり')
    expect(planningMarkdown(planning)).not.toContain('/synthetic/private-receipt')
  })
  it('rejects unknown schemas, impossible dates, cycles, missing references and conflicting corrections', () => {
    const { planning, fact } = fixture()
    const ledger = planning.activityLedger!
    expect(activityLedgerSchema.safeParse({ ...ledger, version: 2 }).success).toBe(false)
    expect(activityLedgerSchema.safeParse({ ...ledger, future: true }).success).toBe(false)
    expect(planningSnapshotSchema.safeParse({ ...planning, future: true }).success).toBe(false)
    for (const patch of [
      { time: { kind: 'date', occurredOn: '2026-02-30' } },
      { productId: 'missing' },
      { time: { kind: 'period', startedOn: '2026-03-01', endedOn: '2026-02-01' } },
      { correctsId: 'use', correctionReason: '循環' },
    ])
      expect(
        activityLedgerSchema.safeParse({ ...ledger, facts: [{ ...fact, ...patch }] }).success,
      ).toBe(false)
    expect(planningSnapshotSchema.safeParse({ ...planning, evidence: [] }).success).toBe(false)
  })
  it('scopes corrections and evidence-only changes to the original affected unit and period', () => {
    const { planning, fact } = fixture()
    const projection = costs(planning)
    const contribution = projection.contributions.find((row) => row.target.kind === 'tax-unit')!
    const before = costTreatmentBasis(projection, planning, contribution.id)
    planning.activityLedger!.facts[1]!.reason = '別単位の根拠変更'
    expect(costTreatmentBasis(projection, planning, contribution.id)).toBe(before)
    planning.activityLedger!.facts.push({
      ...fact,
      id: 'correction',
      correctsId: fact.id,
      correctionReason: '年を訂正',
      time: { kind: 'period', startedOn: '2027-01-01', endedOn: '2027-12-31' },
    })
    expect(
      scopedActivityFacts(planning, 'old', '2026-01-01', '2026-01-31').map((row) => row.id),
    ).toEqual(['correction', 'use'])
    expect(costTreatmentBasis(projection, planning, contribution.id)).not.toBe(before)
    expect(
      applicableActivityFacts(
        projection,
        planning,
        newCostTreatmentFacts(
          projection,
          planning,
          contribution.id,
          'condition',
          '2026-02-01T00:00:00Z',
        ),
      ),
    ).toHaveLength(0)
  })
  it('only proposes a confirmed full-period purpose; preserves payment, service, method, and stale seal', () => {
    const { planning, fact } = fixture(),
      projection = costs(planning)
    const contribution = projection.contributions.find((row) => row.target.kind === 'tax-unit')!
    const target = newCostTreatmentFacts(
      projection,
      planning,
      contribution.id,
      'condition',
      '2026-02-01T00:00:00Z',
    )
    const next = proposeActivityTreatmentFacts(projection, planning, target, fact)
    expect(next.workPurpose).toBe('ordinary-operation')
    expect(next.placedInService).toBe('unknown')
    expect(next.paidByYearEnd).toBe(null)
    const stale = { ...target, costBasis: '{"stale":true}' }
    expect(proposeActivityTreatmentFacts(projection, planning, stale, fact).costBasis).toBe(
      stale.costBasis,
    )
    planning.activityLedger!.facts.push({
      ...fact,
      id: 'conflict',
      purpose: 'hobby',
      state: 'conflicted',
    })
    expect(applicableActivityFacts(projection, planning, target)).toHaveLength(0)
  })
  it('merges independent facts by ID and retains same-record conflicts', () => {
    const { planning, fact, configuration } = fixture()
    const base = { planning, configuration },
      local = structuredClone(base),
      latest = structuredClone(base)
    local.planning.activityLedger!.facts.push({ ...fact, id: 'local' })
    latest.planning.activityLedger!.facts.push({ ...fact, id: 'remote' })
    expect(
      mergeWorkspaceDrafts(base, local, latest).contents?.planning.activityLedger?.facts,
    ).toHaveLength(4)
    local.planning.activityLedger!.products[0]!.name = 'local'
    latest.planning.activityLedger!.products[0]!.name = 'remote'
    expect(mergeWorkspaceDrafts(base, local, latest).contents).toBeNull()
  })
  it('does not resolve a corrected purpose contradiction by only resealing the old condition', () => {
    const { planning, fact } = fixture(),
      projection = costs(planning)
    const contribution = projection.contributions.find((row) => row.target.kind === 'tax-unit')!
    const target = newCostTreatmentFacts(
      projection,
      planning,
      contribution.id,
      'condition',
      '2026-02-01T00:00:00Z',
    )
    target.workPurpose = fact.purpose
    target.reason = '確認'
    target.evidenceIds = ['proof']
    planning.activityLedger!.facts.push({
      ...fact,
      id: 'hobby-correction',
      correctsId: fact.id,
      correctionReason: '私用を訂正',
      purpose: 'hobby',
    })
    target.costBasis = costTreatmentBasis(projection, planning, contribution.id, target.evidenceIds)
    planning.costTreatmentFacts = [target]
    const result = projectCostTreatments(projection, planning)
    expect(
      result.items.find((row) => row.contributionId === contribution.id)?.missingFacts.join(' '),
    ).toContain('活動用途と費用の作業目的が一致しません')
  })
  it('keeps original wrong targets while accepting explicit relationship and fact corrections', () => {
    const { planning, fact } = fixture()
    planning.activityLedger!.products.push({ id: 'correct-product', name: '正しい制作物' })
    planning.activityLedger!.unitLinks.push({
      id: 'correct-link',
      productId: 'correct-product',
      taxUnitId: 'old',
      correctsId: 'old-link',
      correctionReason: '誤った制作物への接続を訂正',
    })
    planning.activityLedger!.facts.push({
      ...fact,
      id: 'correct-target',
      productId: 'correct-product',
      correctsId: fact.id,
      correctionReason: '対象を訂正',
    })
    expect(planningSnapshotSchema.safeParse(planning).success).toBe(true)
    expect(
      scopedActivityFacts(planning, 'old', '2026-01-01', '2026-12-31').map((row) => row.id),
    ).toEqual(['correct-target', 'use'])
  })
  it('hashes moved corrections without applying their different-year purpose to the old period', () => {
    const { planning, fact } = fixture(),
      projection = costs(planning)
    const contribution = projection.contributions.find((row) => row.target.kind === 'tax-unit')!
    const target = newCostTreatmentFacts(
      projection,
      planning,
      contribution.id,
      'condition',
      '2026-02-01T00:00:00Z',
    )
    target.workPurpose = fact.purpose
    target.reason = '確認'
    target.evidenceIds = ['proof']
    planning.activityLedger!.facts.push({
      ...fact,
      id: 'moved',
      correctsId: fact.id,
      correctionReason: '翌年の別用途だった',
      purpose: 'hobby',
      time: { kind: 'period', startedOn: '2027-01-01', endedOn: '2027-12-31' },
    })
    target.costBasis = costTreatmentBasis(projection, planning, contribution.id, target.evidenceIds)
    planning.costTreatmentFacts = [target]
    expect(
      projectCostTreatments(projection, planning)
        .items.find((row) => row.contributionId === contribution.id)
        ?.missingFacts.join(' '),
    ).not.toContain('活動用途と費用の作業目的が一致しません')
  })
})
