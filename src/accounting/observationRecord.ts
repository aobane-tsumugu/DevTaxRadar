import type { AnnualCostProjection } from './costs.js'
import type { WorkspaceDraft } from '../planning/workspace.js'

/** Numerical evidence only. These records are not adopted tax treatment. */
export type RecordedObservation = {
  sourceId: string
  provider: 'claude' | 'codex'
  sessionKey: string
  projectKey: string
  month: string
  startedAt: string
  endedAt: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  timePrecision?: 'instant' | 'interval' | 'unknown'
  eventRef?: string
}

export type FileCapture = {
  fileKey: string
  state:
    | 'read'
    | 'reused'
    | 'deferred-previous'
    | 'deferred-missing'
    /** Absent in the last completed walk; imported numerical contribution is retained. */
    | 'missing-retained'
    /** Retained summary has no usable file-cache correspondence; absence is unproven. */
    | 'unverified-retained'
  adapter: string
  schemaVersion: string
  eventCount: number
  observationRefs?: Array<{ sessionKey: string; projectKey: string; month: string }>
  acceptedAt?: string
}

export type SourceCapture = {
  sourceId: string
  provider: 'claude' | 'codex'
  checkedAt: string
  timeZone: string
  mode: 'incremental' | 'full'
  /** Walk status only; retained and deferred files are not freshly verified. */
  status: 'complete' | 'unavailable' | 'failed'
  observationsHash: string
  files: FileCapture[]
  /** A completed walk cannot prove that the account's complete usage was captured. */
  accountCoverage: 'unknown'
}

export type CheckedSourceCapture = SourceCapture & { matchesCurrentValues: boolean }

export type ObservationRecordPayload = {
  version: 1
  kind: 'numeric-observation'
  datasetId: string
  timeZone: string
  /** Original scan calendars may differ from the current calculation calendar. */
  scanTimeZones: Record<string, string>
  workspace: WorkspaceDraft
  observations: RecordedObservation[]
  sources: Array<{ sourceId: string; provider: 'claude' | 'codex'; enabled: boolean }>
  captures: CheckedSourceCapture[]
  costs: AnnualCostProjection
  originalFilesIncluded: false
  taxTreatmentAdopted: false
}

export type ObservationRecord = {
  id: string
  createdAt: string
  reason: 'before-scan' | 'after-scan' | 'before-source-change'
  payload: ObservationRecordPayload
}

export type ObservationRecordSummary = {
  id: string
  createdAt: string
  reason: ObservationRecord['reason']
  year: number
  workspaceRevision: number
  observationCount: number
  deferredPrevious: number
  deferredMissing: number
  /** Retained absent-file contributions; optional for older API responses. */
  missingRetained?: number
  /** Unique sessions without usable file-cache correspondence. */
  unverifiedRetained?: number
  incompleteSources: number
}

export type SourceCaptureContext = {
  sourceId: string
  provider: 'claude' | 'codex'
  enabled: boolean
  capture?: CheckedSourceCapture
}
