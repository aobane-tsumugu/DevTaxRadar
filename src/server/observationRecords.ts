import { retainedCaptureCounts } from '../core/captureProvenance.js'
import { collapseObservations } from '../core/usageGranularity.js'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CheckedSourceCapture,
  ObservationRecord,
  ObservationRecordPayload,
  ObservationRecordSummary,
  RecordedObservation,
  SourceCapture,
} from '../accounting/observationRecord.js'

const recordPrefix = 'observation-record:v1:'
const capturePrefix = 'source-capture:v1:'
const lastStateKey = 'observation-record:last-state:v1'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const object = value as Record<string, unknown>
  return (
    '{' +
    Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(object[key]))
      .join(',') +
    '}'
  )
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** Explicit projection: native IDs, roots, paths and prompt bodies cannot be copied. */
export function numericalObservations(rows: readonly RecordedObservation[]): RecordedObservation[] {
  return rows
    .map((row) => ({
      sourceId: row.sourceId,
      provider: row.provider,
      sessionKey: row.sessionKey,
      projectKey: row.projectKey,
      month: row.month,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      messageCount: row.messageCount,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      ...(row.timePrecision ? { timePrecision: row.timePrecision } : {}),
      ...(row.eventRef ? { eventRef: row.eventRef } : {}),
    }))
    .map((row) => ({ row, order: canonical(row) }))
    .sort((a, b) => a.order.localeCompare(b.order))
    .map(({ row }) => row)
}

export function observationHash(rows: readonly RecordedObservation[]): string {
  return digest(collapseObservations(rows))
}

function captureKey(sourceId: string, provider: string): string {
  return capturePrefix + digest([sourceId, provider])
}

function cleanCapture(input: SourceCapture): SourceCapture {
  if (
    !input ||
    !['claude', 'codex'].includes(input.provider) ||
    typeof input.sourceId !== 'string' ||
    typeof input.checkedAt !== 'string' ||
    typeof input.timeZone !== 'string' ||
    !['incremental', 'full'].includes(input.mode) ||
    !['complete', 'unavailable', 'failed'].includes(input.status) ||
    !/^[a-f0-9]{64}$/.test(input.observationsHash) ||
    !Array.isArray(input.files)
  )
    throw new Error('取得来歴の形式を確認してください。')
  return {
    sourceId: input.sourceId,
    provider: input.provider,
    checkedAt: input.checkedAt,
    timeZone: input.timeZone,
    mode: input.mode,
    status: input.status,
    observationsHash: input.observationsHash,
    accountCoverage: 'unknown',
    files: input.files
      .map((file) => {
        if (
          !file ||
          !/^[a-f0-9]{64}$/.test(file.fileKey) ||
          ![
            'read',
            'reused',
            'deferred-previous',
            'deferred-missing',
            'missing-retained',
            'unverified-retained',
          ].includes(file.state) ||
          typeof file.adapter !== 'string' ||
          typeof file.schemaVersion !== 'string' ||
          !Number.isSafeInteger(file.eventCount) ||
          file.eventCount < 0 ||
          (file.acceptedAt !== undefined && typeof file.acceptedAt !== 'string')
        )
          throw new Error('ファイル取得来歴の形式を確認してください。')
        if (
          file.observationRefs !== undefined &&
          (!Array.isArray(file.observationRefs) ||
            file.observationRefs.some(
              (ref) =>
                !ref ||
                typeof ref.sessionKey !== 'string' ||
                typeof ref.projectKey !== 'string' ||
                !/^\d{4}-(0[1-9]|1[0-2])$/.test(ref.month),
            ))
        )
          throw new Error('取得値とファイル来歴の対応を確認してください。')
        return {
          fileKey: file.fileKey,
          state: file.state,
          adapter: file.adapter,
          schemaVersion: file.schemaVersion,
          eventCount: file.eventCount,
          ...(file.observationRefs === undefined
            ? {}
            : {
                observationRefs: file.observationRefs.map(({ sessionKey, projectKey, month }) => ({
                  sessionKey,
                  projectKey,
                  month,
                })),
              }),
          ...(file.acceptedAt === undefined ? {} : { acceptedAt: file.acceptedAt }),
        }
      })
      .sort((a, b) => a.fileKey.localeCompare(b.fileKey)),
  }
}

