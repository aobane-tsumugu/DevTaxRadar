import { test } from 'vitest'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ObservationRecordPayload,
  RecordedObservation,
  SourceCapture,
} from '../../src/accounting/observationRecord.js'
import * as records from '../../src/server/observationRecords.js'
import { captureWarnings } from '../../src/core/captureProvenance.js'
import { costProjectionMarkdown } from '../../src/core/costExport.js'

const row: RecordedObservation = {
  sourceId: 'local-codex',
  provider: 'codex',
  sessionKey: 'opaque-session',
  projectKey: 'opaque-project',
  month: '2026-07',
  startedAt: '2026-07-31T23:50:00Z',
  endedAt: '2026-07-31T23:50:00Z',
  messageCount: 1,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

function database(path = ':memory:') {
  const db = new DatabaseSync(path)
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT',
  )
  return db
}

function fixture(): ObservationRecordPayload {
  return {
    version: 1,
    kind: 'numeric-observation',
    datasetId: 'synthetic-dataset',
    timeZone: 'UTC',
    scanTimeZones: { codex: 'UTC' },
    workspace: {
      revision: 2,
      configuration: {
        charges: { claude: 0, codex: 1000 },
        contracts: { claude: {}, codex: {} },
        monthlyCharges: [],
        chargePeriods: [],
        unobservedRatio: 0,
      },
      planning: {
        version: 1,
        profile: {
          taxYear: 2026,
          journeyMode: 'retrospective',
          incomeCategory: 'undecided',
          filingType: 'undecided',
          monetizationStatus: 'planned',
          hasBookkeeping: false,
        },
        taxUnits: [],
        projectRules: [],
        lifecycleEvents: [],
        equipment: [],
        homeCosts: [],
        directCosts: [],
        decisions: [],
        evidence: [
          {
            id: 'e',
            evidenceType: 'receipt',
            strength: 'external',
            recordedAt: '2026-08-01T00:00:00Z',
            note: 'keep note',
            localReference: 'PRIVATE_EVIDENCE_PATH',
          },
        ],
      },
    },
    observations: [
      Object.assign(
        { ...row },
        { localReference: { sourcePath: 'PRIVATE_SOURCE_PATH' }, prompt: 'PRIVATE_PROMPT' },
      ),
    ],
    sources: [
      Object.assign(
        { sourceId: 'local-codex', provider: 'codex' as const, enabled: true },
        { root: 'PRIVATE_ROOT' },
      ),
    ],
    captures: [],
    costs: {
      version: 1,
      engineVersion: 'cost-projection/1',
      year: 2026,
      sources: [],
      bases: [],
      contributions: [],
      totals: {
        knownBasisJpy: 1000,
        taxUnitJpy: 0,
        generalJpy: 0,
        privateJpy: 0,
        unallocatedJpy: 1000,
        unobservedJpy: 0,
        roundingJpy: 0,
        unknownBasisIds: [],
      },
      byTaxUnit: [],
      invariantSatisfied: true,
    },
    originalFilesIncluded: false,
    taxTreatmentAdopted: false,
  }
}

function capture(): SourceCapture {
  return {
    sourceId: 'local-codex',
    provider: 'codex',
    checkedAt: '2026-08-01T00:00:00Z',
    timeZone: 'UTC',
    mode: 'incremental',
    status: 'complete',
    observationsHash: records.observationHash([row]),
    accountCoverage: 'unknown',
    files: [
      {
        fileKey: 'a'.repeat(64),
        state: 'read',
        eventCount: 1,
        adapter: 'codex',
        schemaVersion: '1',
        acceptedAt: '2026-08-01T00:00:00Z',
        observationRefs: [
          { sessionKey: row.sessionKey, projectKey: row.projectKey, month: row.month },
        ],
      },
    ],
  }
}

