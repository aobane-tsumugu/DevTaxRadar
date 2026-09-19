import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import { validateBalanceSnapshot } from './annualBalances.js'
import { balanceUseSources, draftBalanceUse } from './balanceUseDraft.js'
import { decisionIsConfirmed } from './decisionConfirmation.js'
import { softwareAcquisitionBasis, softwareMethodSchedule,
  validateSoftwareMethod, softwareEvidenceBasis, softwareMethodPostingBasis, allocateSoftwareExpense, type SoftwareMethod } from './softwareMethod.js'

/** Explicit confirmation once per asset; saving still uses the existing balance endpoint. */
export function chooseSoftwareMethod(
  snapshot: BalanceSnapshot, planning: PlanningSnapshot, accountId: string,
  input: Omit<SoftwareMethod, 'version' | 'engineVersion' | 'acquisitionBasis' | 'evidenceBasis'>,
): BalanceSnapshot {
  validateBalanceSnapshot(snapshot)
  const account = snapshot.accounts.find((row) => row.id === accountId)
  const unit = planning.taxUnits.find((row) => row.id === account?.taxUnitId)
  if (!unit || !['new-software','improvement-plan'].includes(unit.unitType))
    throw new Error('方法を記録するソフトウェア・改良計画を選択してください。')
  if (input.evidenceIds.some((id) => !planning.evidence.some((row) => row.id === id)))
    throw new Error('方法・耐用年数等の根拠が現在の資料にありません。')
  const selection: SoftwareMethod = {
    ...structuredClone(input), version: 1, engineVersion: 'annual-method-comparison/2',
    acquisitionBasis: softwareAcquisitionBasis(snapshot, accountId, input.acquisitionMovementId),
    evidenceBasis: softwareEvidenceBasis(planning.evidence, input.evidenceIds),
  }
  validateSoftwareMethod(selection)
  softwareMethodSchedule(snapshot, accountId, selection, Number(selection.usedOn.slice(0, 4)))
  const next = structuredClone(snapshot)
  next.accounts.find((row) => row.id === accountId)!.softwareMethod = selection
  validateBalanceSnapshot(next)
  return next
}

