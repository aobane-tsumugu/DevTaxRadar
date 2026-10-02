import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import type { OriginalChargeCandidate } from '../../src/planning/originalCharges.js'
import {
  applyOriginalChargeCandidates,
  originalChargeCandidateFromSource,
} from '../../src/core/originalChargeIntake.js'
import type {
  WorkspaceDraft,
  WorkspaceImpact,
  WorkspaceView,
} from '../../src/planning/workspace.js'
import { reviewExportMarkdown } from '../../src/core/reviewExport.js'
import { compareReview } from '../../src/core/reviewComparison.js'
import {
  createDataBundle,
  databaseSchemaHash,
  restoreDataBundle,
  verifyDataBundle,
} from '../../src/server/dataBundle.js'
import { readArchiveReview } from '../../src/server/reviewArchive.js'
import { readOriginalCharges } from '../../src/server/originalChargesRepository.js'

const directories: string[] = []
let child: ChildProcess | undefined

afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit')
    const timeout = setTimeout(() => child?.kill('SIGKILL'), 3000)
    child.kill()
    try {
      await exited
    } finally {
      clearTimeout(timeout)
    }
  }
  child = undefined
  vi.resetModules()
  delete process.env.DEVTAX_RADAR_DATA_DIR
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function temporaryDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'devtax-original-charges-'))
  directories.push(root)
  return root
}

async function database() {
  const root = temporaryDirectory()
  process.env.DEVTAX_RADAR_DATA_DIR = join(root, 'data')
  const module = await import('../../src/server/database.js')
  const db = module.getDatabase()
  const workspace = await import('../../src/server/workspaceRepository.js')
  const planning = await import('../../src/server/planningRepository.js')
  return { root, db, workspace, planning }
}

function sample(base: WorkspaceDraft): WorkspaceDraft {
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
  planning.evidence = ['receipt', 'fx-proof'].map((id) => ({
    id,
    evidenceType: 'receipt',
    strength: 'external',
    recordedAt: '2026-03-13T00:00:00Z',
    note: '合成の請求・換算資料 ' + id,
    localReference: 'PRIVATE_ORIGINAL_CHARGE_PATH_CANARY',
  }))
  const candidate: OriginalChargeCandidate = {
    category: 'direct',
    record: {
      id: 'invoice',
      incurredOn: '2026-03-12',
      costType: 'cloud',
      amountJpy: 1000,
      directlyAttributable: true,
      treatment: 'direct',
      taxUnitId: 'unit',
      evidenceIds: ['receipt'],
    },
    original: {
      currency: 'USD',
      amount: '10',
      amountJpy: 1000,
      fx: {
        currency: 'USD',
        foreignAmount: '10',
        jpyPerUnit: '100',
        rounding: 'nearest-yen',
        convertedOn: '2026-03-12',
        reference: '合成の決済換算資料',
      },
      conversionEvidenceIds: ['fx-proof'],
    },
    dates: { incurredOn: '2026-03-12', billedOn: '2026-03-12', paidOn: '2026-03-13' },
    evidenceIds: ['receipt'],
    provenance: { kind: 'manual' },
  }
  planning.sourceAdjustments = [
    {
      id: 'refund',
      sourceId: 'direct:invoice',
      sourceYear: 2026,
      sourceBasis: { kind: 'direct', originalAmountJpy: 1000, incurredOn: '2026-03-12' },
      kind: 'refund',
      amountJpy: -100,
      occurredOn: '2026-03-14',
      recordedAt: '2026-03-14T00:00:00Z',
      effect: 'undetermined',
      reason: '合成返金。税務上の扱いは未判断。',
      evidenceIds: ['receipt'],
    },
  ]
  return applyOriginalChargeCandidates({ ...structuredClone(base), planning }, [candidate], {
    recordedAt: '2026-03-13T00:00:00Z',
    createId: () => 'original-fact',
  }).workspace
}

function metadataCorrection(workspace: WorkspaceDraft): WorkspaceDraft {
  const next = structuredClone(workspace)
  const previous = next.planning.originalCharges!.facts.at(-1)!
  next.planning.originalCharges!.facts.push({
    ...structuredClone(previous),
    id: 'corrected-fact',
    correctsId: previous.id,
    correctionReason: '決済資料に基づき、同額の支払日を訂正',
    dates: { ...previous.dates, paidOn: '2026-03-14' },
    recordedAt: '2026-03-15T00:00:00Z',
  })
  return next
}

