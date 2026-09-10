import type { SourceCaptureContext } from './observationRecord.js'
import type { LocalConfiguration } from '../client/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import type { AnnualCostProjection } from './costs.js'
import type { BalanceReferenceCheck } from '../core/balanceReferences.js'
import type { BalanceCostProvenance } from '../core/balanceCostProvenance.js'
import type { CostPresenceStatus } from '../planning/costPresence.js'
import type { EquipmentAnnualCalculation } from '../core/equipmentAnnualCalculation.js'
import type { EquipmentCarryCheck } from '../core/equipmentCarryCheck.js'
import type { BalanceFlowCheck } from '../core/balanceFlowLinks.js'
import type { BalanceLotTrace } from '../core/balanceLotTrace.js'

/** Fixed calculation inputs and outputs. Original evidence locations remain in the private workspace. */
export type ReviewMaterials = {
  schemaVersion: 1
  engineVersion: 'review-materials/1'
  year: number
  workspaceRevision: number
  timeZone: string
  configuration: LocalConfiguration
  planning: Omit<PlanningSnapshot, 'evidence'> & {
    evidence: Array<Omit<PlanningSnapshot['evidence'][number], 'localReference'>>
  }
  observations: Array<{
    observationId: string
    sourceRef: string
    provider: 'claude' | 'codex'
    projectKey: string
    month: string
    startedAt: string
    endedAt: string
    messageCount: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }>
  /** Absent in older saved materials; never reconstructed from current capture state. */
  sourceCaptures?: SourceCaptureContext[]
  scanTimeZones: Record<string, string>
  /** Latest ten scans from the current observation reader; not a complete source audit history. */
  recentScans: Array<{
    sourceRef: string | null
    provider: 'claude' | 'codex' | 'unknown'
    startedAt: string | null
    completedAt: string | null
    filesSeen: number | null
    eventsWritten: number | null
    malformedLines: number | null
    status: 'running' | 'complete' | 'failed' | 'unknown'
  }>
  costs: AnnualCostProjection
  referenceCheck: BalanceReferenceCheck
  /** Absent on older frozen records; never synthesize this from current costs when reading them. */
  costLinks?: { costs: AnnualCostProjection[]; check: BalanceCostProvenance }
  balanceFlowCheck?: BalanceFlowCheck
  balanceLotTrace?: BalanceLotTrace
  openingLotCarry?: import('../core/openingLotCarry.js').OpeningLotCarry
  taxTreatmentVerified: false
  /** Whole-asset scenario arithmetic; absent in older records, never reconstructed on read. */
  equipmentCalculations?: EquipmentAnnualCalculation[]
  equipmentCarryCheck?: EquipmentCarryCheck
  /** Absent in legacy records and outside the supported planning year range. */
  costPresenceCheck?: {
    engineVersion: 'cost-presence/1'
    year: number
    items: CostPresenceStatus[]
  }
}