/** Computes the amount; no editable amount input, no save, no adoption, no backfilled history. */
export function draftSoftwareYearExpense(
  snapshot: BalanceSnapshot, planning: PlanningSnapshot, costs: AnnualCostProjection[],
  input: { accountId: string; year: number; requestId: string; decisionId: string; ordinaryYearConfirmed: boolean },
): BalanceSnapshot {
  validateBalanceSnapshot(snapshot)
  const account = snapshot.accounts.find((row) => row.id === input.accountId)
  const selection = account?.softwareMethod
  if (!account || !selection) throw new Error('先に資産全体の方法を記録してください。')
  if (!Number.isInteger(input.year) || input.year < Number(selection.usedOn.slice(0, 4)))
    throw new Error('供用年以降の費用化年を指定してください。')
  if (selection.ordinaryThroughYear !== undefined && input.year > selection.ordinaryThroughYear)
    throw new Error('この年は通常計算の終了後です。記録した理由に沿って既存の判断・残額使用で確認してください。')
  if (softwareEvidenceBasis(planning.evidence, selection.evidenceIds) !== selection.evidenceBasis)
    throw new Error('方法の根拠内容が変わっています。変更を確認してから方法を更新してください。')
  if (selection.evidenceIds.some((id) => !planning.evidence.some((row) => row.id === id)))
    throw new Error('方法の根拠がなくなっています。確認し直してください。')
  if (planning.lifecycleEvents.some((row) => row.taxUnitId === account.taxUnitId &&
      ['retired','abandoned'].includes(row.eventType) && row.occurredOn <= `${input.year}-12-31`))
    throw new Error('終了・中止の出来事があります。継続使用を仮定した年額を作りません。')
  const schedule = softwareMethodSchedule(snapshot, account.id, selection, input.year)
  const expected = schedule.find((row) => row.year === input.year)
  if (!expected) throw new Error('対象年の費用化額が計算できません。')
  const expenses = snapshot.movements.filter((row) => row.kind === 'expense' && row.accountId === account.id)
  const methodBasis = softwareMethodPostingBasis(selection)
  for (const prior of schedule.filter((row) => row.year < input.year && row.expenseJpy > 0)) {
    const found = expenses.filter((row) => row.occurredOn.startsWith(prior.year + '-'))
    if (found.length !== 1 || found[0]!.amountJpy !== prior.expenseJpy ||
        found[0]!.softwareExpense?.methodBasis !== methodBasis)
      throw new Error(`${prior.year}年の費用化が未記録または変更されています。実績を推定して翌年へ進みません。`)
  }
  const existing = expenses.filter((row) => row.occurredOn.startsWith(input.year + '-'))
  if (existing.length) {
    if (existing.length === 1 && existing[0]!.id === 'balance-use:' + input.requestId &&
        existing[0]!.decisionId === input.decisionId && existing[0]!.amountJpy === expected.expenseJpy &&
        existing[0]!.softwareExpense?.methodBasis === methodBasis) return structuredClone(snapshot)
    throw new Error('この資産の対象年の費用化は既にあります。重ねて追加せず、既存記録を確認してください。')
  }
  if (snapshot.movements.some((row) => row.kind === 'transfer' ? row.fromAccountId === account.id :
    row.kind === 'reduction' && row.accountId === account.id))
    throw new Error('振替・減少を伴う資産は通常の継続償却案から分けて確認してください。')
  if (expected.expenseJpy === 0) return structuredClone(snapshot)
  if (!input.ordinaryYearConfirmed) throw new Error('対象年の継続使用と、転用・中止・特殊調整がないことを確認してください。')
  const decision = planning.decisions.find((row) => row.id === input.decisionId)
  if (!decision || !decisionIsConfirmed(decision) || decision.taxYear !== input.year ||
      decision.taxUnitId !== account.taxUnitId || decision.treatmentBinding || decision.selectedCandidate !== 'ordinary-expense')
    throw new Error('対象年・ソフトウェアに対応する年額費用の確認済み判断を選択してください。取得原価への組入れ判断は転用しません。')
  const source = balanceUseSources(snapshot, costs, `${input.year}-12-31`)
    .find((row) => row.sourceKind === 'movement' && row.sourceId === selection.acquisitionMovementId)
  if (!source || source.accountId !== account.id || source.amountJpy !== expected.openingJpy + expected.additionsJpy)
    throw new Error('保存した前年費用化と現在の原価残額が一致しません。後年度の使用予約も確認してください。')
  if (source.untracedJpy !== 0 && source.lots.some((lot) => lot.remainingJpy !== 0)) throw new Error('個別原価内訳が未収録の部分は、比例配分で推定せず既存の残額使用で確認してください。')
  const allocations = source.lots.some((lot) => lot.remainingJpy !== 0)
    ? allocateSoftwareExpense(expected.expenseJpy, source.lots) : undefined
  const next = draftBalanceUse(snapshot, planning, costs, {
    requestId: input.requestId, kind: 'expense', sourceKind: 'movement', sourceId: source.sourceId,
    occurredOn: `${input.year}-12-31`, amountJpy: expected.expenseJpy, decisionId: input.decisionId,
    reason: `記録した方法 ${selection.method} による${input.year}年の年額。原価内訳は確認した残額比例・最大剰余法で配分。${decision.reason}`,
    evidenceIds: selection.evidenceIds, ...(allocations === undefined ? {} : { costAllocations: allocations }),
  })
  next.movements.find((row) => row.id === 'balance-use:' + input.requestId)!.softwareExpense = {
    version: 1, accountId: account.id, year: input.year, methodBasis, ordinaryYearConfirmed: true,
  }
  validateBalanceSnapshot(next)
  return next
}

/** Explicit handoff for retirement, conversion or a method change; never rewrites old postings. */
export function endSoftwareOrdinaryMethod(snapshot: BalanceSnapshot, accountId: string, lastYear: number, reason: string): BalanceSnapshot {
  const next = structuredClone(snapshot)
  const selected = next.accounts.find((account) => account.id === accountId)?.softwareMethod
  if (!selected) throw new Error('記録済みの方法を選んでください。')
  selected.ordinaryThroughYear = lastYear
  selected.terminationReason = reason
  validateBalanceSnapshot(next)
  return next
}

export { allocateSoftwareExpense } from './softwareMethod.js'