function saveRequest(base: WorkspaceDraft, contents = base) {
  return {
    expectedRevision: base.revision,
    requestId: randomUUID(),
    configuration: contents.configuration,
    planning: contents.planning,
  }
}

async function availablePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  )
  return address.port
}

async function startApi() {
  const root = temporaryDirectory()
  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  let output = ''
  child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
    cwd: resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      TZ: 'UTC',
      HOME: root,
      USERPROFILE: root,
      DEVTAX_RADAR_DATA_DIR: join(root, 'data'),
      DEVTAX_RADAR_AUTO_SCAN: '0',
      DEVTAX_RADAR_CLAUDE_SETTINGS: join(root, 'claude-settings.json'),
    },
  })
  const collect = (buffer: Buffer) => {
    output = (output + buffer.toString()).slice(-8000)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  const deadline = Date.now() + 12_000
  let csrfToken = ''
  while (Date.now() < deadline && !csrfToken) {
    if (child.exitCode !== null) throw new Error(output)
    try {
      const response = await fetch(origin + '/api/runtime')
      if (response.ok) csrfToken = ((await response.json()) as { csrfToken: string }).csrfToken
    } catch {
      // The isolated subprocess has not bound its loopback socket yet.
    }
    if (!csrfToken) await new Promise((done) => setTimeout(done, 50))
  }
  if (!csrfToken) throw new Error('Original charge API startup failed: ' + output)
  async function read() {
    const response = await fetch(origin + '/api/workspace')
    expect(response.status).toBe(200)
    return response.json() as Promise<WorkspaceView>
  }
  function send(path: string, method: 'POST' | 'PUT', body: unknown) {
    return fetch(origin + path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin,
        'x-devtax-csrf': csrfToken,
      },
      body: JSON.stringify(body),
    })
  }
  return { read, send }
}

