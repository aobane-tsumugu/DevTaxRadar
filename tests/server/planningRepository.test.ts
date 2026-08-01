import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyPlanningSnapshot, type PlanningSnapshot } from '../../src/planning/types.js'

const directories: string[] = []

function samplePlanning(): PlanningSnapshot {
  return {
    version: 1,
    profile: {
      taxYear: 2026,
      journeyMode: 'early',
      incomeCategory: 'undecided',
      filingType: 'white',
      monetizationStatus: 'planned',
      hasBookkeeping: true,
    },
    taxUnits: [
      {
        id: 'unit-app-v1',
        name: '自分利用・公開兼用アプリ v1',
        unitType: 'new-software',
        usageMode: 'mixed',
        revenueModel: 'subscription',
        lifecycleStatus: 'evaluating',
        journeyMode: 'early',
        monetizationStatus: 'planned',
        completionCriteria: '正式業務で利用でき、公開版も動作する',
        sameAsExternalVersion: 'yes',
      },
    ],
    projectRules: [
      {
        id: 'rule-app-development',
        projectKey: 'project_1234567890abcdef12345678',
        provider: 'codex',
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-07-31',
        taxUnitId: 'unit-app-v1',
        classification: 'new-development',
        reason: '正式利用前の開発期間',
      },
    ],
    lifecycleEvents: [
      {
        id: 'event-internal-use',
        taxUnitId: 'unit-app-v1',
        eventType: 'internal-use-started',
        occurredOn: '2026-07-20',
        recordedAt: '2026-07-21T10:00:00+09:00',
        evidenceIds: ['evidence-first-use'],
      },
    ],
    equipment: [
      {
        id: 'equipment-dgx',
        name: 'AIワークステーション',
        equipmentType: 'dgx',
        acquisitionCostJpy: 650_000,
        acquiredOn: '2026-07-01',
        businessUseStartedOn: '2026-07-10',
        convertedFromPrivate: false,
        businessUseRatio: 0.9,
        usefulLifeYears: 4,
        role: 'ローカルモデル検証',
        taxUnitId: 'unit-app-v1',
        projectAllocationRatio: 0.7,
        evidenceIds: ['evidence-receipt'],
      },
    ],
    homeCosts: [
      {
        id: 'home-electricity-july',
        month: '2026-07',
        category: 'electricity',
        amountJpy: 18_000,
        method: 'watt-hour',
        businessUseRatio: 0.4,
        basis: '機器W数×稼働時間',
        rationale: '作業ログと定格消費電力から算定',
        taxUnitId: 'unit-app-v1',
        projectAllocationRatio: 0.8,
        treatment: 'shared',
        evidenceIds: [],
      },
    ],
    directCosts: [
      {
        id: 'cost-domain',
        taxUnitId: 'unit-app-v1',
        incurredOn: '2026-07-02',
        costType: 'domain',
        amountJpy: 3_000,
        directlyAttributable: true,
        treatment: 'direct',
        evidenceIds: ['evidence-receipt'],
      },
    ],
    evidence: [
      {
        id: 'evidence-first-use',
        evidenceType: 'first-use',
        strength: 'self-recorded',
        occurredOn: '2026-07-20',
        recordedAt: '2026-07-21T10:00:00+09:00',
        note: '正式な制作作業へ初めて利用した',
        taxUnitId: 'unit-app-v1',
      },
      {
        id: 'evidence-receipt',
        evidenceType: 'receipt',
        strength: 'external',
        recordedAt: '2026-07-02T10:00:00+09:00',
        localReference: 'C:/private/receipt.pdf',
        note: '領収書を端末内に保存',
      },
    ],
    decisions: [
      {
        id: 'decision-v1',
        taxUnitId: 'unit-app-v1',
        taxYear: 2026,
        engineVersion: 'planning-v1',
        candidate: 'software-acquisition-cost',
        status: 'confirmed',
        createdAt: '2026-07-21T10:00:00+09:00',
        confirmedAt: '2026-07-21T10:05:00+09:00',
        reason: '登録事実を確認した',
      },
    ],
  }
}

