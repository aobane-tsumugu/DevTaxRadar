import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceReview } from '../accounting/balanceWorkspace.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import { validateBalanceSnapshot } from './annualBalances.js'
import { balanceUseSources, draftBalanceUse } from './balanceUseDraft.js'
import { traceBalanceLots } from './balanceLotTrace.js'
import { decisionIsConfirmed } from './decisionConfirmation.js'
import { externalOpeningIssues } from './externalOpening.js'
import { assembleSoftwareAcquisitionBasis } from './softwareAcquisitionBasis.js'

export function inspectSoftwareAcquisition(
  snapshot: BalanceSnapshot, planning: PlanningSnapshot, costs: AnnualCostProjection[],
  constructionAccountId: string, occurredOn: string, openingReviews: BalanceReview[] = [],
) {
  return assembleSoftwareAcquisitionBasis({
    snapshot, planning, costs, constructionAccountId, occurredOn, openingReviews,
    remaining: balanceUseSources(snapshot, costs, occurredOn),
    openingProblems: externalOpeningIssues(snapshot, planning),
    confirmedDecisionIds: planning.decisions.filter(decisionIsConfirmed).map((row) => row.id),
  })
}

type SourceChoice = { sourceKind: 'opening' | 'movement'; sourceId: string; amountJpy: number }
const sourceSignature = (rows: SourceChoice[]) => JSON.stringify(rows
  .map(({ sourceKind, sourceId, amountJpy }) => ({ sourceKind, sourceId, amountJpy }))
  .sort((a, b) => a.sourceKind.localeCompare(b.sourceKind, 'en') || a.sourceId.localeCompare(b.sourceId, 'en')))

export type SoftwareAcquisitionInput = {
  requestId: string
  constructionAccountId: string
  toAccountId: string
  occurredOn: string
  decisionId: string
  reason: string
  evidenceIds: string[]
  completeCostConfirmed: boolean
  expectedAmountJpy: number
  expectedSources: SourceChoice[]
}

/**
 * Produce one ordinary transfer with all original year/lot links. Use the existing
 * draft helper for each source, then revalidate the joined movement. No new table,
 * write endpoint, implicit depreciation method, or direct adoption is introduced.
 */
export function draftSoftwareAcquisition(
  snapshot: BalanceSnapshot, planning: PlanningSnapshot, costs: AnnualCostProjection[],
  input: SoftwareAcquisitionInput, openingReviews: BalanceReview[] = [],
): BalanceSnapshot {
  validateBalanceSnapshot(snapshot)
  if (!input.completeCostConfirmed) throw new Error('対象ソフトウェア全体の原価範囲を確認してください。既知小計だけで取得価額を決めません。')
  if (!Number.isSafeInteger(input.expectedAmountJpy) || input.expectedAmountJpy <= 0 ||
      !input.expectedSources.length || input.expectedSources.length > 100)
    throw new Error('確認した取得価額候補と対応元を指定してください。')
  const reason = `複数年度を含むソフトウェア原価の範囲を確認して、制作中から資産へ振替。${input.reason.trim()}`
  if (!input.reason.trim() || reason.length > 2000) throw new Error('全体原価と振替の理由を2000文字以内で記録してください。')
  const id = 'balance-use:' + input.requestId
  const previous = snapshot.movements.find((row) => row.id === id)
  if (previous) {
    if (previous.kind !== 'transfer' || previous.fromAccountId !== input.constructionAccountId ||
        previous.toAccountId !== input.toAccountId || previous.occurredOn !== input.occurredOn ||
        previous.decisionId !== input.decisionId || previous.reason !== reason ||
        previous.amountJpy !== input.expectedAmountJpy ||
        sourceSignature(previous.balanceAllocations ?? []) !== sourceSignature(input.expectedSources) ||
        input.evidenceIds.some((evidenceId) => !previous.sourceIds.includes(evidenceId)))
      throw new Error('同じ取得原価の入力要求IDで内容を変更できません。')
    return structuredClone(snapshot)
  }
  const basis = inspectSoftwareAcquisition(snapshot, planning, costs,
    input.constructionAccountId, input.occurredOn, openingReviews)
  if (basis.status !== 'ready' || basis.amountJpy !== input.expectedAmountJpy ||
      sourceSignature(basis.sources.map((row) => ({ ...row, amountJpy: row.amountJpy! }))) !== sourceSignature(input.expectedSources))
    throw new Error('確認した原価の範囲・金額・未算定状態が変わっています。最新の内訳を確認してください。')
  const destination = snapshot.accounts.find((row) => row.id === input.toAccountId)
  if (!destination || destination.kind !== 'asset' || destination.taxUnitId !== basis.taxUnitId ||
      destination.opening.status !== 'known' || destination.opening.amountJpy !== 0 ||
      snapshot.movements.some((row) => row.kind === 'transfer'
        ? row.toAccountId === destination.id : row.kind === 'addition' && row.accountId === destination.id))
    throw new Error('同じソフトウェアの、まだ受入のない資産残高を選んでください。別資産の取得価額へ混ぜません。')
  const decision = planning.decisions.find((row) => row.id === input.decisionId)
  if (!decision || decision.treatmentBinding ||
      !['software-acquisition-cost', 'capital-expenditure'].includes(decision.selectedCandidate ?? ''))
    throw new Error('配分1件の判断ではなく、ソフトウェア全体の取得・改良に対応する確認済み判断を選んでください。')

  const parts = basis.sources.map((source) => {
    const proposed = draftBalanceUse(snapshot, planning, costs, {
      requestId: input.requestId, kind: 'transfer', sourceKind: source.sourceKind, sourceId: source.sourceId,
      toAccountId: input.toAccountId, occurredOn: input.occurredOn, amountJpy: source.amountJpy!,
      decisionId: input.decisionId, reason, evidenceIds: input.evidenceIds,
    })
    const part = proposed.movements.at(-1)!
    if (part.kind !== 'transfer') throw new Error('振替案を作成できません。')
    return part
  })
  const sourceIds = [...new Set(parts.flatMap((row) => row.sourceIds))].sort()
  if (sourceIds.length > 100) throw new Error('一つの振替の出典上限100件を超えています。省略して保存しません。')
  const next = structuredClone(snapshot)
  next.movements.push({
    ...parts[0]!, id, amountJpy: basis.amountJpy!, sourceIds,
    balanceAllocations: parts.flatMap((row) => row.balanceAllocations ?? []),
  })
  validateBalanceSnapshot(next)
  const year = Math.max(Number(input.occurredOn.slice(0, 4)),
    ...next.movements.map((row) => Number(row.occurredOn.slice(0, 4))))
  if (traceBalanceLots(next, costs, year).status === 'invalid')
    throw new Error('結合した取得原価の出典・残額・二重使用に不整合があります。入力は変更していません。')
  return next
}