describe('original charge persistence through the atomic workspace', () => {
  it('keeps the source identity, original currency facts and adjustment references', async () => {
    const { db, workspace } = await database()
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const input = sample(base)
      const saved = workspace.saveWorkspace(saveRequest(base, input), (value) => value, db)
      expect(saved.planning.originalCharges).toEqual(input.planning.originalCharges)
      expect(saved.planning.directCosts[0]?.id).toBe('invoice')
      expect(saved.planning.sourceAdjustments).toEqual(input.planning.sourceAdjustments)
      const { readReviewMaterials } = await import('../../src/server/reviewMaterials.js')
      const material = readReviewMaterials(
        db,
        { version: 1, accounts: [], movements: [], pendingDecisions: [] },
        2026,
      )
      const source = material.costs.sources.find((row) => row.id === 'direct:invoice')
      expect(source?.originalChargeFact).toEqual(input.planning.originalCharges!.facts[0])
      expect(source?.originalAmountJpy).toBe(1000)
      expect(source?.adjustments).toEqual(input.planning.sourceAdjustments)
      expect(JSON.stringify(material)).not.toContain('PRIVATE_ORIGINAL_CHARGE_PATH_CANARY')
    } finally {
      db.close()
    }
  })

  it('rolls back charge facts, categories, configuration, revision and receipt after a later failure', async () => {
    const { db, workspace } = await database()
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const beforeSettings = db.prepare('SELECT key,value FROM app_settings ORDER BY key').all()
      const input = sample(base)
      input.configuration.charges.claude = 1234
      if (input.configuration.unknownChargeReasons)
        delete input.configuration.unknownChargeReasons.claude
      db.exec(
        "CREATE TRIGGER fail_original_charge_test BEFORE INSERT ON planning_profiles BEGIN SELECT RAISE(ABORT,'synthetic original-charge failure'); END",
      )
      expect(() => workspace.saveWorkspace(saveRequest(base, input), (value) => value, db)).toThrow(
        'synthetic original-charge failure',
      )
      expect(workspace.readWorkspace((value) => value, db)).toEqual(base)
      expect(db.prepare('SELECT key,value FROM app_settings ORDER BY key').all()).toEqual(
        beforeSettings,
      )
      expect(readOriginalCharges(db)).toBeUndefined()
      db.exec('DROP TRIGGER fail_original_charge_test')
      const saved = workspace.saveWorkspace(saveRequest(base, input), (value) => value, db)
      expect(saved.planning.originalCharges?.facts).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('preserves retries and rejects changed retry payloads or stale revisions without extra facts', async () => {
    const { db, workspace } = await database()
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const request = saveRequest(base, sample(base))
      const first = workspace.saveWorkspace(request, (value) => value, db)
      expect(workspace.saveWorkspace(request, (value) => value, db)).toEqual(first)
      expect(readOriginalCharges(db)?.facts).toHaveLength(1)
      const changed = structuredClone(request)
      changed.planning.profile.notes = '同じ要求IDで異なる内容'
      expect(() => workspace.saveWorkspace(changed, (value) => value, db)).toThrow('同じ保存要求')
      expect(() =>
        workspace.saveWorkspace({ ...request, requestId: randomUUID() }, (value) => value, db),
      ).toThrow('別の保存')
      expect(workspace.readWorkspace((value) => value, db)).toEqual(first)
    } finally {
      db.close()
    }
  })

  it('rejects old-client omission, historical rewrites and category-only factual edits atomically', async () => {
    const { db, workspace, planning } = await database()
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const saved = workspace.saveWorkspace(saveRequest(base, sample(base)), (value) => value, db)
      const omitted = structuredClone(saved)
      delete omitted.planning.originalCharges
      expect(() =>
        workspace.saveWorkspace(saveRequest(saved, omitted), (value) => value, db),
      ).toThrow()
      expect(() => planning.savePlanningSnapshot(omitted.planning, db)).toThrow()
      const removed = structuredClone(saved)
      removed.planning.originalCharges!.facts = []
      expect(() =>
        workspace.saveWorkspace(saveRequest(saved, removed), (value) => value, db),
      ).toThrow()
      const rewritten = structuredClone(saved)
      rewritten.planning.originalCharges!.facts[0]!.recordedAt = '2026-03-15T00:00:00Z'
      expect(() =>
        workspace.saveWorkspace(saveRequest(saved, rewritten), (value) => value, db),
      ).toThrow()
      for (const patch of [
        { amountJpy: 2000 },
        { incurredOn: '2026-04-01' },
        { evidenceIds: [] },
      ]) {
        const divergent = structuredClone(saved)
        Object.assign(divergent.planning.directCosts[0]!, patch)
        expect(() =>
          workspace.saveWorkspace(saveRequest(saved, divergent), (value) => value, db),
        ).toThrow()
        expect(workspace.readWorkspace((value) => value, db)).toEqual(saved)
      }
      const allocation = structuredClone(saved)
      allocation.planning.directCosts[0]!.treatment = 'general'
      allocation.planning.directCosts[0]!.directlyAttributable = false
      delete allocation.planning.directCosts[0]!.taxUnitId
      const edited = workspace.saveWorkspace(saveRequest(saved, allocation), (value) => value, db)
      expect(edited.planning.originalCharges).toEqual(saved.planning.originalCharges)
    } finally {
      db.close()
    }
  })

  it('round-trips backup data and rejects future envelopes despite valid SQL schema and file hashes', async () => {
    const { db, root, workspace } = await database()
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const saved = workspace.saveWorkspace(saveRequest(base, sample(base)), (value) => value, db)
      const source = process.env.DEVTAX_RADAR_DATA_DIR!
      writeFileSync(join(source, 'identifier-salt'), randomBytes(32).toString('base64url') + '\n')
      const bundle = join(root, 'bundle')
      const restored = join(root, 'restored')
      const manifest = createDataBundle(source, bundle)
      expect(verifyDataBundle(bundle)).toEqual(manifest)
      restoreDataBundle(bundle, restored, databaseSchemaHash(db))
      const restoredDb = new DatabaseSync(join(restored, 'devtax-radar.db'), { readOnly: true })
      try {
        expect(readOriginalCharges(restoredDb)).toEqual(saved.planning.originalCharges)
        expect(
          restoredDb
            .prepare("SELECT value FROM app_settings WHERE key='planning_original_charges_v1'")
            .get(),
        ).toEqual(
          db
            .prepare("SELECT value FROM app_settings WHERE key='planning_original_charges_v1'")
            .get(),
        )
      } finally {
        restoredDb.close()
      }
      const futureBundle = join(root, 'future-bundle')
      const futureManifest = createDataBundle(source, futureBundle)
      const future = { ...saved.planning.originalCharges, version: 2 }
      const futureDb = new DatabaseSync(join(futureBundle, 'devtax-radar.db'))
      try {
        futureDb
          .prepare("UPDATE app_settings SET value=? WHERE key='planning_original_charges_v1'")
          .run(JSON.stringify(future))
        expect(databaseSchemaHash(futureDb)).toBe(futureManifest.schemaHash)
      } finally {
        futureDb.close()
      }
      const bytes = readFileSync(join(futureBundle, 'devtax-radar.db'))
      futureManifest.files['devtax-radar.db'] = {
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
      writeFileSync(join(futureBundle, 'manifest.json'), JSON.stringify(futureManifest))
      expect(() => verifyDataBundle(futureBundle)).toThrow()
      const rejectedDestination = join(root, 'rejected-restore')
      expect(() =>
        restoreDataBundle(futureBundle, rejectedDestination, manifest.schemaHash),
      ).toThrow()
      expect(existsSync(rejectedDestination)).toBe(false)
      db.prepare("UPDATE app_settings SET value=? WHERE key='planning_original_charges_v1'").run(
        JSON.stringify(future),
      )
      expect(() => createDataBundle(source, join(root, 'rejected-backup'))).toThrow()
      expect(existsSync(join(root, 'rejected-backup'))).toBe(false)
    } finally {
      db.close()
    }
  })

  it('rejects a future charge contract on startup before changing the persisted database', async () => {
    const { db, root, workspace } = await database()
    let closed = false
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const saved = workspace.saveWorkspace(saveRequest(base, sample(base)), (value) => value, db)
      db.prepare("UPDATE app_settings SET value=? WHERE key='planning_original_charges_v1'").run(
        JSON.stringify({ ...saved.planning.originalCharges, version: 2 }),
      )
      const before = db.prepare('SELECT key,value FROM app_settings ORDER BY key').all()
      const schemaHash = databaseSchemaHash(db)
      db.close()
      closed = true
      vi.resetModules()
      const restarted = await import('../../src/server/database.js')
      expect(() => restarted.getDatabase()).toThrow()
      const checked = new DatabaseSync(join(root, 'data', 'devtax-radar.db'), { readOnly: true })
      try {
        expect(checked.prepare('SELECT key,value FROM app_settings ORDER BY key').all()).toEqual(
          before,
        )
        expect(databaseSchemaHash(checked)).toBe(schemaHash)
      } finally {
        checked.close()
      }
    } finally {
      if (!closed) db.close()
    }
  })

  it('rejects fabricated legacy baselines and requires an explicit correction of an existing row', async () => {
    const { db, workspace, planning } = await database()
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const legacy = sample(base)
      delete legacy.planning.originalCharges
      const saved = workspace.saveWorkspace(saveRequest(base, legacy), (value) => value, db)
      const untracked = sample(saved)
      expect(() =>
        workspace.saveWorkspace(saveRequest(saved, untracked), (value) => value, db),
      ).toThrow('訂正前')
      expect(() => planning.savePlanningSnapshot(untracked.planning, db)).toThrow('訂正前')
      const proposed = sample(saved)
      const fact = proposed.planning.originalCharges!.facts[0]!
      fact.legacySourceId = 'direct:invoice'
      fact.correctionReason = '既存の請求に換算根拠を関連付け'
      fact.legacyPreviousRecord = structuredClone(saved.planning.directCosts[0]!)
      const forged = structuredClone(proposed)
      const predecessor = forged.planning.originalCharges!.facts[0]!.legacyPreviousRecord!
      if ('amountJpy' in predecessor) predecessor.amountJpy = 9999
      expect(() =>
        workspace.saveWorkspace(saveRequest(saved, forged), (value) => value, db),
      ).toThrow('訂正前')
      expect(workspace.readWorkspace((value) => value, db)).toEqual(saved)
      const corrected = workspace.saveWorkspace(saveRequest(saved, proposed), (value) => value, db)
      expect(corrected.planning.originalCharges?.facts[0]?.legacyPreviousRecord).toEqual(
        saved.planning.directCosts[0],
      )
      expect(corrected.planning.directCosts[0]?.id).toBe('invoice')
      expect(corrected.planning.sourceAdjustments).toEqual(saved.planning.sourceAdjustments)
    } finally {
      db.close()
    }
  })

  it('rejects a standalone planning write that diverges from its persisted subscription', async () => {
    const { db, workspace, planning } = await database()
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const legacy = structuredClone(base)
      legacy.configuration.chargePeriods.push({
        id: 'subscription',
        provider: 'claude',
        planName: '合成の年額請求',
        serviceStartedOn: '2026-01-01',
        serviceEndedOn: '2026-12-31',
        amountJpy: 100,
        evidenceIds: [],
      })
      const saved = workspace.saveWorkspace(saveRequest(base, legacy), (value) => value, db)
      const candidate = originalChargeCandidateFromSource(saved, 'subscription', 'subscription')
      if (candidate.category !== 'subscription') throw new Error('Wrong synthetic source category')
      candidate.record.amountJpy = 200
      candidate.original = { currency: 'JPY', amount: '200', amountJpy: 200 }
      candidate.correctionReason = '原請求を確認して金額を訂正'
      const proposed = applyOriginalChargeCandidates(saved, [candidate], {
        recordedAt: '2026-01-02T00:00:00Z',
        createId: () => 'subscription-fact',
      }).workspace
      expect(() => planning.savePlanningSnapshot(proposed.planning, db)).toThrow('分類先')
      expect(workspace.readWorkspace((value) => value, db)).toEqual(saved)
      const corrected = workspace.saveWorkspace(saveRequest(saved, proposed), (value) => value, db)
      expect(corrected.configuration.chargePeriods[0]?.amountJpy).toBe(200)
      expect(corrected.planning.originalCharges?.facts[0]?.sourceId).toBe('ai:charge:subscription')
      expect(corrected.planning.originalCharges?.facts[0]?.legacyPreviousRecord).toEqual(
        saved.configuration.chargePeriods[0],
      )
    } finally {
      db.close()
    }
  })

  it('keeps adopted N and N+1 bytes and exports fixed while surfacing same-amount corrections', async () => {
    const { db, root, workspace } = await database()
    try {
      const base = workspace.readWorkspace((value) => value, db)
      const saved = workspace.saveWorkspace(saveRequest(base, sample(base)), (value) => value, db)
      const balances = await import('../../src/server/balanceRepository.js')
      const { readReviewMaterials } = await import('../../src/server/reviewMaterials.js')
      function adopt(year: number) {
        const preview = balances.previewBalanceReview(db, year, readReviewMaterials)
        return balances.adoptBalanceReview(
          db,
          {
            year,
            expectedDraftRevision: preview.draftRevision,
            projectionHash: preview.projectionHash,
            idempotencyKey: randomUUID(),
            reason: '合成請求記録を確認',
          },
          readReviewMaterials,
        )
      }
      const first = adopt(2026)
      const second = adopt(2027)
      const originalRows = db
        .prepare('SELECT id,payload,content_hash FROM balance_reviews ORDER BY rowid')
        .all()
      const exports = [first, second].map(reviewExportMarkdown)
      const corrected = metadataCorrection(saved)
      workspace.saveWorkspace(saveRequest(saved, corrected), (value) => value, db)
      expect(
        db.prepare('SELECT id,payload,content_hash FROM balance_reviews ORDER BY rowid').all(),
      ).toEqual(originalRows)
      expect(
        [first.id, second.id].map((id) => reviewExportMarkdown(balances.getBalanceReview(db, id)!)),
      ).toEqual(exports)
      expect(readArchiveReview(join(root, 'data'), first.id)).toEqual(first)
      expect(readArchiveReview(join(root, 'data'), second.id)).toEqual(second)
      const current = balances.previewBalanceReview(db, 2026, readReviewMaterials)
      expect(current.materials?.costs.totals).toEqual(first.materials?.costs.totals)
      const comparison = compareReview(first, current, balances.getBalanceDraft(db).snapshot)
      expect(comparison.changes.some((change) => change.path.includes('originalChargeFact'))).toBe(
        true,
      )
      expect(() => adopt(2027)).toThrow('2026')
      expect(workspace.readWorkspace((value) => value, db).planning.sourceAdjustments).toEqual(
        saved.planning.sourceAdjustments,
      )
      const correctedFirst = adopt(2026)
      expect(correctedFirst.correctsReviewId).toBe(first.id)
      expect(balances.getBalanceReview(db, second.id)?.previousReviewId).toBe(first.id)
      expect(reviewExportMarkdown(balances.getBalanceReview(db, first.id)!)).toBe(exports[0])
      // Reading a fixed review must not parse or migrate a future working envelope.
      db.prepare("UPDATE app_settings SET value=? WHERE key='planning_original_charges_v1'").run(
        JSON.stringify({ ...corrected.planning.originalCharges, version: 2 }),
      )
      expect(readArchiveReview(join(root, 'data'), first.id)).toEqual(first)
      expect(readArchiveReview(join(root, 'data'), second.id)).toEqual(second)
    } finally {
      db.close()
    }
  })
})

