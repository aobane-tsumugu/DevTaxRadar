import { chargeContractBasis } from '../../src/core/chargePeriods.js'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { BalanceSnapshot } from '../../src/accounting/types.js'
import type { WorkspaceDraft } from '../../src/planning/workspace.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { buildReviewMaterials } from '../../src/server/reviewMaterials.js'
import { historicalReviewMaterials } from '../../src/core/reviewHistory.js'
import { checkEquipmentCarry } from '../../src/core/equipmentCarryCheck.js'
import { reviewExportMarkdown } from '../../src/core/reviewExport.js'
import { costProjectionMarkdown } from '../../src/core/costExport.js'
import { compareReview } from '../../src/core/reviewComparison.js'
import { balanceSnapshotSchema } from '../../src/accounting/balanceSchema.js'
import { validateBalanceSnapshot } from '../../src/core/annualBalances.js'
import {
  consultationAnswersForYear,
  consultationQuestionBasis,
} from '../../src/core/consultationResolution.js'
import {
  adoptBalanceReview,
  getBalanceReview,
  getBalanceDraft,
  initializeBalanceSchema,
  previewBalanceReview,
  saveBalanceDraft,
} from '../../src/server/balanceRepository.js'

function fixture() {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits = [
    {
      id: 'u',
      name: '合成制作物',
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'efficiency',
      lifecycleStatus: 'developing',
    },
  ]
  planning.evidence = [
    {
      id: 'e',
      evidenceType: 'other',
      strength: 'self-recorded',
      recordedAt: '2026-01-01T00:00:00Z',
      note: '確認した資料',
      localReference: 'C:\\private\\receipt.pdf',
    },
  ]
  planning.directCosts = [
    {
      id: 'cost',
      incurredOn: '2026-01-01',
      taxUnitId: 'u',
      costType: 'domain',
      amountJpy: 100,
      directlyAttributable: true,
      treatment: 'direct',
      evidenceIds: ['e'],
    },
  ]
  planning.decisions = [
    {
      id: 'd',
      taxUnitId: 'u',
      taxYear: 2026,
      engineVersion: 'manual-decision/1',
      candidate: '制作中',
      selectedCandidate: '制作中',
      reason: '確認理由',
      status: 'confirmed',
      createdAt: '2026-01-01T00:00:00Z',
      confirmedAt: '2026-01-02T00:00:00Z',
    },
  ]
  const workspace: WorkspaceDraft = {
    revision: 2,
    planning,
    configuration: {
      charges: { claude: 0, codex: 0 },
      monthlyCharges: [],
      contracts: { claude: {}, codex: {} },
      chargePeriods: [],
      unobservedRatio: null,
    },
  }
  const balances: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'a',
        taxUnitId: 'u',
        name: '制作中',
        kind: 'construction',
        openingYear: 2026,
        opening: { status: 'known', amountJpy: 0 },
      },
    ],
    movements: [
      {
        id: 'm',
        kind: 'addition',
        accountId: 'a',
        occurredOn: '2026-01-01',
        amountJpy: 100,
        decisionId: 'd',
        sourceIds: ['direct:cost'],
        reason: '合成の記録',
      },
    ],
    pendingDecisions: [],
  }
  const observation = {
    sessions: [
      {
        sourceId: 'private-source',
        sourceName: 'C:\\private\\history',
        provider: 'claude' as const,
        sessionKey: 'native-session-secret',
        projectKey: 'project_abcdef0123456789abcdef01',
        month: '2026-01',
        startedAt: '2026-01-01T01:00:00Z',
        endedAt: '2026-01-01T02:00:00Z',
        messageCount: 1,
        projectLabel: 'C:\\private\\project',
        model: 'test-model',
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ],
    overview: {
      providers: [],
      recentScans: [
        {
          sourceId: 'private-source',
          provider: 'claude',
          startedAt: '2026-01-02T00:00:00Z',
          completedAt: '2026-01-02T00:01:00Z',
          filesSeen: 1,
          eventsWritten: 1,
          malformedLines: 0,
          status: 'complete',
        },
      ],
    },
    lastScanTimeZones: { 'private-source:claude': 'Asia/Tokyo' },
  }
  return { workspace, balances, observation }
}

