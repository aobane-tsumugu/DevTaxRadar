import type { LocalConfiguration, DashboardData } from '../client/types.js'
import type { PlanningSnapshot, Diagnosis } from './types.js'
import type { AnnualCostProjection } from '../accounting/costs.js'

export type WorkspaceDraft = {
  revision: number
  configuration: LocalConfiguration
  planning: PlanningSnapshot
}

export type WorkspaceView = WorkspaceDraft & {
  dashboard: DashboardData
  diagnosis: Diagnosis
}

export type WorkspaceSave = {
  expectedRevision: number
  requestId: string
  configuration: LocalConfiguration
  planning: PlanningSnapshot
  previewHash?: string
}

export type WorkspacePreviewInput = Omit<WorkspaceSave, 'requestId' | 'previewHash'>
export type WorkspaceImpact = {
  engineVersion: 'workspace-impact/1'
  expectedRevision: number
  previewHash: string
  scope: { fromYear: number; toYear: number; description: string }
  records: Array<{ key: string; label: string; operation: 'added' | 'removed' | 'changed' }>
  assignmentChanges: Array<{
    provider: string
    month: string
    count: number
    before: { classification: string; taxUnitId: string | null; ruleId: string | null }
    after: { classification: string; taxUnitId: string | null; ruleId: string | null }
  }>
  years: Array<{
    year: number
    changed: boolean
    before: AnnualCostProjection
    after: AnnualCostProjection
    aiBefore: { current: number; future: number; review: number }
    aiAfter: { current: number; future: number; review: number }
  }>
  limitations: string[]
}