export function saveSourceCapture(db: DatabaseSync, capture: SourceCapture): void {
  const record = cleanCapture(capture)
  db.prepare(
    `INSERT INTO app_settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(captureKey(record.sourceId, record.provider), JSON.stringify(record))
}

export function readSourceCapture(
  db: DatabaseSync,
  sourceId: string,
  provider: string,
): SourceCapture | undefined {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(captureKey(sourceId, provider)) as { value: string } | undefined
  if (!row) return undefined
  try {
    const record = cleanCapture(JSON.parse(row.value) as SourceCapture)
    return record.sourceId === sourceId && record.provider === provider ? record : undefined
  } catch {
    return undefined
  }
}

export function checkedSourceCaptures(
  db: DatabaseSync,
  sources: readonly { sourceId: string; provider: string }[],
  observations: readonly RecordedObservation[],
): CheckedSourceCapture[] {
  return sources.flatMap((source) => {
    const record = readSourceCapture(db, source.sourceId, source.provider)
    if (!record) return []
    const current = observations.filter(
      (row) => row.sourceId === source.sourceId && row.provider === source.provider,
    )
    return [
      { ...record, matchesCurrentValues: record.observationsHash === observationHash(current) },
    ]
  })
}

function sanitizedPayload(input: ObservationRecordPayload): ObservationRecordPayload {
  const workspace = structuredClone(input.workspace)
  workspace.planning.evidence = workspace.planning.evidence.map(
    ({ localReference: _private, ...record }) => record,
  )
  return {
    version: 1,
    kind: 'numeric-observation',
    datasetId: input.datasetId,
    timeZone: input.timeZone,
    scanTimeZones: { ...input.scanTimeZones },
    workspace,
    observations: numericalObservations(input.observations),
    sources: input.sources
      .map(({ sourceId, provider, enabled }) => ({ sourceId, provider, enabled }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.provider.localeCompare(b.provider)),
    captures: input.captures
      .map((capture) => ({
        ...cleanCapture(capture),
        matchesCurrentValues: capture.matchesCurrentValues,
      }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.provider.localeCompare(b.provider)),
    costs: structuredClone(input.costs),
    originalFilesIncluded: false,
    taxTreatmentAdopted: false,
  }
}

/** Reuses the existing typed app_settings store; no new schema, daemon or approval state. */
export function saveObservationRecord(
  db: DatabaseSync,
  input: ObservationRecordPayload,
  reason: ObservationRecord['reason'],
): ObservationRecord | undefined {
  if (!input.observations.length && !input.captures.length) return undefined
  const payload = sanitizedPayload(input)
  const state = digest({
    ...payload,
    captures: payload.captures.map(({ checkedAt: _checkedAt, files, ...record }) => ({
      ...record,
      files: files.map(({ state, acceptedAt: _acceptedAt, ...file }) => ({
        ...file,
        state: state === 'read' ? 'reused' : state,
      })),
    })),
  })
  const previous = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(lastStateKey) as
    { value: string } | undefined
  if (previous) {
    const last = JSON.parse(previous.value) as { state: string; id: string }
    if (last.state === state) {
      if (!readObservationRecord(db, last.id))
        throw new Error('前回の数値記録が見つかりません。再走査前に保存状態を確認してください。')
      return undefined
    }
  }
  const id = digest(payload)
  const record: ObservationRecord = { id, createdAt: new Date().toISOString(), reason, payload }
  db.exec('SAVEPOINT devtax_observation_record')
  try {
    db.prepare('INSERT OR IGNORE INTO app_settings(key, value) VALUES (?, ?)').run(
      recordPrefix + id,
      JSON.stringify(record),
    )
    readObservationRecord(db, id)
    db.prepare(
      `INSERT INTO app_settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(lastStateKey, JSON.stringify({ state, id }))
    db.exec('RELEASE devtax_observation_record')
  } catch (error) {
    db.exec('ROLLBACK TO devtax_observation_record')
    db.exec('RELEASE devtax_observation_record')
    throw error
  }
  return readObservationRecord(db, id)
}

