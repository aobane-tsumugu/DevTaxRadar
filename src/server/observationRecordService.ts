import { getDatabase, getUsageSessions, getLastScanTimeZones } from './database.js'
import { readWorkspace } from './workspaceRepository.js'
import { datasetIdentity } from './datasetIdentity.js'
import { projectWorkspaceYears, readDashboardObservation } from './dashboard.js'
import { resolvedTimeZone } from '../adapters/localTime.js'
import type {
  FileCapture,
  ObservationRecord,
  SourceCapture,
} from '../accounting/observationRecord.js'
import {
  observationHash,
  readSourceCapture,
  saveObservationRecord,
  saveSourceCapture,
} from './observationRecords.js'

/** Called synchronously before replacing numerical observations or changing their source. */
export function archiveCurrentObservation(reason: ObservationRecord['reason']) {
  const db = getDatabase()
  return readWorkspace((workspace) => {
    const observation = readDashboardObservation(db)
    const contexts = observation.sourceCaptures ?? []
    const sources = contexts.map(({ sourceId, provider, enabled }) => ({
      sourceId,
      provider,
      enabled,
    }))
    const captures = contexts.flatMap(({ capture }) => (capture ? [capture] : []))
    if (!observation.sessions.length && !captures.length) return undefined
    const costs = projectWorkspaceYears(workspace, observation, [
      workspace.planning.profile.taxYear,
    ]).projections[0]!
    return saveObservationRecord(
      db,
      {
        version: 1,
        kind: 'numeric-observation',
        datasetId: datasetIdentity(db),
        timeZone: resolvedTimeZone(),
        scanTimeZones: observation.lastScanTimeZones,
        workspace,
        observations: observation.sessions,
        sources,
        captures,
        costs,
        originalFilesIncluded: false,
        taxTreatmentAdopted: false,
      },
      reason,
    )
  }, db)
}

/** A separate hash makes an interrupted metadata write visible, never falsely complete. */
export function recordSourceCapture(
  sourceId: string,
  provider: 'claude' | 'codex',
  mode: SourceCapture['mode'],
  status: SourceCapture['status'],
  files?: FileCapture[],
): void {
  const db = getDatabase()
  const previous = readSourceCapture(db, sourceId, provider)
  const key = sourceId === `local-${provider}` ? provider : `${sourceId}:${provider}`
  const timeZone =
    status === 'complete'
      ? resolvedTimeZone()
      : (previous?.timeZone ?? getLastScanTimeZones(db)[key] ?? 'unknown')
  saveSourceCapture(db, {
    sourceId,
    provider,
    mode,
    status,
    timeZone,
    checkedAt: new Date().toISOString(),
    files:
      files ??
      (previous?.files ?? []).map((file) => ({
        ...file,
        state: file.state === 'deferred-missing' ? 'deferred-missing' : 'deferred-previous',
      })),
    observationsHash: observationHash(
      getUsageSessions(db).filter((row) => row.sourceId === sourceId && row.provider === provider),
    ),
    accountCoverage: 'unknown',
  })
}