test('whitelists numerical data and retains explanatory notes, never original references', () => {
  const db = database()
  try {
    const saved = records.saveObservationRecord(db, fixture(), 'before-scan')
    assert.ok(saved)
    assert.ok(!JSON.stringify(saved).includes('PRIVATE_'))
    assert.equal(saved.payload.workspace.planning.evidence[0]!.note, 'keep note')
    assert.equal(saved.payload.costs.totals.knownBasisJpy, 1000)
    assert.equal(saved.payload.taxTreatmentAdopted, false)
  } finally {
    db.close()
  }
})

test('deduplicates unchanged states, but retains changed notes and numerical amounts', () => {
  const db = database()
  try {
    const input = fixture()
    records.saveObservationRecord(db, input, 'before-scan')
    assert.equal(records.saveObservationRecord(db, input, 'after-scan'), undefined)
    input.workspace.planning.evidence[0]!.note = 'changed'
    records.saveObservationRecord(db, input, 'before-scan')
    input.observations[0]!.inputTokens = 200
    records.saveObservationRecord(db, input, 'after-scan')
    assert.equal(records.listObservationRecords(db).records.length, 3)
  } finally {
    db.close()
  }
})

test('a new calendar does not rewrite the saved calendar or workspace', () => {
  const db = database()
  try {
    const input = fixture()
    const old = records.saveObservationRecord(db, input, 'before-scan')!
    input.timeZone = 'Asia/Tokyo'
    input.observations[0]!.month = '2026-08'
    const next = records.saveObservationRecord(db, input, 'after-scan')!
    assert.notEqual(old.id, next.id)
    assert.equal(
      records.readObservationRecord(db, old.id)!.payload.observations[0]!.month,
      '2026-07',
    )
    assert.equal(records.readObservationRecord(db, old.id)!.payload.timeZone, 'UTC')
  } finally {
    db.close()
  }
})

test('matches capture metadata to numerical values and removes nested extra fields', () => {
  const db = database()
  try {
    const input = Object.assign(capture(), { root: 'PRIVATE_ROOT' })
    Object.assign(input.files[0]!, { path: 'PRIVATE_PATH' })
    Object.assign(input.files[0]!.observationRefs![0]!, { prompt: 'PRIVATE_PROMPT' })
    records.saveSourceCapture(db, input)
    const got = records.checkedSourceCaptures(db, [row], [row])
    assert.equal(got[0]!.matchesCurrentValues, true)
    assert.ok(!JSON.stringify(got).includes('PRIVATE_'))
    assert.equal(
      records.checkedSourceCaptures(db, [row], [{ ...row, inputTokens: 101 }])[0]!
        .matchesCurrentValues,
      false,
    )
    assert.equal(got[0]!.accountCoverage, 'unknown')
  } finally {
    db.close()
  }
})

test('keeps previous-value deferral, initial missing files and unknown sources distinct', () => {
  const db = database()
  try {
    const input = fixture(),
      cap = capture()
    cap.files[0]!.state = 'deferred-previous'
    cap.files.push({
      ...cap.files[0]!,
      fileKey: 'b'.repeat(64),
      state: 'deferred-missing',
      eventCount: 0,
      acceptedAt: undefined,
      observationRefs: [],
    })
    input.captures = [{ ...cap, matchesCurrentValues: true }]
    input.sources.push({ sourceId: 'new', provider: 'claude', enabled: true })
    records.saveObservationRecord(db, input, 'before-scan')
    const got = records.listObservationRecords(db).records[0]!
    assert.equal(got.deferredPrevious, 1)
    assert.equal(got.deferredMissing, 1)
    assert.equal(got.incompleteSources, 1)
  } finally {
    db.close()
  }
})

test('cache reuse and checkedAt alone do not accumulate identical archives', () => {
  const db = database()
  try {
    const input = fixture()
    input.captures = [{ ...capture(), matchesCurrentValues: true }]
    records.saveObservationRecord(db, input, 'after-scan')
    input.captures[0]!.checkedAt = '2026-09-01T00:00:00Z'
    input.captures[0]!.files[0]!.state = 'reused'
    input.captures[0]!.files[0]!.acceptedAt = '2026-09-01T00:00:00Z'
    assert.equal(records.saveObservationRecord(db, input, 'after-scan'), undefined)
  } finally {
    db.close()
  }
})

