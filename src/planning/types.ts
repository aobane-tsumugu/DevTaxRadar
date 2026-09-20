import type { CostTreatmentFacts } from '../core/costTreatmentFacts.js'
import type { SourceAdjustmentRecord } from '../core/sourceAdjustments.js'
import type { AllocationTarget } from './allocationTargets.js'
import type { CostPresenceRecord } from './costPresence.js'
import type { EquipmentAnnualMethod } from './equipmentMethods.js'
export type JourneyMode = 'early' | 'retrospective'
export type IncomeCategory = 'undecided' | 'miscellaneous' | 'business'
export type FilingType = 'undecided' | 'white' | 'blue'
export type MonetizationStatus = 'none' | 'planned' | 'earning'
export type PlanningProfile = {
  taxYear: number
  journeyMode: JourneyMode
  incomeCategory: IncomeCategory
  filingType: FilingType
  activityStartedOn?: string
  monetizationStatus: MonetizationStatus
  hasBookkeeping: boolean
  notes?: string
}
export type UsageMode = 'internal' | 'external' | 'mixed' | 'undecided'
export type RevenueModel = 'sales' | 'subscription' | 'advertising' | 'affiliate' | 'efficiency' | 'oss' | 'other' | 'undecided'
export type TaxUnitType = 'new-software' | 'improvement-plan' | 'sales-production'
export type LifecycleStatus = 'idea' | 'prototype' | 'developing' | 'evaluating' | 'in-use' | 'maintaining' | 'improving' | 'retired' | 'abandoned'
export type TaxUnitRecord = {
  id: string
  name: string
  unitType: TaxUnitType
  usageMode: UsageMode
  revenueModel: RevenueModel
  lifecycleStatus: LifecycleStatus
  journeyMode?: JourneyMode
  monetizationStatus?: MonetizationStatus
  completionCriteria?: string
  predecessorId?: string
  sameAsExternalVersion?: 'yes' | 'no' | 'undecided'
  notes?: string
}
export type ProjectClassification = 'new-development' | 'maintenance' | 'feature-addition' | 'general-learning' | 'private' | 'unclassified'
export type ProjectRuleRecord = {
  id: string
  projectKey: string
  provider?: 'claude' | 'codex'
  effectiveFrom: string
  effectiveTo?: string
  taxUnitId?: string
  classification: ProjectClassification
  reason?: string
}
export type LifecycleEventType = 'development-started' | 'evaluation-started' | 'internal-use-started' | 'external-released' | 'first-sale' | 'improvement-started' | 'retired' | 'abandoned'
export type LifecycleEventRecord = {
  id: string
  taxUnitId: string
  eventType: LifecycleEventType
  occurredOn: string
  recordedAt: string
  evidenceIds: string[]
  note?: string
}
export type EquipmentType = 'pc' | 'gpu' | 'dgx' | 'server' | 'desk' | 'peripheral' | 'other'
export type EquipmentRecord = {
  id: string
  name: string
  equipmentType: EquipmentType
  acquisitionCostJpy: number | null
  unknownAmountReason?: string
  orderedOn?: string
  deliveredOn?: string
  acquiredOn: string
  businessUseStartedOn?: string
  convertedFromPrivate: boolean
  openingUnamortizedBalanceJpy?: number
  businessUseRatio: number
  usefulLifeYears?: number
  role: string
  taxUnitId?: string
  projectAllocationRatio: number
  evidenceIds: string[]
}
export type HomeCostCategory = 'rent' | 'electricity' | 'internet'
export type HomeCostMethod = 'area' | 'area-time' | 'meter' | 'watt-hour' | 'usage-time' | 'fixed-ratio'
export type CostTreatment = 'direct' | 'shared' | 'general'
export type HomeCostRecord = {
  id: string
  month: string
  targets?: AllocationTarget[]
  category: HomeCostCategory
  amountJpy: number | null
  unknownAmountReason?: string
  method: HomeCostMethod
  businessUseRatio: number
  basis: string
  rationale: string
  taxUnitId?: string
  projectAllocationRatio: number
  treatment: CostTreatment
  evidenceIds: string[]
}
export type DirectCostType = 'outsource' | 'material' | 'cloud' | 'domain' | 'license' | 'old-version-balance' | 'other'
export type DirectCostRecord = {
  id: string
  targets?: AllocationTarget[]
  taxUnitId?: string
  incurredOn: string
  costType: DirectCostType
  amountJpy: number | null
  unknownAmountReason?: string
  directlyAttributable: boolean
  treatment: CostTreatment
  note?: string
  evidenceIds: string[]
}
export type EvidenceStrength = 'automatic' | 'external' | 'self-recorded'
export type EvidenceType = 'deployment' | 'sale-page' | 'store-release' | 'first-use' | 'file' | 'screenshot' | 'receipt' | 'card-statement' | 'memo' | 'ai-session' | 'other'
export type EvidenceRecord = {
  id: string
  evidenceType: EvidenceType
  strength: EvidenceStrength
  occurredOn?: string
  recordedAt: string
  localReference?: string
  note: string
  taxUnitId?: string
}
export type DecisionRecord = {
  treatmentBinding?: import('../core/treatmentDecisionBinding.js').TreatmentDecisionBinding
  softwareAnnualBinding?: import('../core/softwareAnnualDecision.js').SoftwareAnnualDecisionBinding
  id: string
  taxUnitId: string
  taxYear: number
  engineVersion: string
  candidate: string
  status: 'pending' | 'confirmed' | 'overridden'
  selectedCandidate?: string
  reason?: string
  createdAt: string
  confirmedAt?: string
}
export type PlanningSnapshot = {
  costTreatmentFacts?: CostTreatmentFacts[]
  sourceAdjustments?: SourceAdjustmentRecord[]
  costPresence?: CostPresenceRecord[]
  equipmentMethods?: EquipmentAnnualMethod[]
  version: 1
  profile: PlanningProfile
  taxUnits: TaxUnitRecord[]
  projectRules: ProjectRuleRecord[]
  lifecycleEvents: LifecycleEventRecord[]
  equipment: EquipmentRecord[]
  homeCosts: HomeCostRecord[]
  directCosts: DirectCostRecord[]
  evidence: EvidenceRecord[]
  decisions: DecisionRecord[]
}
export type ActionItem = {
  id: string
  priority: 'high' | 'medium' | 'low'
  title: string
  reason: string
  trigger: 'now' | 'event'
  taxUnitId?: string
}
export type Diagnosis = {
  currentPosition: string[]
  immediateActions: ActionItem[]
  eventTriggeredActions: ActionItem[]
  missingFacts: string[]
}
export function emptyPlanningSnapshot(taxYear = new Date().getFullYear()): PlanningSnapshot {
  return {
    version: 1,
    profile: { taxYear, journeyMode: 'early', incomeCategory: 'undecided', filingType: 'undecided', monetizationStatus: 'planned', hasBookkeeping: false },
    taxUnits: [], projectRules: [], lifecycleEvents: [], equipment: [], homeCosts: [], directCosts: [], evidence: [], decisions: [],
  }
}
