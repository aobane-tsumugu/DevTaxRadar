import type { ProjectClassification } from '../planning/types.js'
import type { ProviderChargePeriod } from '../core/chargePeriods.js'

export type TaxGroup = 'current' | 'future' | 'review'

export type Allocation = {
  id: string
  month: string
  provider: 'Claude Code' | 'Codex'
  product: string
  asset: string
  stage: string
  usageRate: number
  amount: number
  group: TaxGroup
  taxCandidate: string
  confidence: 'A' | 'B' | 'C'
  rule: string
  reason: string
  missing: string
  projectKey?: string
  monthKey?: string
  classification?: ProjectClassification
  taxUnitId?: string
  session: {
    date: string
    id: string
    folder: string
    branch: string
    model: string
    tokens: number
    classification: string
    manualEdit: string
  }
}

export type DashboardData = {
  meta: {
    source: 'local' | 'demo'
    sessionCount: number
    lastSynced: string
    mappedRate: number
    classifiedRate: number
  }
  months: Array<{ label: string; current: number; future: number; review: number }>
  allocations: Allocation[]
  boundaries: Array<{
    product: string
    asset: string
    kind: string
    amount: number
    threshold: number
    thresholdLabel: string
    status: string
    tone: 'near' | 'review' | 'safe'
  }>
  assets: Array<{
    product: string
    name: string
    total: number
    aiCost: number
    outsource: number
    other: number
    futureBalance: number
    inService: boolean
  }>
  guidance: Array<{ title: string; description: string; severity: 'ok' | 'warning' }>
  products: Array<{
    name: string
    folder: string
    sessions: number
    projectKey?: string
    firstObservedAt?: string
    lastObservedAt?: string
    firstObservedMonth?: string
    lastObservedMonth?: string
    providers?: Array<'Claude Code' | 'Codex'>
  }>
}

export type ProviderKey = 'claude' | 'codex'
export type ScanMode = 'incremental' | 'full'

export type HistorySourceInput = {
  provider: ProviderKey
  name: string
  root: string
  enabled?: boolean
}

export type HistorySource = {
  id: string
  provider: ProviderKey
  kind: 'default' | 'configured'
  name: string
  /** Only render this in the explicit local history-source settings surface. */
  root: string
  enabled: boolean
  availability: 'available' | 'unavailable'
  lastScan: {
    status: 'never' | 'complete' | 'unavailable' | 'failed'
    completedAt?: string
    filesSeen?: number
    eventsWritten?: number
    reason?: 'not_found' | 'not_readable' | 'scan_failed'
  }
}

export type HistorySourceTestResult = {
  availability: 'available' | 'unavailable'
  filesDiscovered: number
  reason?: 'not_found' | 'not_readable'
}

export type ProviderRetention = {
  detected: boolean
  fileCount: number
  oldestModifiedOn?: string
  autoDelete:
    | { kind: 'configured'; days: number; source: 'explicit' | 'default' }
    | { kind: 'unreadable'; reason: string }
    | { kind: 'none' }
  nextLossOn?: string
  daysUntilNextLoss?: number
  alreadyLosing: boolean
}

export type RuntimeData = {
  csrfToken: string
  providers: Record<ProviderKey, { detected: boolean }>
  retention: Record<ProviderKey, ProviderRetention>
  privacy?: {
    localOnly: boolean
    promptBodiesPersisted: boolean
    localPromptPreviewOnDemand: boolean
    configuredPromptPreview: boolean
    telemetry: boolean
  }
}

export type ProviderContract = {
  startedOn?: string
  endedOn?: string
}

export type LocalConfiguration = {
  charges: Record<ProviderKey, number>
  monthlyCharges: Array<{
    provider: ProviderKey
    month: string
    amountJpy: number
  }>
  contracts: Record<ProviderKey, ProviderContract>
  chargePeriods: ProviderChargePeriod[]
  unobservedRatio: number
}

export type ScanProgress = {
  running: boolean
  startupPending?: boolean
  provider: ProviderKey | null
  filesScanned: number
  sourceId?: string
  sourceName?: string
}

export type ScanResult = {
  completedAt: string
  providers: Partial<
    Record<
      ProviderKey,
      {
        events: number
        diagnostics?: Record<string, unknown>
      }
    >
  >
  sources?: Array<{
    sourceId: string
    sourceName: string
    provider: ProviderKey
    status: 'complete' | 'unavailable' | 'failed'
    events: number
    diagnostics?: Record<string, number>
  }>
}

export type FolderAssignment = {
  ruleId: string
  taxUnitId?: string
  taxUnitName?: string
  classification: ProjectClassification
  effectiveFrom: string
  effectiveTo?: string
  provider?: ProviderKey
  sessionCount: number
}

export type FolderSummary = {
  projectKey: string
  label: string
  sessionCount: number
  messageCount: number
  firstUsedOn: string
  lastUsedOn: string
  providers: ProviderKey[]
  sources: Array<{ id: string; name: string }>
  assignments: FolderAssignment[]
  unassignedSessionCount: number
}

export type SessionSummary = {
  sourceId: string
  sourceName: string
  provider: ProviderKey
  sessionKey: string
  month: string
  startedAt: string
  endedAt: string
  messageCount: number
  model: string | null
  weightedTokens: number
  localDetailAvailable: boolean
}

export type SessionDetail = {
  available: boolean
  transcriptExists?: boolean
  preview?: string
  resume?: {
    command: string
    changeDirectory?: string
    resume: string
    workingDirectoryExists: boolean
    changeDirectoryOmittedReason?: 'not-found' | 'unquotable-path'
  }
}