test('does not skip verification of a corrupt duplicate record', () => {
  const db = database()
  try {
    const input = fixture(),
      saved = records.saveObservationRecord(db, input, 'before-scan')!
    db.prepare('UPDATE app_settings SET value=? WHERE key=?').run(
      '{bad',
      'observation-record:v1:' + saved.id,
    )
    assert.throws(() => records.readObservationRecord(db, saved.id))
    assert.throws(() => records.saveObservationRecord(db, input, 'before-scan'))
    const list = records.listObservationRecords(db)
    assert.equal(list.unreadable, 1)
    assert.equal(list.records.length, 0)
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key GLOB 'observation-record:v1:*'")
        .get()!.n,
      1,
    )
  } finally {
    db.close()
  }
})

test('paginates without silently discarding earlier history', () => {
  const db = database()
  try {
    for (let i = 0; i < 5; i++) {
      const input = fixture()
      input.workspace.revision = i
      records.saveObservationRecord(db, input, 'before-scan')
    }
    const a = records.listObservationRecords(db, 0, 2)
    const b = records.listObservationRecords(db, a.nextOffset!, 2)
    const c = records.listObservationRecords(db, b.nextOffset!, 2)
    assert.equal(
      new Set([...a.records, ...b.records, ...c.records].map((value) => value.id)).size,
      5,
    )
    assert.equal(c.nextOffset, undefined)
    for (const limit of [0, -1, 1000, NaN])
      assert.throws(() => records.listObservationRecords(db, 0, limit))
    assert.equal(records.readObservationRecord(db, '../invalid'), undefined)
  } finally {
    db.close()
  }
})