afterEach(async () => {
  vi.resetModules()
  delete process.env.DEVTAX_RADAR_DATA_DIR
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('planning repository', () => {
  it('round-trips every normalized planning record', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'devtax-planning-'))
    directories.push(directory)
    process.env.DEVTAX_RADAR_DATA_DIR = directory
    const repository = await import('../../src/server/planningRepository.js')
    const database = await import('../../src/server/database.js')
    const snapshot = samplePlanning()

    try {
      repository.savePlanningSnapshot(snapshot)
      expect(JSON.parse(JSON.stringify(repository.getPlanningSnapshot()))).toEqual(
        JSON.parse(JSON.stringify(snapshot)),
      )
    } finally {
      database.getDatabase().close()
    }
  })

  it('rejects dangling references and reversed rule periods before writing', async () => {
    const repository = await import('../../src/server/planningRepository.js')
    const invalid = samplePlanning()
    invalid.projectRules[0] = {
      ...invalid.projectRules[0]!,
      effectiveFrom: '2026-08-01',
      effectiveTo: '2026-07-01',
      taxUnitId: 'missing-unit',
    }
    const result = repository.planningSnapshotSchema.safeParse(invalid)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          '制作物・改良計画が存在しません。',
          '終了日は開始日以後にしてください。',
        ]),
      )
    }
  })

  it('exports an adviser-readable summary without exposing local file paths', async () => {
    const repository = await import('../../src/server/planningRepository.js')
    const markdown = repository.planningMarkdown(samplePlanning())
    expect(markdown).toContain('# DevTax Radar 計画・原価資料')
    expect(markdown).toContain('自分利用・公開兼用アプリ v1')
    expect(markdown).toContain('AIワークステーション')
    expect(markdown).toContain('正式な制作作業へ初めて利用した')
    expect(markdown).not.toContain('C:/private/receipt.pdf')
  })

  it('制作物を指定しないルールを保存できる', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'devtax-planning-'))
    directories.push(directory)
    process.env.DEVTAX_RADAR_DATA_DIR = directory
    const repository = await import('../../src/server/planningRepository.js')
    const database = await import('../../src/server/database.js')
    const db = database.getDatabase()

    try {
      const snapshot = {
        ...emptyPlanningSnapshot(2026),
        projectRules: [
          {
            id: 'rule-private',
            projectKey: 'project_private_0001',
            effectiveFrom: '2026-01-01',
            classification: 'private' as const,
          },
        ],
      }

      repository.savePlanningSnapshot(snapshot, db)
      const stored = repository.getPlanningSnapshot(db)
      expect(stored.projectRules[0]?.taxUnitId).toBeUndefined()
      expect(stored.projectRules[0]?.classification).toBe('private')
    } finally {
      db.close()
    }
  })

  it('一般学習の分類を保存できる', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'devtax-planning-'))
    directories.push(directory)
    process.env.DEVTAX_RADAR_DATA_DIR = directory
    const repository = await import('../../src/server/planningRepository.js')
    const database = await import('../../src/server/database.js')
    const db = database.getDatabase()

    try {
      const snapshot = {
        ...emptyPlanningSnapshot(2026),
        projectRules: [
          {
            id: 'rule-learning',
            projectKey: 'project_learning_001',
            effectiveFrom: '2026-01-01',
            classification: 'general-learning' as const,
          },
        ],
      }

      repository.savePlanningSnapshot(snapshot, db)
      expect(repository.getPlanningSnapshot(db).projectRules[0]?.classification).toBe(
        'general-learning',
      )
    } finally {
      db.close()
    }
  })

  it('存在しない制作物を指すルールは拒否する', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'devtax-planning-'))
    directories.push(directory)
    process.env.DEVTAX_RADAR_DATA_DIR = directory
    const repository = await import('../../src/server/planningRepository.js')
    const database = await import('../../src/server/database.js')
    const db = database.getDatabase()

    try {
      const snapshot = {
        ...emptyPlanningSnapshot(2026),
        projectRules: [
          {
            id: 'rule-orphan',
            projectKey: 'project_orphan_0001',
            effectiveFrom: '2026-01-01',
            taxUnitId: 'missing-unit',
            classification: 'new-development' as const,
          },
        ],
      }
      expect(() => repository.savePlanningSnapshot(snapshot, db)).toThrow()
    } finally {
      db.close()
    }
  })
})