describe('source-bound balance reviews', () => {
  it('freezes contract explanations and requires reconfirmation without removing invoice amounts', () => {
    const data = fixture()
    data.workspace.configuration.chargePeriods = ['a','b'].map((id) => {
      const period = { id,provider:'claude' as const,planName:'合成請求',serviceStartedOn:'2026-01-01',serviceEndedOn:'2026-01-31',amountJpy:1000 }
      return {...period,contractConfirmation:{reference:`契約${id}`,reason:'各契約の明細と照合',confirmedAt:'2026-09-09T00:00:00Z',basis:chargeContractBasis(period)}}
    })
    const frozen = buildReviewMaterials(data.workspace,data.balances,2026,data.observation)
    expect(frozen.costs.sources.filter((row) => row.kind === 'subscription').map((row) => row.originalAmountJpy)).toEqual([1000,1000])
    const markdown = costProjectionMarkdown(frozen.costs)
    expect(markdown).toContain('重なる請求を別契約として確認済みです。')
    expect(markdown).toContain('各契約の明細と照合')
    data.workspace.configuration.chargePeriods[0]!.amountJpy = 2000
    const changed = buildReviewMaterials(data.workspace,data.balances,2026,data.observation)
    expect(costProjectionMarkdown(changed.costs)).toContain('請求内容変更のため')
    expect(costProjectionMarkdown(changed.costs)).not.toContain('別契約として確認済み')
    expect(costProjectionMarkdown(frozen.costs)).toBe(markdown)
    expect(historicalReviewMaterials(changed,data.balances)).not.toEqual(historicalReviewMaterials(frozen,data.balances))
  })
  it.each([1200, 0, null])(
    'preserves earlier monthly charges when a future invoice is added (%s)',
    (amountJpy) => {
      const data = fixture()
      data.workspace.configuration.charges.claude = 9000
      data.workspace.configuration.monthlyCharges = [
        {
          provider: 'claude',
          month: '2026-01',
          amountJpy,
          ...(amountJpy === null ? { unknownAmountReason: '過年度明細を確認中' } : {}),
        },
      ]
      const before = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
      expect(
        before.costs.sources.find(
          (source) =>
            source.origin === 'legacy-monthly' && source.servicePeriod?.startedOn === '2026-01-01',
        )?.originalAmountJpy,
      ).toBe(amountJpy)
      data.workspace.configuration.chargePeriods = [
        {
          id: 'future-invoice',
          provider: 'claude',
          planName: '翌年の請求',
          serviceStartedOn: '2027-01-01',
          serviceEndedOn: '2027-01-31',
          amountJpy: 4000,
        },
      ]
      const after = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
      expect(after.costs).toEqual(before.costs)
      expect(historicalReviewMaterials(after, data.balances)).toEqual(
        historicalReviewMaterials(before, data.balances),
      )
    },
  )
  it('preserves earlier observed-month estimates when a future invoice is added', () => {
    const data = fixture()
    data.workspace.configuration.charges.claude = 1200
    const before = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    data.workspace.configuration.chargePeriods = [
      {
        id: 'future-invoice',
        provider: 'claude',
        planName: '翌年の請求',
        serviceStartedOn: '2027-01-01',
        serviceEndedOn: '2027-01-31',
        amountJpy: 4000,
      },
    ]
    const after = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    expect(after.costs).toEqual(before.costs)
    expect(historicalReviewMaterials(after, data.balances)).toEqual(
      historicalReviewMaterials(before, data.balances),
    )
  })
  it('does not change an earlier year when a future invoice extends an overlap chain', () => {
    const data = fixture()
    const invoice = {
      id: 'a',
      provider: 'claude' as const,
      planName: '合成請求',
      serviceStartedOn: '2026-01-01',
      serviceEndedOn: '2026-12-31',
      amountJpy: 3650,
    }
    data.workspace.configuration.chargePeriods = [
      invoice,
      { ...invoice, id: 'bridge', serviceStartedOn: '2026-07-01', serviceEndedOn: '2027-07-31' },
    ]
    const before = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    data.workspace.configuration.chargePeriods.push({
      ...invoice,
      id: 'future',
      serviceStartedOn: '2027-02-01',
      serviceEndedOn: '2027-02-28',
    })
    const after = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    expect(historicalReviewMaterials(after, data.balances)).toEqual(
      historicalReviewMaterials(before, data.balances),
    )
    expect(costProjectionMarkdown(after.costs, 'recorded')).not.toContain('future')
    const next = buildReviewMaterials(data.workspace, data.balances, 2027, data.observation)
    expect(
      next.costs.bases.some((row) =>
        row.warnings.some((message) => message.includes('bridge') && message.includes('future')),
      ),
    ).toBe(true)
  })
  it('keeps unknown overlapping invoices and the overlap explanation in annual materials', () => {
    const data = fixture()
    data.workspace.configuration.chargePeriods = [
      {
        id: 'a',
        provider: 'claude',
        planName: '旧プラン',
        serviceStartedOn: '2025-12-20',
        serviceEndedOn: '2026-01-15',
        amountJpy: 1000,
      },
      {
        id: 'b',
        provider: 'claude',
        planName: '新プラン',
        serviceStartedOn: '2026-01-10',
        serviceEndedOn: '2026-02-01',
        amountJpy: null,
        unknownAmountReason: '精算待ち',
      },
    ]
    const material = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    const bases = material.costs.bases.filter((row) => row.sourceId?.startsWith('ai:charge:'))
    expect(bases).toHaveLength(3)
    expect(
      bases.every((row) => row.warnings.some((text) => text.includes('請求期間が重なっています'))),
    ).toBe(true)
    expect(
      material.costs.sources.find((row) => row.id === 'ai:charge:b')?.originalAmountJpy,
    ).toBeNull()
    const recorded = costProjectionMarkdown(material.costs, 'recorded')
    expect(recorded).toContain('原額を自動除外していません。')
    expect(recorded).toContain('未算定の理由: 精算待ち')
  })
  it('keeps duplicate invoice candidates and their full amounts in frozen explanations', () => {
    const data = fixture()
    const invoice = {
      id: 'invoice-a',
      provider: 'claude' as const,
      planName: '合成請求',
      serviceStartedOn: '2026-01-01',
      serviceEndedOn: '2026-01-31',
      amountJpy: 1000,
    }
    data.workspace.configuration.chargePeriods = [invoice, { ...invoice, id: 'invoice-b' }]
    const material = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    expect(
      material.costs.sources
        .filter((row) => row.kind === 'subscription')
        .map((row) => row.originalAmountJpy),
    ).toEqual([1000, 1000])
    expect(
      material.costs.bases
        .filter((row) => row.sourceId?.startsWith('ai:charge:'))
        .every((row) => row.warnings.some((text) => text.includes('重複候補'))),
    ).toBe(true)
    // Both invoices stay in the known basis (1,000 + 1,000 + the 100 direct cost).
    expect(material.costs.totals.knownBasisJpy).toBe(2100)
    expect(costProjectionMarkdown(material.costs, 'recorded')).toContain(
      '重複候補ですが原額を自動除外していません。',
    )
    data.workspace.configuration.chargePeriods.pop()
    const current = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    expect(
      current.costs.bases.every((row) => row.warnings.every((text) => !text.includes('重複候補'))),
    ).toBe(true)
    expect(costProjectionMarkdown(material.costs, 'recorded')).toContain('重複候補')
  })
  it('freezes the invoice evidence link and explanation without the private original path', () => {
    const data = fixture()
    data.workspace.configuration.chargePeriods = [
      {
        id: 'invoice',
        provider: 'claude',
        planName: '合成請求',
        serviceStartedOn: '2026-01-01',
        serviceEndedOn: '2026-01-31',
        amountJpy: 1000,
        evidenceIds: ['e'],
      },
    ]
    const materials = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    expect(materials.configuration.chargePeriods?.[0]?.evidenceIds).toEqual(['e'])
    expect(
      materials.costs.sources.find((row) => row.id === 'ai:charge:invoice')?.evidenceIds,
    ).toEqual(['e'])
    expect(costProjectionMarkdown(materials.costs, 'recorded')).toContain('証拠参照ID: e')
    expect(JSON.stringify(materials)).not.toContain('receipt.pdf')
    data.workspace.planning.evidence[0]!.note = '後日の訂正'
    data.workspace.configuration.chargePeriods[0]!.evidenceIds = []
    expect(materials.planning.evidence[0]!.note).toBe('確認した資料')
    expect(materials.configuration.chargePeriods?.[0]?.evidenceIds).toEqual(['e'])
  })
  let db: DatabaseSync | undefined
  afterEach(() => {
    db?.close()
    db = undefined
  })
  it('retains fact and method answers with the question without automatically resolving or changing money', () => {
    const data = fixture()
    data.balances.pendingDecisions = [
      {
        id: 'question',
        taxYear: 2026,
        taxUnitId: 'u',
        amount: { status: 'unknown', amountJpy: null, reasons: ['対象額の確認待ち'] },
        accountIds: ['a'],
        sourceIds: ['e'],
        reasons: ['用途を確認する'],
        answers: [
          {
            id: 'answer',
            taxYear: 2026,
            receivedOn: '2027-02-01',
            kind: 'fact',
            answer: '業務用途を確認した',
            source: '本人の利用記録',
          },
        ],
      },
    ]
    expect(balanceSnapshotSchema.safeParse(data.balances).success).toBe(true)
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    expect(getBalanceDraft(db).snapshot.pendingDecisions[0]!.answers).toEqual(
      data.balances.pendingDecisions[0]!.answers,
    )
    const reader = (_db: DatabaseSync, s: BalanceSnapshot, y: number) =>
      buildReviewMaterials(data.workspace, s, y, data.observation)
    const preview = previewBalanceReview(db, 2026, reader)
    expect(preview.projection.pendingDecisions).toHaveLength(1)
    expect(preview.projection.totals.knownClosingJpy).toBe(100)
    const saved = adoptBalanceReview(
      db,
      {
        year: 2026,
        expectedDraftRevision: preview.draftRevision,
        projectionHash: preview.projectionHash,
        idempotencyKey: 'answer-fixed',
        reason: '回答を含めて保存',
      },
      reader,
    )
    const output = reviewExportMarkdown(getBalanceReview(db, saved.id)!)
    expect(output).toContain('事実の回答 / 対象年 2026 / 受領日 2027-02-01')
    expect(output).toContain('本人の利用記録')
    const historical = historicalReviewMaterials(saved.materials!, saved.snapshot)
    data.balances.pendingDecisions[0]!.answers!.push({
      id: 'future',
      taxYear: 2027,
      receivedOn: '2027-03-01',
      kind: 'method',
      answer: '次年度の方法を相談',
      source: '相談先の回答',
    })
    expect(historicalReviewMaterials(saved.materials!, data.balances)).toEqual(historical)
    saveBalanceDraft(db, data.balances, 1)
    expect(
      previewBalanceReview(db, 2026, reader).projection.pendingDecisions[0]!.answers,
    ).toHaveLength(1)
    expect(
      previewBalanceReview(db, 2027, reader).projection.pendingDecisions[0]!.answers,
    ).toHaveLength(2)
    data.balances.pendingDecisions[0]!.answers![0]!.answer = '事実回答を訂正'
    saveBalanceDraft(db, data.balances, 2)
    expect(historicalReviewMaterials(saved.materials!, data.balances)).not.toEqual(historical)
    expect(reviewExportMarkdown(getBalanceReview(db, saved.id)!)).toBe(output)
    const pending = data.balances.pendingDecisions[0]!
    pending.resolution = { taxYear: 2026, decisionId: 'd', reason: '回答を確認' }
    saveBalanceDraft(db, data.balances, 3)
    const stale = previewBalanceReview(db, 2026, reader)
    expect(stale.projection.pendingDecisions).toHaveLength(1)
    expect(stale.materials!.referenceCheck.issues).toContainEqual(
      expect.objectContaining({ code: 'changed-answer' }),
    )
    expect(() =>
      adoptBalanceReview(
        db!,
        {
          year: 2026,
          expectedDraftRevision: stale.draftRevision,
          projectionHash: stale.projectionHash,
          idempotencyKey: 'unconfirmed-answer',
          reason: '合成確認',
        },
        reader,
      ),
    ).toThrow('参照の問題')
    pending.resolution.answerBasis = consultationAnswersForYear(pending, 2026)
    pending.resolution.questionBasis = consultationQuestionBasis(pending)
    expect(balanceSnapshotSchema.safeParse(data.balances).success).toBe(true)
    saveBalanceDraft(db, data.balances, 4)
    expect(getBalanceDraft(db).snapshot.pendingDecisions[0]!.resolution!.answerBasis).toEqual(
      pending.resolution.answerBasis,
    )
    expect(getBalanceDraft(db).snapshot.pendingDecisions[0]!.resolution!.questionBasis).toEqual(
      pending.resolution.questionBasis,
    )
    const confirmed = previewBalanceReview(db, 2026, reader)
    expect(confirmed.materials!.referenceCheck.status).toBe('consistent')
    expect(confirmed.projection.pendingDecisions).toHaveLength(0)
    const fixed = adoptBalanceReview(
      db,
      {
        year: 2026,
        expectedDraftRevision: confirmed.draftRevision,
        projectionHash: confirmed.projectionHash,
        idempotencyKey: 'confirmed-answer',
        reason: '回答と判断の再確認',
      },
      reader,
    )
    expect(reviewExportMarkdown(fixed)).toContain('## 解消した確認事項')
    pending.answers![1]!.answer = '翌年の方法回答を訂正'
    saveBalanceDraft(db, data.balances, 5)
    expect(previewBalanceReview(db, 2026, reader).projection.pendingDecisions).toHaveLength(0)
    pending.answers![0]!.source = '確認先を訂正'
    saveBalanceDraft(db, data.balances, 6)
    expect(previewBalanceReview(db, 2026, reader).projection.pendingDecisions).toHaveLength(1)
    expect(getBalanceReview(db, fixed.id)!.projection.pendingDecisions).toHaveLength(0)
    data.balances.pendingDecisions[0]!.answers![0]!.receivedOn = '2027-02-30'
    expect(() => validateBalanceSnapshot(data.balances)).toThrow('存在する日付')
    data.balances.pendingDecisions[0]!.answers![0]!.receivedOn = '2027-02-01'
    data.balances.pendingDecisions[0]!.answers![0]!.source = ''
    expect(() => validateBalanceSnapshot(data.balances)).toThrow('回答の確認先・根拠')
  })
  it('compares persisted annual materials without phantom changes and detects a corrected prior carry', () => {
    const data = fixture()
    const cost = buildReviewMaterials(
      data.workspace,
      data.balances,
      2026,
      data.observation,
    ).costs.contributions.find((row) => row.target.kind === 'tax-unit')!
    if (data.balances.movements[0]!.kind !== 'addition') throw new Error('fixture')
    data.balances.movements[0]!.costAllocations = [
      { costYear: 2026, contributionId: cost.id, amountJpy: 100 },
    ]
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, snapshot: BalanceSnapshot, year: number) =>
      buildReviewMaterials(data.workspace, snapshot, year, data.observation)
    const adopt = (year: number, key: string) => {
      const preview = previewBalanceReview(db!, year, reader)
      return adoptBalanceReview(
        db!,
        {
          year,
          expectedDraftRevision: preview.draftRevision,
          projectionHash: preview.projectionHash,
          idempotencyKey: key,
          reason: '合成年度の確認',
        },
        reader,
      )
    }
    const prior = adopt(2026, 'compare-prior')
    const next = adopt(2027, 'compare-next')
    const later = adopt(2028, 'compare-later')
    for (const record of [prior, next]) {
      const persisted = getBalanceReview(db, record.id)!
      const comparison = compareReview(
        persisted,
        previewBalanceReview(db, record.year, reader),
        getBalanceDraft(db).snapshot,
      )
      expect(comparison.changes).toEqual([])
      expect(comparison.materialCoverage).toBe('both')
      expect(comparison.previousReviewChanged).toBe(false)
      expect(comparison.balanceImpact[0]).toMatchObject({
        opening: { deltaJpy: 0 },
        closing: { deltaJpy: 0 },
      })
    }
    const originalExport = reviewExportMarkdown(getBalanceReview(db, next.id)!)
    data.balances.movements[0]!.reason = '金額を変えず根拠を訂正'
    saveBalanceDraft(db, data.balances, 1)
    const reasonDiff = compareReview(
      getBalanceReview(db, prior.id)!,
      previewBalanceReview(db, 2026, reader),
      getBalanceDraft(db).snapshot,
    )
    expect(reasonDiff.changes).toContainEqual({
      path: ['balanceInputs', 'movements', 'm', 'reason'],
      operation: 'changed',
      before: '合成の記録',
      after: '金額を変えず根拠を訂正',
    })
    expect(reasonDiff.balanceImpact[0]!.closing.deltaJpy).toBe(0)
    const corrected = adopt(2026, 'compare-correction')
    const carryDiff = compareReview(
      getBalanceReview(db, next.id)!,
      previewBalanceReview(db, 2027, reader),
      getBalanceDraft(db).snapshot,
    )
    expect(carryDiff.previousReviewChanged).toBe(true)
    expect(carryDiff.changes).toContainEqual({
      path: ['materials', 'openingLotCarry', 'previousReviewId'],
      operation: 'changed',
      before: prior.id,
      after: corrected.id,
    })
    expect(carryDiff.balanceImpact[0]!.opening.deltaJpy).toBe(0)
    expect(reviewExportMarkdown(getBalanceReview(db, next.id)!)).toBe(originalExport)
    const laterPreview = previewBalanceReview(db, 2028, reader)
    expect(laterPreview.previousReviewId).toBe(next.id)
    expect(laterPreview.previousReviewChainChanged).toBe(true)
    expect(laterPreview.previousReviewChanges).toEqual([
      {
        year: 2026,
        referencingYear: 2027,
        storedReviewId: prior.id,
        currentReviewId: corrected.id,
      },
    ])
    const laterDiff = compareReview(
      getBalanceReview(db, later.id)!,
      laterPreview,
      getBalanceDraft(db).snapshot,
    )
    expect(laterDiff.previousReviewChanged).toBe(true)
    expect(laterDiff.balanceImpact[0]!.opening.deltaJpy).toBe(0)
    expect(() => adopt(2028, 'compare-unreflected')).toThrow('過年度訂正の未反映')
  })
  it('persists balance flow links and refuses overclaimed sources at adoption', () => {
    const data = fixture()
    const cost = buildReviewMaterials(
      data.workspace,
      data.balances,
      2026,
      data.observation,
    ).costs.contributions.find((row) => row.target.kind === 'tax-unit')!
    if (data.balances.movements[0]!.kind !== 'addition') throw new Error('fixture')
    data.balances.movements[0]!.costAllocations = [
      { costYear: 2026, contributionId: cost.id, amountJpy: 100 },
    ]
    data.balances.movements.push({
      id: 'expense',
      kind: 'expense',
      accountId: 'a',
      occurredOn: '2026-02-01',
      amountJpy: 10,
      sourceIds: ['direct:cost'],
      decisionId: 'd',
      reason: '合成費用化',
      balanceAllocations: [{ sourceKind: 'opening', sourceId: 'a', amountJpy: 10 }],
    })
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    expect(getBalanceDraft(db).snapshot.movements[1]!.balanceAllocations).toEqual(
      data.balances.movements[1]!.balanceAllocations,
    )
    const reader = (_db: DatabaseSync, s: BalanceSnapshot, y: number) =>
      buildReviewMaterials(data.workspace, s, y, data.observation)
    let preview = previewBalanceReview(db, 2026, reader)
    expect(preview.materials!.balanceFlowCheck!.status).toBe('invalid')
    expect(() =>
      adoptBalanceReview(
        db!,
        {
          year: 2026,
          expectedDraftRevision: preview.draftRevision,
          projectionHash: preview.projectionHash,
          idempotencyKey: 'flow-invalid',
          reason: '合成',
        },
        reader,
      ),
    ).toThrow('残高移動の対応元')
    data.balances.movements[1]!.balanceAllocations = [
      {
        sourceKind: 'movement',
        sourceId: 'm',
        amountJpy: 10,
        costAllocations: [{ costYear: 2026, contributionId: cost.id, amountJpy: 10 }],
      },
    ]
    saveBalanceDraft(db, data.balances, 1)
    preview = previewBalanceReview(db, 2026, reader)
    const saved = adoptBalanceReview(
      db,
      {
        year: 2026,
        expectedDraftRevision: preview.draftRevision,
        projectionHash: preview.projectionHash,
        idempotencyKey: 'flow-valid',
        reason: '合成',
      },
      reader,
    )
    expect(saved.materials!.balanceFlowCheck!.status).toBe('consistent')
    expect(saved.materials!.balanceLotTrace).toMatchObject({
      status: 'consistent',
      movements: expect.arrayContaining([
        expect.objectContaining({
          movementId: 'expense',
          lots: [{ costYear: 2026, contributionId: cost.id, amountJpy: 10 }],
          untracedJpy: 0,
        }),
      ]),
    })
    expect(getBalanceReview(db, saved.id)!.materials!.balanceLotTrace).toEqual(
      saved.materials!.balanceLotTrace,
    )
    expect(reviewExportMarkdown(saved)).toContain('受入時 100円 / 残り 90円')
    expect(reviewExportMarkdown(saved)).toContain('原価内訳: 明示指定')
    data.workspace.planning.directCosts[0]!.amountJpy = 200
    expect(getBalanceReview(db, saved.id)!.materials!.balanceLotTrace).toEqual(
      saved.materials!.balanceLotTrace,
    )
    expect(reviewExportMarkdown(saved)).toContain('残高対応元: 増加・振替受入 / m / 使用額 10円')
    expect(reviewExportMarkdown(saved)).toContain('元額 100円 / 使用額 10円 / 残り 90円')
    expect(reviewExportMarkdown(saved)).toContain(
      '移動ID expense: 移動額 10円 / 対応額 10円 / 未対応額 0円',
    )
    const unavailable = structuredClone(saved)
    unavailable.materials!.balanceFlowCheck!.sources[0]!.amountJpy = null
    unavailable.materials!.balanceFlowCheck!.sources[0]!.remainingJpy = null
    expect(reviewExportMarkdown(unavailable)).toContain(
      '元額 照合不能 / 使用額 0円 / 残り 照合不能',
    )
    expect(saved.snapshot.movements[1]!.balanceAllocations).toEqual(
      data.balances.movements[1]!.balanceAllocations,
    )
    data.workspace.planning.directCosts[0]!.amountJpy = 100
    const next = previewBalanceReview(db, 2027, reader)
    expect(next.materials!.openingLotCarry).toMatchObject({
      previousReviewId: saved.id,
      status: 'consistent',
      accounts: [
        {
          accountId: 'a',
          opening: { status: 'known', amountJpy: 90 },
          lots: [{ costYear: 2026, contributionId: cost.id, amountJpy: 90 }],
          untracedJpy: 0,
        },
      ],
    })
    const nextSaved = adoptBalanceReview(
      db,
      {
        year: 2027,
        expectedDraftRevision: next.draftRevision,
        projectionHash: next.projectionHash,
        idempotencyKey: 'opening-carry',
        reason: '前年の原価を引き継ぐ',
      },
      reader,
    )
    expect(getBalanceReview(db, nextSaved.id)!.materials!.openingLotCarry).toEqual(
      next.materials!.openingLotCarry,
    )
    expect(reviewExportMarkdown(nextSaved)).toContain('繰越額 90円')
    data.balances.movements[1]!.balanceAllocations![0]!.costAllocations![0]!.contributionId =
      'missing-lot'
    saveBalanceDraft(db, data.balances, 2)
    const invalidLot = previewBalanceReview(db, 2026, reader)
    expect(invalidLot.materials!.balanceFlowCheck!.status).toBe('consistent')
    expect(invalidLot.materials!.balanceLotTrace!.status).toBe('invalid')
    expect(() =>
      adoptBalanceReview(
        db!,
        {
          year: 2026,
          expectedDraftRevision: invalidLot.draftRevision,
          projectionHash: invalidLot.projectionHash,
          idempotencyKey: 'invalid-lot',
          reason: '原価確認',
        },
        reader,
      ),
    ).toThrow('使用原価の内訳')
  })
  it('freezes direct target shares and names while detecting active share changes', () => {
    const data = fixture()
    data.workspace.planning.taxUnits.push({
      ...data.workspace.planning.taxUnits[0]!,
      id: 'v',
      name: '当時の第二制作物',
    })
    const cost = data.workspace.planning.directCosts[0]!
    cost.targets = [
      { taxUnitId: 'u', shareBps: 2500 },
      { taxUnitId: 'v', shareBps: 5000 },
    ]
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, s: BalanceSnapshot, y: number) =>
      buildReviewMaterials(data.workspace, s, y, data.observation)
    const preview = previewBalanceReview(db, 2026, reader)
    const adopted = adoptBalanceReview(
      db,
      {
        year: 2026,
        expectedDraftRevision: preview.draftRevision,
        projectionHash: preview.projectionHash,
        idempotencyKey: 'direct-targets',
        reason: '配分の確認',
      },
      reader,
    )
    const historical = historicalReviewMaterials(adopted.materials!, data.balances)
    cost.targets.reverse()
    cost.directlyAttributable = false
    delete cost.taxUnitId
    expect(historicalReviewMaterials(reader(db, data.balances, 2026), data.balances)).toEqual(
      historical,
    )
    cost.targets[0]!.shareBps = null
    expect(historicalReviewMaterials(reader(db, data.balances, 2026), data.balances)).not.toEqual(
      historical,
    )
    data.workspace.planning.taxUnits[1]!.name = '現在の改名'
    const saved = getBalanceReview(db, adopted.id)!
    expect(saved.materials!.planning.directCosts[0]!.targets).toEqual([
      { taxUnitId: 'u', shareBps: 2500 },
      { taxUnitId: 'v', shareBps: 5000 },
    ])
    expect(reviewExportMarkdown(saved)).toContain('当時の第二制作物 / 制作物ID v / 50%')
    expect(reviewExportMarkdown(saved)).not.toContain('現在の改名')
  })
  it('freezes annual declarations and guards their year without treating future declarations as historical changes', () => {
    const data = fixture()
    data.workspace.planning.equipment = [
      {
        id: 'pc',
        name: 'PC',
        equipmentType: 'pc',
        acquisitionCostJpy: 240000,
        acquiredOn: '2026-01-01',
        businessUseStartedOn: '2026-07-31',
        convertedFromPrivate: false,
        businessUseRatio: 0.5,
        projectAllocationRatio: 0.6,
        taxUnitId: 'u',
        evidenceIds: [],
        role: '制作',
      },
    ]
    data.workspace.planning.taxUnits.push({
      ...data.workspace.planning.taxUnits[0]!,
      id: 'v',
      name: '別制作物',
    })
    data.workspace.planning.equipmentMethods = [
      {
        id: 'method',
        equipmentId: 'pc',
        taxYear: 2026,
        taxpayer: 'individual',
        assetKind: 'tangible-equipment',
        method: 'straight-line',
        methodReason: '当時の設備条件',
        allocation: {
          taxUnitId: 'u',
          businessUseRatio: 0.8,
          projectAllocationRatio: 0.25,
          reason: '当時の割合根拠',
          targets: [
            { taxUnitId: 'u', shareBps: 2500 },
            { taxUnitId: 'v', shareBps: 5000 },
          ],
        },
        usefulLifeYears: 4,
        useThroughYearEnd: 'confirmed',
        ordinaryTreatment: 'confirmed',
        priorClosing: null,
        recordedAt: '2026-09-08T00:00:00Z',
      },
    ]
    data.workspace.planning.costPresence = [
      {
        id: 'presence',
        taxYear: 2026,
        category: 'home',
        status: 'deferred',
        reason: '当時の確認待ち',
        recordedAt: '2026-09-08T00:00:00Z',
      },
    ]
    data.workspace.planning.homeCosts = [
      {
        id: 'home',
        month: '2026-07',
        category: 'rent',
        amountJpy: 4000,
        method: 'area',
        businessUseRatio: 0.5,
        basis: '当時の面積',
        rationale: '当時の用途',
        taxUnitId: 'u',
        projectAllocationRatio: 0.9,
        treatment: 'shared',
        evidenceIds: [],
        targets: [
          { taxUnitId: 'u', shareBps: 2500 },
          { taxUnitId: 'v', shareBps: 5000 },
        ],
      },
    ]
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, s: BalanceSnapshot, y: number) =>
      buildReviewMaterials(data.workspace, s, y, data.observation)
    const preview = previewBalanceReview(db, 2026, reader)
    const adopted = adoptBalanceReview(
      db,
      {
        year: 2026,
        expectedDraftRevision: preview.draftRevision,
        projectionHash: preview.projectionHash,
        idempotencyKey: 'presence-review',
        reason: '固定の確認',
      },
      reader,
    )
    const historical = historicalReviewMaterials(adopted.materials!, data.balances)
    data.workspace.planning.homeCosts[0]!.targets!.reverse()
    data.workspace.planning.homeCosts[0]!.projectAllocationRatio = 0.1
    expect(historicalReviewMaterials(reader(db, data.balances, 2026), data.balances)).toEqual(
      historical,
    )
    data.workspace.planning.equipmentMethods![0]!.allocation!.taxUnitId = null
    data.workspace.planning.equipmentMethods![0]!.allocation!.projectAllocationRatio = 0.99
    data.workspace.planning.equipmentMethods![0]!.allocation!.targets!.reverse()
    expect(historicalReviewMaterials(reader(db, data.balances, 2026), data.balances)).toEqual(
      historical,
    )
    data.workspace.planning.equipment[0]!.businessUseRatio = 0.1
    data.workspace.planning.equipment[0]!.projectAllocationRatio = 0.1
    delete data.workspace.planning.equipment[0]!.taxUnitId
    expect(historicalReviewMaterials(reader(db, data.balances, 2026), data.balances)).toEqual(
      historical,
    )
    data.workspace.planning.equipmentMethods.push({
      ...data.workspace.planning.equipmentMethods[0]!,
      id: 'future-method',
      taxYear: 2027,
    })
    data.workspace.planning.costPresence.push({
      ...data.workspace.planning.costPresence[0]!,
      id: 'future',
      taxYear: 2027,
    })
    expect(historicalReviewMaterials(reader(db, data.balances, 2026), data.balances)).toEqual(
      historical,
    )
    data.workspace.planning.homeCosts[0]!.targets![0]!.shareBps = null
    data.workspace.planning.homeCosts[0]!.rationale = '変更後の用途'
    expect(historicalReviewMaterials(reader(db, data.balances, 2026), data.balances)).not.toEqual(
      historical,
    )
    data.workspace.planning.costPresence[0]!.reason = '後で理由を変更'
    data.workspace.planning.equipmentMethods[0]!.allocation = {
      businessUseRatio: 0.5,
      projectAllocationRatio: 1,
      reason: '後で変更した割合',
    }
    data.workspace.planning.equipmentMethods[0]!.usefulLifeYears = 5
    expect(historicalReviewMaterials(reader(db, data.balances, 2026), data.balances)).not.toEqual(
      historical,
    )
    data.workspace.planning.equipment[0]!.name = '現在の別名PC'
    data.workspace.planning.taxUnits[0]!.name = '現在の別名制作物'
    const saved = getBalanceReview(db, adopted.id)!
    expect(saved.materials?.planning.homeCosts[0]).toMatchObject({
      rationale: '当時の用途',
      targets: [
        { taxUnitId: 'u', shareBps: 2500 },
        { taxUnitId: 'v', shareBps: 5000 },
      ],
    })
    expect(reviewExportMarkdown(saved)).toContain('当時の面積 / 理由 当時の用途')
    expect(reviewExportMarkdown(saved)).not.toContain('変更後の用途')
    expect(saved.materials?.planning.equipmentMethods).toHaveLength(1)
    expect(saved.materials?.planning.equipmentMethods?.[0]?.usefulLifeYears).toBe(4)
    expect(saved.materials?.equipmentCalculations?.[0]).toMatchObject({
      equipmentId: 'pc',
      methodRecordId: 'method',
      taxYear: 2026,
      inputIssues: [],
      result: {
        taxTreatmentVerified: false,
        calculation: { openingBasisJpy: 240000, depreciationJpy: 30000, closingBasisJpy: 210000 },
      },
    })
    expect(reviewExportMarkdown(saved)).toContain(
      '設備全体の期首・当年取得基礎 240000円 / 普通償却 30000円 / 期末 210000円',
    )
    const legacy = structuredClone(saved)
    delete legacy.materials!.equipmentCalculations
    expect(reviewExportMarkdown(legacy)).toContain('現在の入力から補完しません')
    expect(saved.materials?.planning.equipmentMethods?.[0]?.allocation).toEqual({
      taxUnitId: 'u',
      businessUseRatio: 0.8,
      projectAllocationRatio: 0.25,
      reason: '当時の割合根拠',
      targets: [
        { taxUnitId: 'u', shareBps: 2500 },
        { taxUnitId: 'v', shareBps: 5000 },
      ],
    })
    expect(reviewExportMarkdown(saved)).toContain('別制作物 / 制作物ID v / 業務分の 50%')
    expect(reviewExportMarkdown(saved)).toContain('PC / 設備ID pc')
    expect(reviewExportMarkdown(saved)).toContain('合成制作物 / 制作物ID u')
    expect(reviewExportMarkdown(saved)).not.toContain('現在の別名')
    const unnamed = structuredClone(saved)
    unnamed.materials!.planning.equipment = []
    unnamed.materials!.planning.taxUnits = []
    expect(reviewExportMarkdown(unnamed)).toContain('名称未収録 / 設備ID pc')
    expect(reviewExportMarkdown(unnamed)).toContain('名称未収録 / 制作物ID v')
    const escaped = structuredClone(saved)
    escaped.materials!.planning.equipment[0]!.name = '<img>'
    expect(reviewExportMarkdown(escaped)).toContain(String.raw`\<img\> / 設備ID pc`)

    expect(reviewExportMarkdown(saved)).toContain('普通償却額 30000円')
    expect(saved.materials?.planning.costPresence).toHaveLength(1)
    expect(
      saved.materials?.costPresenceCheck?.items.find((row) => row.category === 'home')?.status,
    ).toBe('deferred')
    expect(reviewExportMarkdown(saved)).toContain('cost-presence/1')
    expect(reviewExportMarkdown(saved)).toContain('当時の確認待ち')
    expect(reviewExportMarkdown(saved)).not.toContain('後で理由を変更')
  })
  it('rejects conflicting annual declarations atomically, then permits a retained deferral with a fresh preview', () => {
    const data = fixture()
    data.workspace.planning.costPresence = [
      {
        id: 'presence',
        taxYear: 2026,
        category: 'direct',
        status: 'not-applicable',
        reason: '登録と一致しない確認',
        recordedAt: '2026-09-08T00:00:00Z',
      },
    ]
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, s: BalanceSnapshot, y: number) =>
      buildReviewMaterials(data.workspace, s, y, data.observation)
    const preview = previewBalanceReview(db, 2026, reader)
    expect(
      preview.materials?.costPresenceCheck?.items.find((row) => row.category === 'direct'),
    ).toMatchObject({ status: 'conflict', recordIds: ['cost'] })
    const request = {
      year: 2026,
      expectedDraftRevision: preview.draftRevision,
      projectionHash: preview.projectionHash,
      idempotencyKey: 'presence-conflict',
      reason: '資料を確認',
    }
    expect(() => adoptBalanceReview(db!, request, reader)).toThrow(
      '該当なしの確認と登録費用に不一致',
    )
    expect(previewBalanceReview(db, 2026, reader).currentReviewId).toBeNull()
    data.workspace.planning.costPresence[0]!.status = 'deferred'
    expect(() => adoptBalanceReview(db!, request, reader)).toThrow('確認後に入力')
    const fresh = previewBalanceReview(db, 2026, reader)
    const adopted = adoptBalanceReview(
      db,
      { ...request, projectionHash: fresh.projectionHash },
      reader,
    )
    expect(
      adopted.materials?.costPresenceCheck?.items.find((row) => row.category === 'direct')?.status,
    ).toBe('deferred')
    expect(adopted.materials?.planning.directCosts[0]?.amountJpy).toBe(100)
    data.workspace.planning.costPresence[0]!.status = 'not-applicable'
    expect(getBalanceReview(db, adopted.id)).toEqual(adopted)
  })

  it('adopts a later resolution without rewriting the earlier question and rejects an unconfirmed answer', () => {
    const data = fixture()
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    data.balances.pendingDecisions = [
      {
        id: 'q',
        taxYear: 2026,
        taxUnitId: 'u',
        amount: { status: 'known', amountJpy: 0 },
        accountIds: ['a'],
        sourceIds: ['e'],
        reasons: ['扱いの確認待ち'],
      },
    ]
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, s: BalanceSnapshot, y: number) =>
      buildReviewMaterials(data.workspace, s, y, data.observation)
    const adopt = (year: number) => {
      const p = previewBalanceReview(db!, year, reader)
      return adoptBalanceReview(
        db!,
        {
          year,
          expectedDraftRevision: p.draftRevision,
          projectionHash: p.projectionHash,
          idempotencyKey: 'year-' + year,
          reason: '資料確認',
        },
        reader,
      )
    }
    const old = adopt(2026)
    data.workspace.planning.decisions.push({
      ...data.workspace.planning.decisions[0]!,
      id: 'answer',
      taxYear: 2027,
      status: 'pending',
    })
    data.balances.pendingDecisions[0]!.resolution = {
      taxYear: 2027,
      decisionId: 'answer',
      reason: '資料を確認した',
    }
    saveBalanceDraft(db, data.balances, 1)
    expect(() => adopt(2027)).toThrow()
    data.workspace.planning.decisions[1]!.status = 'confirmed'
    const current = adopt(2027)
    expect(current.projection.pendingDecisions).toEqual([])
    expect(current.snapshot.pendingDecisions[0]!.resolution?.decisionId).toBe('answer')
    expect(getBalanceReview(db, old.id)).toEqual(old)
  })
  it('binds equipment carry checks to the previous adopted calculation and blocks mismatches atomically', () => {
    const data = fixture()
    data.workspace.planning.equipment = [
      {
        id: 'pc',
        name: 'PC',
        equipmentType: 'pc',
        acquisitionCostJpy: 240000,
        acquiredOn: '2026-01-01',
        businessUseStartedOn: '2026-07-31',
        convertedFromPrivate: false,
        businessUseRatio: 1,
        projectAllocationRatio: 1,
        role: '開発',
        evidenceIds: [],
      },
    ]
    data.workspace.planning.equipmentMethods = [
      {
        id: 'm26',
        equipmentId: 'pc',
        taxYear: 2026,
        taxpayer: 'individual',
        assetKind: 'tangible-equipment',
        method: 'straight-line',
        methodReason: '確認条件',
        usefulLifeYears: 4,
        useThroughYearEnd: 'confirmed',
        ordinaryTreatment: 'confirmed',
        priorClosing: null,
        recordedAt: '2026-09-08T00:00:00Z',
      },
    ]
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, snapshot: BalanceSnapshot, year: number) =>
      buildReviewMaterials(data.workspace, snapshot, year, data.observation)
    const adopt = (year: number) => {
      const preview = previewBalanceReview(db!, year, reader)
      return adoptBalanceReview(
        db!,
        {
          year,
          expectedDraftRevision: preview.draftRevision,
          projectionHash: preview.projectionHash,
          idempotencyKey: crypto.randomUUID(),
          reason: '合成の確認',
        },
        reader,
      )
    }
    const previous = adopt(2026)
    data.workspace.planning.equipmentMethods.push({
      ...data.workspace.planning.equipmentMethods[0]!,
      id: 'm27',
      taxYear: 2027,
      priorClosing: { taxYear: 2026, amountJpy: 200000, reference: '本人が入力した参照' },
    })
    const mismatch = previewBalanceReview(db, 2027, reader)
    expect(mismatch.materials?.equipmentCarryCheck).toMatchObject({
      previousReviewId: previous.id,
      rows: [{ status: 'mismatch', enteredJpy: 200000, previousClosingJpy: 210000 }],
    })
    expect(() => adopt(2027)).toThrow(/設備の前年残高/)
    expect(previewBalanceReview(db, 2027, reader).currentReviewId).toBeNull()
    data.workspace.planning.equipmentMethods[1]!.priorClosing!.amountJpy = 210000
    expect(() =>
      adoptBalanceReview(
        db!,
        {
          year: 2027,
          expectedDraftRevision: mismatch.draftRevision,
          projectionHash: mismatch.projectionHash,
          idempotencyKey: crypto.randomUUID(),
          reason: '旧確認',
        },
        reader,
      ),
    ).toThrow(/確認後に入力/)
    data.workspace.planning.equipmentMethods[1]!.priorReviewId = crypto.randomUUID()
    expect(
      previewBalanceReview(db, 2027, reader).materials?.equipmentCarryCheck?.rows[0]?.reason,
    ).toContain('金額が同じでも')
    expect(() => adopt(2027)).toThrow(/設備の前年残高/)
    data.workspace.planning.equipmentMethods[1]!.priorReviewId = previous.id
    const saved = adopt(2027)
    expect(
      saved.materials?.planning.equipmentMethods?.find((row) => row.taxYear === 2027)
        ?.priorReviewId,
    ).toBe(previous.id)
    expect(saved.materials?.equipmentCarryCheck?.rows[0]?.status).toBe('matched')
    expect(saved.materials?.taxTreatmentVerified).toBe(false)
    const legacy = structuredClone(previous)
    delete legacy.materials!.equipmentCalculations
    expect(checkEquipmentCarry(saved.materials!, legacy).rows[0]?.status).toBe('unavailable')
    expect(checkEquipmentCarry(saved.materials!, null).rows[0]?.status).toBe('unavailable')
    expect(reviewExportMarkdown(saved)).toContain('前年資料ID: ' + previous.id)
    expect(getBalanceReview(db, previous.id)).toEqual(previous)
  })
  it('includes carried unresolved records and their evidence while ignoring unrelated future records', () => {
    const data = fixture()
    data.balances.accounts[0]!.openingYear = 2025
    data.balances.pendingDecisions = [
      {
        id: 'p',
        taxUnitId: 'u',
        taxYear: 2025,
        amount: { status: 'unknown', amountJpy: null, reasons: ['確認待ち'] },
        accountIds: ['a'],
        sourceIds: ['e'],
        reasons: ['確認待ち'],
      },
    ]
    const material = buildReviewMaterials(data.workspace, data.balances, 2026, data.observation)
    const before = historicalReviewMaterials(material, data.balances)
    const changed = structuredClone(data.balances)
    changed.pendingDecisions[0]!.reasons = ['回答を記録']
    expect(historicalReviewMaterials(material, changed)).not.toEqual(before)
    changed.pendingDecisions = [
      ...data.balances.pendingDecisions,
      { ...data.balances.pendingDecisions[0]!, id: 'future', taxYear: 2027 },
    ]
    expect(historicalReviewMaterials(material, changed)).toEqual(before)
    changed.pendingDecisions[0]!.resolution = {
      taxYear: 2027,
      decisionId: 'later',
      reason: '翌年の回答',
    }
    expect(historicalReviewMaterials(material, changed)).toEqual(before)
    changed.pendingDecisions[0]!.resolution!.taxYear = 2026
    expect(historicalReviewMaterials(material, changed)).not.toEqual(before)
  })
  it('requires correction of changed historical costs or evidence even across an unchanged intervening year, but permits future inputs', () => {
    const data = fixture()
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, snapshot: BalanceSnapshot, year: number) =>
      buildReviewMaterials(data.workspace, snapshot, year, data.observation)
    const adopt = (year: number) => {
      const preview = previewBalanceReview(db!, year, reader)
      return adoptBalanceReview(
        db!,
        {
          year,
          expectedDraftRevision: preview.draftRevision,
          projectionHash: preview.projectionHash,
          idempotencyKey: crypto.randomUUID(),
          reason: '合成の年次確認',
        },
        reader,
      )
    }
    const first = adopt(2026)
    data.workspace.planning.directCosts.push({
      ...data.workspace.planning.directCosts[0]!,
      id: 'future',
      incurredOn: '2027-06-01',
    })
    data.observation.overview.recentScans[0]!.completedAt = '2027-06-02T00:00:00Z'
    const second = adopt(2027)
    data.workspace.planning.directCosts[0]!.amountJpy = 200
    expect(() => adopt(2028)).toThrow(/2026年の保存済み費用/)
    data.workspace.planning.directCosts[0]!.amountJpy = 100
    data.workspace.planning.decisions[0]!.reason = '前年判断の根拠を変更'
    expect(() => adopt(2028)).toThrow(/2026年の保存済み費用/)
    data.workspace.planning.decisions[0]!.reason = '確認理由'
    data.workspace.planning.evidence[0]!.note = '根拠の訂正'
    expect(() => adopt(2028)).toThrow(/保存済み費用/)
    expect(getBalanceReview(db, first.id)).toEqual(first)
    expect(getBalanceReview(db, second.id)).toEqual(second)
    const correctedFirst = adopt(2026)
    expect(correctedFirst.correctsReviewId).toBe(first.id)
    expect(() => adopt(2028)).toThrow(/過年度訂正の未反映/)
    adopt(2027)
    expect(adopt(2028).year).toBe(2028)
  })
  it('captures costs, decisions and numerical observations without original paths, native IDs or source labels', () => {
    const { workspace, balances, observation } = fixture()
    const material = buildReviewMaterials(workspace, balances, 2026, observation)
    expect(material.costs.totals.taxUnitJpy).toBe(100)
    expect(material.planning.decisions[0]!.reason).toBe('確認理由')
    expect(material.observations[0]).toMatchObject({ inputTokens: 10, outputTokens: 20 })
    const json = JSON.stringify(material)
    for (const excluded of [
      'private-source',
      'native-session-secret',
      'C:\\\\private',
      'localReference',
      'sourceName',
      'projectLabel',
    ])
      expect(json).not.toContain(excluded)
    workspace.planning.decisions[0]!.reason = '後の判断'
    observation.sessions[0]!.inputTokens = 999
    expect(material.planning.decisions[0]!.reason).toBe('確認理由')
    expect(material.observations[0]!.inputTokens).toBe(10)
  })
  it('rejects stale confirmation when only a cost, decision or observation changed', () => {
    const data = fixture()
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, snapshot: BalanceSnapshot, year: number) =>
      buildReviewMaterials(data.workspace, snapshot, year, data.observation)
    const before = previewBalanceReview(db, 2026, reader)
    const request = {
      year: 2026,
      expectedDraftRevision: 1,
      projectionHash: before.projectionHash,
      idempotencyKey: 'stale',
      reason: '確認',
    }
    data.workspace.planning.directCosts[0]!.amountJpy = 200
    expect(() => adoptBalanceReview(db!, request, reader)).toThrow(/確認後/)
    data.workspace.planning.directCosts[0]!.amountJpy = 100
    data.workspace.planning.decisions[0]!.reason = '根拠の更新'
    expect(() => adoptBalanceReview(db!, request, reader)).toThrow(/確認後/)
    data.workspace.planning.decisions[0]!.reason = '確認理由'
    data.observation.sessions[0]!.inputTokens++
    expect(() => adoptBalanceReview(db!, request, reader)).toThrow(/確認後/)
    data.observation.sessions[0]!.inputTokens--
    data.observation.overview.recentScans[0]!.status = 'failed'
    expect(() => adoptBalanceReview(db!, request, reader)).toThrow(/確認後/)
    expect(db.prepare('SELECT count(*) AS n FROM balance_reviews').get()).toMatchObject({ n: 0 })
  })
  it('stores the verified bundle immutably, replays retries after source deletion and refuses loss of source binding', () => {
    const data = fixture()
    db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    saveBalanceDraft(db, data.balances, 0)
    const reader = (_db: DatabaseSync, snapshot: BalanceSnapshot, year: number) =>
      buildReviewMaterials(data.workspace, snapshot, year, data.observation)
    const before = previewBalanceReview(db, 2026, reader)
    const request = {
      year: 2026,
      expectedDraftRevision: 1,
      projectionHash: before.projectionHash,
      idempotencyKey: 'adopt',
      reason: '確認した記録',
    }
    const adopted = adoptBalanceReview(db, request, reader)
    expect(adopted.materials).toEqual(before.materials)
    data.workspace.planning.decisions = []
    data.observation.sessions = []
    expect(adoptBalanceReview(db, request, reader)).toEqual(adopted)
    expect(getBalanceReview(db, adopted.id)).toEqual(adopted)
    const invalid = previewBalanceReview(db, 2026, reader)
    expect(() =>
      adoptBalanceReview(
        db!,
        { ...request, idempotencyKey: 'bad-ref', projectionHash: invalid.projectionHash },
        reader,
      ),
    ).toThrow(/対応/)
    const unbound = previewBalanceReview(db, 2026)
    expect(() =>
      adoptBalanceReview(db!, {
        ...request,
        idempotencyKey: 'downgrade',
        projectionHash: unbound.projectionHash,
      }),
    ).toThrow(/残高だけ/)
    expect(() => db!.exec('UPDATE balance_reviews SET payload = payload')).toThrow(/immutable/)
  })
})