test('survives a closed DB, a SQLite backup and a second location without any annual adoption', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devtax-record-test-'))
  try {
    const db = database(join(dir, 'original.db'))
    const saved = records.saveObservationRecord(db, fixture(), 'before-scan')!
    db.prepare('VACUUM INTO ?').run(join(dir, 'backup.db'))
    db.close()
    rmSync(join(dir, 'original.db'))
    const restored = database(join(dir, 'backup.db'))
    try {
      const record = records.readObservationRecord(restored, saved.id)!
      assert.equal(record.payload.observations[0]!.inputTokens, 100)
      assert.equal(record.payload.workspace.revision, 2)
      assert.equal(record.payload.taxTreatmentAdopted, false)
    } finally {
      restored.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('does not manufacture observations, but can preserve an empty incomplete acquisition', () => {
  const db = database()
  try {
    const input = fixture()
    input.observations = []
    assert.equal(records.saveObservationRecord(db, input, 'after-scan'), undefined)
    const cap = capture()
    cap.status = 'failed'
    cap.observationsHash = records.observationHash([])
    cap.files = []
    input.captures = [{ ...cap, matchesCurrentValues: true }]
    const saved = records.saveObservationRecord(db, input, 'after-scan')!
    assert.equal(saved.payload.observations.length, 0)
    assert.equal(records.listObservationRecords(db).records[0]!.incompleteSources, 1)
  } finally {
    db.close()
  }
})

test('rolls back both the record and deduplication marker when storage fails', () => {
  const db = database()
  try {
    const input = fixture()
    records.saveObservationRecord(db, input, 'before-scan')
    const before = db.prepare('SELECT key, value FROM app_settings ORDER BY key').all()
    db.exec(`CREATE TRIGGER fail_marker BEFORE INSERT ON app_settings
      WHEN NEW.key='observation-record:last-state:v1' BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END`)
    input.workspace.revision++
    assert.throws(() => records.saveObservationRecord(db, input, 'before-scan'))
    assert.deepEqual(db.prepare('SELECT key, value FROM app_settings ORDER BY key').all(), before)
  } finally {
    db.close()
  }
})

test('invalid capture metadata never overwrites the last valid metadata', () => {
  const db = database()
  try {
    const cap = capture()
    records.saveSourceCapture(db, cap)
    cap.files[0]!.eventCount = -1
    assert.throws(() => records.saveSourceCapture(db, cap))
    assert.equal(records.readSourceCapture(db, row.sourceId, row.provider)!.files[0]!.eventCount, 1)
  } finally {
    db.close()
  }
})

test('reads the enabled source set and capture hashes from the same database', () => {
  const db = database()
  try {
    db.exec(`CREATE TABLE history_sources(id TEXT PRIMARY KEY, provider TEXT, enabled INTEGER);
      INSERT INTO history_sources VALUES('local-codex','codex',0),('new','claude',1)`)
    records.saveSourceCapture(db, capture())
    const context = records.readSourceCaptureContext(db, [row])
    assert.equal(context[0]!.enabled, false)
    assert.equal(context[0]!.capture!.matchesCurrentValues, true)
    assert.equal(context[1]!.capture, undefined)
  } finally {
    db.close()
  }
})

test('records invoice-specific capture warnings without inferring absent money', () => {
  const cap = capture()
  cap.files[0]!.state = 'deferred-previous'
  cap.files.push({
    ...cap.files[0]!,
    fileKey: 'b'.repeat(64),
    state: 'deferred-missing',
    eventCount: 0,
  })
  const context = [
    {
      sourceId: row.sourceId,
      provider: 'codex' as const,
      enabled: false,
      capture: { ...cap, matchesCurrentValues: true },
    },
  ]
  const warnings = captureWarnings(context, 'codex', [row.sourceId]).join('\n')
  assert.match(warnings, /前回値使用 1ファイル、初回取得保留 1ファイル/)
  assert.match(warnings, /欠落金額を推定していません/)
  assert.match(warnings, /停止中/)
  assert.deepEqual(captureWarnings(context, 'claude'), [])
  assert.match(captureWarnings(context, 'codex', ['missing']).join(), /見つかりません/)
  assert.match(captureWarnings(undefined, 'codex').join(), /来歴がありません/)
})

test('retains capture warnings in recorded Markdown as well as the stored JSON', () => {
  const db = database()
  try {
    const input = fixture(),
      cap = capture()
    cap.files[0]!.state = 'deferred-previous'
    input.captures = [{ ...cap, matchesCurrentValues: true }]
    input.costs.sources = [
      {
        id: 'invoice',
        kind: 'subscription',
        label: '合成請求',
        originalAmountJpy: 1000,
        currency: 'JPY',
        evidenceIds: [],
        origin: 'entered',
      },
    ]
    const warnings = captureWarnings(
      [{ ...input.sources[0]!, capture: input.captures[0] }],
      'codex',
    )
    input.costs.bases = [
      {
        id: 'basis',
        sourceId: 'invoice',
        parentContributionIds: [],
        affectedTaxUnitIds: [],
        period: { startedOn: '2026-07-01', endedOn: '2026-07-31' },
        amount: { status: 'known', amountJpy: 1000 },
        method: { id: 'fixture', version: '1', explanation: '合成配分' },
        warnings,
      },
    ]
    input.costs.contributions = [
      {
        id: 'contribution',
        basisId: 'basis',
        target: { kind: 'unallocated' },
        amountJpy: 1000,
        reason: '未判断',
        evidenceIds: [],
        sourceIds: ['invoice'],
      },
    ]
    const saved = records.saveObservationRecord(db, input, 'before-scan')!
    const markdown = costProjectionMarkdown(
      records.readObservationRecord(db, saved.id)!.payload.costs,
      'recorded',
    )
    assert.match(markdown, /前回値使用 1ファイル/)
    assert.match(markdown, /全利用の捕捉を保証しません/)
    assert.match(markdown, /1,000円/)
    assert.equal(
      saved.payload.captures[0]!.files[0]!.observationRefs![0]!.sessionKey,
      row.sessionKey,
    )
    assert.deepEqual(saved.payload.scanTimeZones, { codex: 'UTC' })
  } finally {
    db.close()
  }
})
