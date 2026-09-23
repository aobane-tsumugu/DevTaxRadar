import {
  adjustmentBalanceLinkIssues,
  type AdjustmentCostContext,
} from './adjustmentBalanceLinks.js'
import { externalOpeningIssues } from './externalOpening.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import { decisionIsConfirmed } from './decisionConfirmation.js'
import { consultationResolutionMatches } from './consultationResolution.js'

export type BalanceReferenceIssue = {
  recordType: 'account' | 'movement' | 'pending'
  recordId: string
  referenceId: string
  code:
    | 'missing-unit'
    | 'missing-source'
    | 'ambiguous-source'
    | 'missing-decision'
    | 'unconfirmed-decision'
    | 'decision-year'
    | 'decision-unit'
    | 'pending-unit'
    | 'changed-answer'
    | 'adjustment-link'
  message: string
}
export type BalanceReferenceCheck = {
  engineVersion: 'balance-references/1'
  issues: BalanceReferenceIssue[]
  /** Existence, confirmation and unit/year consistency only; not tax eligibility or amount provenance. */
  status: 'consistent' | 'needs-review'
}

export function checkBalanceReferences(
  snapshot: BalanceSnapshot,
  planning: PlanningSnapshot,
  chargePeriods: readonly { id: string }[],
  calculatedSources: readonly { id: string }[] = [],
  adjustmentCosts?: AdjustmentCostContext,
  reviewYear?: number,
): BalanceReferenceCheck {
  // Ordinary draft checks cover the whole snapshot. Annual adoption explicitly
  // checks references through its year without approving future draft decisions.
  // Structural and amount validation of the complete snapshot is unchanged.
  if (reviewYear !== undefined) {
    if (!Number.isInteger(reviewYear) || reviewYear < 1900 || reviewYear > 9999)
      throw new Error('参照確認の対象年度を確認してください。')
    if (adjustmentCosts && adjustmentCosts.trace.year !== reviewYear)
      throw new Error('参照確認と原価追跡の対象年度が一致しません。')
    snapshot = {
      ...snapshot,
      movements: snapshot.movements.filter(
        (row) => Number(row.occurredOn.slice(0, 4)) <= reviewYear,
      ),
      pendingDecisions: snapshot.pendingDecisions
        .filter((row) => row.taxYear <= reviewYear)
        .map(({ answers, resolution, ...row }) => ({
          ...row,
          ...(answers === undefined
            ? {}
            : { answers: answers.filter((answer) => answer.taxYear <= reviewYear) }),
          ...(resolution && resolution.taxYear <= reviewYear ? { resolution } : {}),
        })),
    }
    planning = {
      ...planning,
      sourceAdjustments: (planning.sourceAdjustments ?? []).filter(
        (row) =>
          row.effect === 'restate-original-cost' ||
          Number(row.occurredOn.slice(0, 4)) <= reviewYear,
      ),
    }
  }
  const issues: BalanceReferenceIssue[] = []
  const units = new Set(planning.taxUnits.map((row) => row.id))
  const accounts = new Map(snapshot.accounts.map((row) => [row.id, row]))
  const decisions = new Map(planning.decisions.map((row) => [row.id, row]))
  const sourceCounts = new Map<string, number>()
  const costSourceIds = [
    ...chargePeriods.map((row) => 'ai:charge:' + row.id),
    ...planning.directCosts.map((row) => 'direct:' + row.id),
    ...planning.equipment.map((row) => 'equipment:' + row.id),
    ...planning.homeCosts.map((row) => 'home:' + row.id),
  ]
  for (const row of calculatedSources)
    if (!costSourceIds.includes(row.id)) costSourceIds.push(row.id)
  for (const id of [...costSourceIds, ...planning.evidence.map((row) => row.id)])
    sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1)
  const add = (
    recordType: BalanceReferenceIssue['recordType'],
    recordId: string,
    referenceId: string,
    code: BalanceReferenceIssue['code'],
    message: string,
  ) => {
    issues.push({ recordType, recordId, referenceId, code, message })
  }
  const unit = (type: BalanceReferenceIssue['recordType'], id: string, unitId: string) => {
    if (!units.has(unitId))
      add(
        type,
        id,
        unitId,
        'missing-unit',
        '制作物が現在の計画にありません。制作物の登録・対応を確認してください。',
      )
  }
  const sources = (type: 'movement' | 'pending', id: string, sourceIds: string[]) => {
    for (const sourceId of sourceIds) {
      const count = sourceCounts.get(sourceId) ?? 0
      if (count === 0)
        add(type, id, sourceId, 'missing-source', '根拠となる費用・資料が現在の記録にありません。')
      if (count > 1)
        add(
          type,
          id,
          sourceId,
          'ambiguous-source',
          '同じ参照が複数の費用・資料に一致します。参照先を特定する必要があります。',
        )
    }
  }
  for (const account of snapshot.accounts)
    if (reviewYear === undefined || account.openingYear <= reviewYear)
      unit('account', account.id, account.taxUnitId)
  for (const movement of snapshot.movements) {
    sources('movement', movement.id, movement.sourceIds)
    const decision = decisions.get(movement.decisionId)
    if (!decision) {
      add(
        'movement',
        movement.id,
        movement.decisionId,
        'missing-decision',
        '判断記録が現在の計画にありません。',
      )
      continue
    }
    if (!decisionIsConfirmed(decision))
      add(
        'movement',
        movement.id,
        decision.id,
        'unconfirmed-decision',
        '判断の確認内容・根拠・日時がそろっていないか、未確認へ戻っています。',
      )
    if (decision.taxYear !== Number(movement.occurredOn.slice(0, 4)))
      add(
        'movement',
        movement.id,
        decision.id,
        'decision-year',
        '増減の年と判断の対象年が一致しません。',
      )
    const ids =
      movement.kind === 'transfer'
        ? [movement.fromAccountId, movement.toAccountId]
        : [movement.accountId]
    // A registered predecessor/successor transfer uses the receiving unit's
    // confirmed decision. Requiring both units to equal one decision made
    // every cross-version transfer impossible. This does not approve its tax
    // treatment or relax the existing source, year, amount or lot checks.
    const from = movement.kind === 'transfer' ? accounts.get(movement.fromAccountId) : undefined
    const to = movement.kind === 'transfer' ? accounts.get(movement.toAccountId) : undefined
    const successorTransfer = Boolean(
      from &&
      to &&
      from.taxUnitId !== to.taxUnitId &&
      decision.taxUnitId === to.taxUnitId &&
      planning.taxUnits.find((item) => item.id === to.taxUnitId)?.predecessorId === from.taxUnitId,
    )
    if (
      !successorTransfer &&
      ids.some((id) => accounts.has(id) && accounts.get(id)!.taxUnitId !== decision.taxUnitId)
    )
      add(
        'movement',
        movement.id,
        decision.id,
        'decision-unit',
        '増減に関係する残高の制作物と判断の制作物が一致しません。',
      )
  }
  for (const pending of snapshot.pendingDecisions) {
    unit('pending', pending.id, pending.taxUnitId)
    sources('pending', pending.id, pending.sourceIds)
    if (pending.resolution) {
      if (!consultationResolutionMatches(pending, true))
        add(
          'pending',
          pending.id,
          pending.resolution.decisionId,
          'changed-answer',
          '解消時に確認した問い・対象額・回答・判断の対応が未記録、または現在と異なります。対象と判断を再確認してください。',
        )
      const decision = decisions.get(pending.resolution.decisionId)
      if (!decision)
        add(
          'pending',
          pending.id,
          pending.resolution.decisionId,
          'missing-decision',
          '解消の判断記録が現在の計画にありません。',
        )
      else {
        if (!decisionIsConfirmed(decision))
          add(
            'pending',
            pending.id,
            decision.id,
            'unconfirmed-decision',
            '解消に使用した判断が確認済みではありません。',
          )
        if (decision.taxYear !== pending.resolution.taxYear)
          add(
            'pending',
            pending.id,
            decision.id,
            'decision-year',
            '解消年と判断の対象年が一致しません。',
          )
        if (decision.taxUnitId !== pending.taxUnitId)
          add(
            'pending',
            pending.id,
            decision.id,
            'decision-unit',
            '解消の判断と未判断の制作物が一致しません。',
          )
      }
    }
    if (
      pending.accountIds.some(
        (id) => accounts.has(id) && accounts.get(id)!.taxUnitId !== pending.taxUnitId,
      )
    )
      add(
        'pending',
        pending.id,
        pending.taxUnitId,
        'pending-unit',
        '未判断の制作物と対応する残高の制作物が一致しません。',
      )
  }
  const adjustments = planning.sourceAdjustments ?? []
  for (const row of adjustments) {
    if (row.effect === 'balance-reduction')
      sources('movement', row.balanceMovementId!, [row.sourceId, ...row.evidenceIds])
  }
  for (const issue of adjustmentBalanceLinkIssues(adjustments, snapshot, adjustmentCosts))
    add('movement', issue.movementId, issue.recordId, 'adjustment-link', issue.message)
  for (const issue of externalOpeningIssues(snapshot, planning))
    add('pending', issue.recordId, issue.accountId, 'changed-answer', issue.message)
  return {
    engineVersion: 'balance-references/1',
    status: issues.length ? 'needs-review' : 'consistent',
    issues,
  }
}
