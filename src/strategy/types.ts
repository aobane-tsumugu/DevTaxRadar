export const STRATEGY_WORK_PURPOSES = [
  'build-before-use',
  'service-operation',
  'repair-existing',
  'improve-existing',
  'direct-production',
  'business-preparation',
  'sales-promotion',
  'general-learning',
  'private',
  'unclassified',
] as const

export type StrategyWorkPurpose = (typeof STRATEGY_WORK_PURPOSES)[number]

export const COST_OBJECT_KINDS = [
  'reusable-system',
  'saleable-output',
  'business-common',
  'unclassified',
] as const
export type CostObjectKind = (typeof COST_OBJECT_KINDS)[number]

export const BUSINESS_DOMAINS = [
  'saas-web',
  'software',
  'publishing',
  'digital-content',
  'media-advertising',
  'client-services',
  'common',
  'other',
] as const
export type BusinessDomain = (typeof BUSINESS_DOMAINS)[number]

export const TAX_CONTEXT_KINDS = [
  'individual-miscellaneous',
  'individual-business-white',
  'individual-business-blue',
  'corporation',
] as const
export type TaxContextKind = (typeof TAX_CONTEXT_KINDS)[number]

export type TaxContextRecord = {
  id: string
  name: string
  kind: TaxContextKind
  effectiveFrom: string
  effectiveTo?: string
  fiscalYearStartMonth: number
  legalName?: string
  note?: string
}

export type CostObjectMetadataRecord = {
  taxUnitId: string
  costObjectKind: CostObjectKind
  businessDomain: BusinessDomain
  ownerContextId?: string
  accountingTag?: string
  sourceSystemTaxUnitIds: string[]
  note?: string
}

export type StrategyAssignmentRule = {
  id: string
  projectKey: string
  provider?: 'claude' | 'codex'
  effectiveFrom: string
  effectiveTo?: string
  taxUnitId?: string
  workPurpose: StrategyWorkPurpose
  reason?: string
  createdAt: string
}

export type StrategySessionOverride = {
  id: string
  sourceId: string
  provider: 'claude' | 'codex'
  sessionKey: string
  taxUnitId?: string
  workPurpose: StrategyWorkPurpose
  reason?: string
  createdAt: string
}

export type ManualAiCostRecord = {
  id: string
  serviceName: string
  periodFrom: string
  periodTo: string
  amountJpy: number
  taxUnitId?: string
  workPurpose: StrategyWorkPurpose
  ownerContextId?: string
  accountingTag?: string
  evidenceReference?: string
  note?: string
}

export type ChargeContextRecord = {
  id: string
  provider: 'claude' | 'codex'
  chargePeriodId?: string
  month?: string
  payerContextId: string
  accountingTag?: string
}

export type StrategyState = {
  version: 1
  taxContexts: TaxContextRecord[]
  costObjects: CostObjectMetadataRecord[]
  assignmentRules: StrategyAssignmentRule[]
  sessionOverrides: StrategySessionOverride[]
  manualAiCosts: ManualAiCostRecord[]
  chargeContexts: ChargeContextRecord[]
}

export type StrategyAuditRecord = {
  id: number
  entityType: string
  entityId: string
  action: 'created' | 'updated' | 'deleted' | 'exported'
  occurredAt: string
  beforeJson?: string
  afterJson?: string
  note?: string
}

export type StrategyEvidenceExportRecord = {
  id: string
  format: 'json' | 'csv' | 'markdown'
  generatedAt: string
  sha256: string
  byteLength: number
  fileName: string
  taxContextId?: string
}

export type StrategyAllocationSource =
  'automatic' | 'manual' | 'unobserved' | 'rounding' | 'contract-excluded'

export type StrategyTaxGroup = 'current' | 'future' | 'review'

export type StrategySessionReference = {
  sourceId: string
  provider: 'claude' | 'codex'
  sessionKey: string
}

export type StrategyAllocation = {
  id: string
  source: StrategyAllocationSource
  month: string
  provider: string
  product: string
  taxUnitId?: string
  projectKey?: string
  workPurpose: StrategyWorkPurpose
  workPurposeLabel: string
  amountJpy: number
  group: StrategyTaxGroup
  taxCandidate: string
  reasons: string[]
  missingFacts: string[]
  ownerContextId?: string
  payerContextId?: string
  accountingTag?: string
  businessDomain?: BusinessDomain
  costObjectKind?: CostObjectKind
  sessionCount: number
  messageCount: number
  sessionRefs?: StrategySessionReference[]
}

export type StrategyDashboard = {
  meta: {
    sessionCount: number
    classifiedSessionCount: number
    unclassifiedSessionCount: number
    strategyRuleCount: number
    sessionOverrideCount: number
    manualCostCount: number
    taxContextCount: number
    lastSynced: string
  }
  months: Array<{
    month: string
    current: number
    future: number
    review: number
  }>
  allocations: StrategyAllocation[]
  costObjectTotals: Array<{
    taxUnitId?: string
    name: string
    current: number
    future: number
    review: number
    total: number
  }>
  contextTotals: Array<{
    contextId?: string
    name: string
    current: number
    future: number
    review: number
    total: number
  }>
  guidance: Array<{
    level: 'info' | 'warning'
    title: string
    description: string
  }>
}

export function emptyStrategyState(): StrategyState {
  return {
    version: 1,
    taxContexts: [],
    costObjects: [],
    assignmentRules: [],
    sessionOverrides: [],
    manualAiCosts: [],
    chargeContexts: [],
  }
}
