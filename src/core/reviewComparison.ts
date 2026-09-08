import type { BalancePreview, BalanceReview } from '../accounting/balanceWorkspace.js'
import type { AmountState, BalanceSnapshot } from '../accounting/types.js'

export type BalanceAmountImpact = {
  before: AmountState | null
  after: AmountState | null
  deltaJpy: number | null
}

export type ReviewChange = {
  path: string[]
  operation: 'added' | 'removed' | 'changed'
  before?: unknown
  after?: unknown
}
export type ReviewComparison = {
  engineVersion: 'review-comparison/1'
  reviewId: string
  year: number
  beforeDraftRevision: number
  currentDraftRevision: number
  currentWorkspaceRevision: number | null
  currentPreviewHash: string
  currentReviewId: string | null
  previousReviewChanged: boolean
  materialCoverage: 'both' | 'missing-stored' | 'missing-current' | 'neither'
  changes: ReviewChange[]
  balanceImpact: Array<{
    accountId: string
    name: string
    opening: BalanceAmountImpact
    closing: BalanceAmountImpact
  }>
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => equal(item, right[index]))
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const a = left as Record<string, unknown>,
      b = right as Record<string, unknown>
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    return keys.every((key) => equal(a[key], b[key]))
  }
  return false
}
function keyed(items: unknown[]): Map<string, unknown> | null {
  const result = new Map<string, unknown>()
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    const key = row.id ?? row.accountId ?? row.observationId ?? row.taxUnitId
    if (typeof key !== 'string' || result.has(key)) return null
    result.set(key, item)
  }
  return result
}

/** Compare stored results with current results, never recompute the old record using a new engine. */
export function compareReview(
  review: BalanceReview,
  current: BalancePreview,
  snapshot: BalanceSnapshot,
): ReviewComparison {
  if (
    review.year !== current.projection.year ||
    (current.materials && current.materials.year !== review.year)
  )
    throw new Error('同じ対象年の資料だけを比較できます。')
  const changes: ReviewChange[] = []
  function diff(before: unknown, after: unknown, path: string[]) {
    if (equal(before, after)) return
    if (before !== undefined && after !== undefined) {
      if (Array.isArray(before) && Array.isArray(after)) {
        const a = keyed(before),
          b = keyed(after)
        if (a && b) {
          for (const id of [...new Set([...a.keys(), ...b.keys()])].sort())
            diff(a.get(id), b.get(id), [...path, id])
          return
        }
      } else if (
        before &&
        after &&
        typeof before === 'object' &&
        typeof after === 'object' &&
        !Array.isArray(before) &&
        !Array.isArray(after)
      ) {
        const a = before as Record<string, unknown>,
          b = after as Record<string, unknown>
        for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort())
          diff(a[key], b[key], [...path, key])
        return
      }
    }
    changes.push({
      path,
      operation: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
      ...(before === undefined ? {} : { before: structuredClone(before) }),
      ...(after === undefined ? {} : { after: structuredClone(after) }),
    })
  }
  diff(review.snapshot, snapshot, ['balanceInputs'])
  diff(review.projection, current.projection, ['balanceResults'])
  if (review.materials && current.materials) {
    const { workspaceRevision: _oldRevision, ...before } = review.materials
    const { workspaceRevision: _newRevision, ...after } = current.materials
    diff(before, after, ['materials'])
  }
  const oldAccounts = new Map(review.projection.accounts.map((row) => [row.accountId, row]))
  const newAccounts = new Map(current.projection.accounts.map((row) => [row.accountId, row]))
  const impact = (
    before: AmountState | undefined,
    after: AmountState | undefined,
  ): BalanceAmountImpact => ({
    before: before ? structuredClone(before) : null,
    after: after ? structuredClone(after) : null,
    deltaJpy:
      before?.status === 'known' && after?.status === 'known'
        ? after.amountJpy - before.amountJpy
        : null,
  })
  return {
    engineVersion: 'review-comparison/1',
    reviewId: review.id,
    year: review.year,
    beforeDraftRevision: review.draftRevision,
    currentDraftRevision: current.draftRevision,
    currentWorkspaceRevision: current.materials?.workspaceRevision ?? null,
    currentPreviewHash: current.projectionHash,
    currentReviewId: current.currentReviewId,
    previousReviewChanged:
      review.previousReviewId !== current.previousReviewId ||
      current.previousReviewChainChanged === true,
    materialCoverage: review.materials
      ? current.materials
        ? 'both'
        : 'missing-current'
      : current.materials
        ? 'missing-stored'
        : 'neither',
    changes,
    balanceImpact: [...new Set([...oldAccounts.keys(), ...newAccounts.keys()])]
      .sort()
      .map((accountId) => {
        const before = oldAccounts.get(accountId),
          after = newAccounts.get(accountId)
        return {
          accountId,
          name: after?.name ?? before!.name,
          opening: impact(before?.opening, after?.opening),
          closing: impact(before?.closing, after?.closing),
        }
      }),
  }
}
