import type { ProjectClassification } from '../planning/types.js'

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

export type RuntimeData = {
  csrfToken: string
  providers: Record<ProviderKey, { detected: boolean }>
  privacy?: {
    localOnly: boolean
    promptBodiesExtracted: boolean
    telemetry: boolean
  }
}

export type LocalConfiguration = {
  charges: Record<ProviderKey, number>
  monthlyCharges: Array<{
    provider: ProviderKey
    month: string
    amountJpy: number
  }>
  unobservedRatio: number
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
  assignments: FolderAssignment[]
  unassignedSessionCount: number
}

export type SessionSummary = {
  provider: ProviderKey
  sessionKey: string
  month: string
  startedAt: string
  endedAt: string
  messageCount: number
  model: string | null
  weightedTokens: number
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