export function readObservationRecord(db: DatabaseSync, id: string): ObservationRecord | undefined {
  if (!/^[a-f0-9]{64}$/.test(id)) return undefined
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(recordPrefix + id) as
    { value: string } | undefined
  if (!row) return undefined
  const record = JSON.parse(row.value) as ObservationRecord
  if (
    record.id !== id ||
    record.payload?.version !== 1 ||
    record.payload.kind !== 'numeric-observation' ||
    digest(record.payload) !== id
  )
    throw new Error('保存した数値記録を検証できません。記録は削除していません。')
  return record
}

export function listObservationRecords(
  db: DatabaseSync,
  offset = 0,
  limit = 50,
): {
  records: ObservationRecordSummary[]
  unreadable: number
  nextOffset?: number
} {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new RangeError('数値記録の取得範囲を確認してください。')
  const rows = db
    .prepare(
      `SELECT key FROM app_settings WHERE key GLOB ?
    ORDER BY CASE WHEN json_valid(value) THEN json_extract(value, '$.createdAt') END DESC, key DESC LIMIT ? OFFSET ?`,
    )
    .all(recordPrefix + '*', limit + 1, offset) as Array<{ key: string }>
  const records: ObservationRecordSummary[] = []
  let unreadable = 0
  for (const row of rows.slice(0, limit)) {
    try {
      const record = readObservationRecord(db, row.key.slice(recordPrefix.length))!
      const captures = record.payload.captures
      const retained = captures.map((capture) => retainedCaptureCounts(capture.files))
      records.push({
        id: record.id,
        createdAt: record.createdAt,
        reason: record.reason,
        year: record.payload.costs.year,
        workspaceRevision: record.payload.workspace.revision,
        observationCount: record.payload.observations.length,
        deferredPrevious: captures
          .flatMap((capture) => capture.files)
          .filter((file) => file.state === 'deferred-previous').length,
        deferredMissing: captures
          .flatMap((capture) => capture.files)
          .filter((file) => file.state === 'deferred-missing').length,
        missingRetained: retained.reduce((sum, counts) => sum + counts.missingRetained, 0),
        unverifiedRetained: retained.reduce((sum, counts) => sum + counts.unverifiedRetained, 0),
        incompleteSources: record.payload.sources.filter((source) => {
          const capture = captures.find(
            (row) => row.sourceId === source.sourceId && row.provider === source.provider,
          )
          return (
            !capture ||
            !capture.matchesCurrentValues ||
            capture.status !== 'complete' ||
            capture.files.some(
              (file) =>
                (file.state === 'missing-retained' && file.eventCount > 0) ||
                file.state === 'unverified-retained',
            )
          )
        }).length,
      })
    } catch {
      unreadable++
    }
  }
  return { records, unreadable, ...(rows.length > limit ? { nextOffset: offset + limit } : {}) }
}

/** Called under the same SQLite read snapshot as the observations. */
export function readSourceCaptureContext(
  db: DatabaseSync,
  observations: readonly RecordedObservation[],
) {
  const sources = (
    db
      .prepare('SELECT id AS sourceId, provider, enabled FROM history_sources ORDER BY id')
      .all() as Array<{ sourceId: string; provider: 'claude' | 'codex'; enabled: number }>
  ).map((source) => ({ ...source, enabled: source.enabled === 1 }))
  const checked = checkedSourceCaptures(db, sources, observations)
  return sources.map((source) => ({
    ...source,
    capture: checked.find(
      (row) => row.sourceId === source.sourceId && row.provider === source.provider,
    ),
  }))
}

export function sanitizedCaptureContext(
  input: readonly import('../accounting/observationRecord.js').SourceCaptureContext[],
) {
  return input.map(({ sourceId, provider, enabled, capture }) => ({
    sourceId,
    provider,
    enabled,
    ...(capture
      ? {
          capture: { ...cleanCapture(capture), matchesCurrentValues: capture.matchesCurrentValues },
        }
      : {}),
  }))
}
