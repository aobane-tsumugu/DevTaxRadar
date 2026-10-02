import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import {
  readActivityLedger,
  writeActivityLedger,
} from '../../src/server/activityLedgerRepository.js'
import { createDataBundle, restoreDataBundle } from '../../src/server/dataBundle.js'
import type { ActivityFact } from '../../src/planning/activityFacts.js'
import { reviewExportMarkdown } from '../../src/core/reviewExport.js'

const dirs: string[] = []
afterEach(() => {
  vi.resetModules()
  delete process.env.DEVTAX_RADAR_DATA_DIR
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})
function sample() {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits = [
    {
      id: 'unit',
      name: '合成制作物',
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'efficiency',
      lifecycleStatus: 'developing',
    },
  ]
  planning.evidence = [
    {
      id: 'proof',
      evidenceType: 'memo',
      strength: 'self-recorded',
      recordedAt: '2026-01-01T00:00:00Z',
      note: '本人確認した資料',
      localReference: '/synthetic/private-original',
    },
  ]
  const fact: ActivityFact = {
    id: 'fact',
    productId: 'product',
    taxUnitId: 'unit',
    kind: 'development',
    purpose: 'new-development',
    time: { kind: 'period', startedOn: '2026-01-01', endedOn: '2026-12-31' },
    state: 'estimated',
    scope: '初期版',
    reason: '過去の日時を推定',
    evidenceIds: ['proof'],
    recordedAt: '2026-01-01T00:00:00Z',
  }
  planning.activityLedger = {
    version: 1,
    products: [{ id: 'product', name: '合成作品' }],
    unitLinks: [{ id: 'link', productId: 'product', taxUnitId: 'unit' }],
    facts: [fact],
  }
  return { planning, fact }
}
async function database() {
  const root = mkdtempSync(join(tmpdir(), 'devtax-activity-'))
  dirs.push(root)
  process.env.DEVTAX_RADAR_DATA_DIR = join(root, 'data')
  const module = await import('../../src/server/database.js')
  return { root, db: module.getDatabase() }
}
describe('activity ledger persistence and immutable adoption', () => {
  it('adds facts atomically without rewriting legacy IDs and preserves retry/revision boundaries', async () => {
    const { db } = await database()
    try {
      const repository = await import('../../src/server/planningRepository.js'),
        workspace = await import('../../src/server/workspaceRepository.js')
      const { planning, fact } = sample()
      repository.savePlanningSnapshot(planning, db)
      const before = repository.getPlanningSnapshot(db)
      expect(before.activityLedger).toEqual(planning.activityLedger)
      expect(() =>
        repository.savePlanningSnapshot({ ...before, activityLedger: undefined }, db),
      ).toThrow('旧版')
      expect(() =>
        repository.savePlanningSnapshot(
          { ...before, activityLedger: { ...before.activityLedger!, facts: [] } },
          db,
        ),
      ).toThrow('訂正')
      db.exec(
        "CREATE TRIGGER fail_activity_test BEFORE INSERT ON planning_profiles BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
      )
      const corrected = structuredClone(before)
      corrected.activityLedger!.facts.push({
        ...fact,
        id: 'correction',
        correctsId: fact.id,
        correctionReason: '日時根拠を追加',
        state: 'confirmed',
      })
      expect(() => repository.savePlanningSnapshot(corrected, db)).toThrow('synthetic failure')
      expect(repository.getPlanningSnapshot(db)).toEqual(before)
      db.exec('DROP TRIGGER fail_activity_test')
      const base = workspace.readWorkspace((draft) => draft, db)
      const request = {
        expectedRevision: base.revision,
        requestId: randomUUID(),
        configuration: base.configuration,
        planning: corrected,
      }
      const saved = workspace.saveWorkspace(request, (draft) => draft, db)
      expect(workspace.saveWorkspace(request, (draft) => draft, db)).toEqual(saved)
      expect(() =>
        workspace.saveWorkspace({ ...request, planning: before }, (draft) => draft, db),
      ).toThrow('同じ保存要求')
      expect(() =>
        workspace.saveWorkspace({ ...request, requestId: randomUUID() }, (draft) => draft, db),
      ).toThrow('別の保存')
      expect(saved.planning.taxUnits[0]!.id).toBe('unit')
    } finally {
      db.close()
    }
  })
  it('backs up/restores additive envelopes byte-for-byte and rejects future contract versions', async () => {
    const { root, db } = await database()
    try {
      writeActivityLedger(db, sample().planning.activityLedger)
      const source = process.env.DEVTAX_RADAR_DATA_DIR!
      writeFileSync(join(source, 'identifier-salt'), randomBytes(32).toString('base64url') + '\n')
      const bundle = join(root, 'bundle'),
        restored = join(root, 'restored')
      const manifest = createDataBundle(source, bundle)
      restoreDataBundle(bundle, restored, manifest.schemaHash)
      const restoredDb = new DatabaseSync(join(restored, 'devtax-radar.db'), { readOnly: true })
      try {
        expect(readActivityLedger(restoredDb)).toEqual(readActivityLedger(db))
      } finally {
        restoredDb.close()
      }
      db.prepare("UPDATE app_settings SET value=? WHERE key='planning_activity_ledger_v1'").run(
        JSON.stringify({ ...sample().planning.activityLedger, version: 2 }),
      )
      expect(() => readActivityLedger(db)).toThrow()
      expect(() => createDataBundle(source, join(root, 'future'))).toThrow()
    } finally {
      db.close()
    }
  })
  it('fixes N and N+1 records independently, detects unchanged-amount evidence corrections, and keeps old exports/hash', async () => {
    const { db } = await database()
    try {
      const repository = await import('../../src/server/planningRepository.js'),
        balances = await import('../../src/server/balanceRepository.js')
      const { readReviewMaterials } = await import('../../src/server/reviewMaterials.js')
      const { planning, fact } = sample()
      repository.savePlanningSnapshot(planning, db)
      const adopt = (year: number) => {
        const preview = balances.previewBalanceReview(db, year, readReviewMaterials)
        return balances.adoptBalanceReview(
          db,
          {
            year,
            expectedDraftRevision: preview.draftRevision,
            projectionHash: preview.projectionHash,
            idempotencyKey: randomUUID(),
            reason: '合成活動を確認',
          },
          readReviewMaterials,
        )
      }
      const first = adopt(2026),
        second = adopt(2027)
      const bytes = db
        .prepare('SELECT id,payload,content_hash FROM balance_reviews ORDER BY rowid')
        .all()
      const exportBefore = reviewExportMarkdown(first)
      expect(exportBefore).toContain('推定')
      expect(exportBefore).not.toContain('/synthetic/private-original')
      planning.activityLedger!.facts.push({
        ...fact,
        id: 'corrected',
        correctsId: fact.id,
        correctionReason: '証拠の確認で期間を訂正',
        state: 'confirmed',
      })
      planning.evidence[0]!.note = '同額でも根拠を再確認'
      repository.savePlanningSnapshot(planning, db)
      expect(
        db.prepare('SELECT id,payload,content_hash FROM balance_reviews ORDER BY rowid').all(),
      ).toEqual(bytes)
      expect(reviewExportMarkdown(balances.getBalanceReview(db, first.id)!)).toBe(exportBefore)
      expect(balances.getBalanceReview(db, second.id)?.id).toBe(second.id)
      expect(() => adopt(2027)).toThrow()
      const { readProductTimeline } = await import('../../src/server/productTimeline.js')
      const view = readProductTimeline(db)
      expect(view.products[0]?.entries).toHaveLength(2)
      expect(JSON.stringify(view)).not.toContain('/synthetic/private-original')
    } finally {
      db.close()
    }
  })
})
