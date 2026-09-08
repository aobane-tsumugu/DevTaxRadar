import type { AnnualBalanceProjection, BalanceSnapshot } from './types.js'
import type { BalanceReferenceCheck } from '../core/balanceReferences.js'
import type { ReviewMaterials } from './reviewMaterials.js'

export type BalanceDraft = {
  costDescriptions?: {
    workspaceRevision: number
    items: import('../core/costLotLabel.js').CostLotDescription[]
  }
  datasetId?: string
  revision: number
  snapshot: BalanceSnapshot
  referenceCheck?: BalanceReferenceCheck & { workspaceRevision: number }
}
export type BalancePreview = {
  snapshot?: BalanceSnapshot
  materials?: ReviewMaterials
  referenceCheck?: BalanceReferenceCheck & { workspaceRevision: number }
  draftRevision: number
  currentReviewId: string | null
  previousReviewId: string | null
  previousReviewChainChanged?: boolean
  previousReviewChanges?: Array<{
    year: number
    referencingYear: number
    storedReviewId: string | null
    currentReviewId: string | null
  }>
  projectionHash: string
  projection: AnnualBalanceProjection
}
export type BalanceReview = {
  materials?: ReviewMaterials
  schemaVersion: 1
  engineVersion: 'annual-balances/1'
  id: string
  createdAt: string
  year: number
  draftRevision: number
  correctsReviewId: string | null
  previousReviewId: string | null
  reason: string
  snapshot: BalanceSnapshot
  projection: AnnualBalanceProjection
}