describe('original charge review and save through the real API', () => {
  it('requires the current preview, does not write during preview and rejects changed retry payloads', async () => {
    const api = await startApi()
    const base = await api.read()
    const input = sample(base)
    const request = saveRequest(base, input)
    const unreviewed = await api.send('/api/workspace', 'PUT', request)
    expect(unreviewed.status).toBe(409)
    expect(((await unreviewed.json()) as { error: string }).error).toBe('preview_changed')
    expect(await api.read()).toEqual(base)
    const previewResponse = await api.send('/api/workspace/preview', 'POST', {
      expectedRevision: base.revision,
      configuration: input.configuration,
      planning: input.planning,
    })
    expect(previewResponse.status).toBe(200)
    const preview = (await previewResponse.json()) as WorkspaceImpact
    expect(preview.records.some((row) => row.key.includes('originalCharges'))).toBe(true)
    expect(await api.read()).toEqual(base)
    const reviewed = { ...request, previewHash: preview.previewHash }
    const changed = structuredClone(reviewed)
    changed.planning.profile.notes = '影響確認後に変わった内容'
    const tampered = await api.send('/api/workspace', 'PUT', changed)
    expect(tampered.status).toBe(409)
    expect(((await tampered.json()) as { error: string }).error).toBe('preview_changed')
    expect(await api.read()).toEqual(base)
    const response = await api.send('/api/workspace', 'PUT', reviewed)
    expect(response.status).toBe(200)
    const saved = (await response.json()) as WorkspaceView
    expect(saved.planning.originalCharges?.facts).toHaveLength(1)
    const retry = await api.send('/api/workspace', 'PUT', reviewed)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual(saved)
    const changedRetry = await api.send('/api/workspace', 'PUT', changed)
    expect(changedRetry.status).toBe(400)
    expect(((await changedRetry.json()) as { error: string }).error).toBe('request_reuse')
    const stale = await api.send('/api/workspace', 'PUT', { ...reviewed, requestId: randomUUID() })
    expect(stale.status).toBe(409)
    expect(await api.read()).toEqual(saved)

    const omitted = structuredClone(saved)
    delete omitted.planning.originalCharges
    const oldPreview = await api.send('/api/workspace/preview', 'POST', {
      expectedRevision: saved.revision,
      configuration: omitted.configuration,
      planning: omitted.planning,
    })
    expect(oldPreview.status).toBe(409)
    expect(await api.read()).toEqual(saved)
    const divergence = structuredClone(saved)
    divergence.planning.directCosts[0]!.amountJpy = 2000
    const divergentPreview = await api.send('/api/workspace/preview', 'POST', {
      expectedRevision: saved.revision,
      configuration: divergence.configuration,
      planning: divergence.planning,
    })
    expect(divergentPreview.status).toBe(409)
    expect(await api.read()).toEqual(saved)

    const corrected = metadataCorrection(saved)
    const correctionRequest = saveRequest(saved, corrected)
    expect((await api.send('/api/workspace', 'PUT', correctionRequest)).status).toBe(409)
    const correctionPreviewResponse = await api.send('/api/workspace/preview', 'POST', {
      expectedRevision: saved.revision,
      configuration: corrected.configuration,
      planning: corrected.planning,
    })
    expect(correctionPreviewResponse.status).toBe(200)
    const correctionPreview = (await correctionPreviewResponse.json()) as WorkspaceImpact
    const year = correctionPreview.years.find((row) => row.year === 2026)!
    expect(year.changed).toBe(true)
    expect(year.before.totals).toEqual(year.after.totals)
    expect(await api.read()).toEqual(saved)
    const correctedResponse = await api.send('/api/workspace', 'PUT', {
      ...correctionRequest,
      previewHash: correctionPreview.previewHash,
    })
    expect(correctedResponse.status).toBe(200)
    const correctedSave = (await correctedResponse.json()) as WorkspaceView
    expect(correctedSave.planning.originalCharges?.facts).toHaveLength(2)
    expect(correctedSave.planning.originalCharges?.facts[0]).toEqual(
      saved.planning.originalCharges?.facts[0],
    )
    expect(correctedSave.planning.sourceAdjustments).toEqual(saved.planning.sourceAdjustments)
  }, 20_000)
})
