import type { BalanceSnapshot } from '../accounting/types.js'
import type { DecisionRecord, PlanningSnapshot } from '../planning/types.js'
import { decisionIsConfirmed } from './decisionConfirmation.js'
import {
  canonicalSoftwareValue,
  softwareEvidenceBasis,
  softwareMethodPostingBasis,
  softwareMethodSchedule,
  type SoftwareMethod,
} from './softwareMethod.js'

export const SOFTWARE_ANNUAL_DECISION_VERSION = 'software-annual-expense/1'

export type SoftwareAnnualDecisionBinding = {
  version: 1
  accountId: string
  year: number
  methodBasis: string
  annualExpenseJpy: number
  ordinaryYearConfirmed: true
}

export type SoftwareAnnualDecisionContext = {
  accountId: string
  taxUnitId: string
  year: number
  acquisitionAmountJpy: number
  expenseJpy: number
  method: SoftwareMethod['method']
  usedOn: string
  methodReason: string
  evidenceIds: string[]
  methodBasis: string
}

export type SoftwareAnnualDecisionProposal = SoftwareAnnualDecisionContext & {
  existingDecisionId?: string
  staleDecisionIds: string[]
}

const methodLabels: Record<SoftwareMethod['method'], string> = {
  'straight-line': '通常の定額法',
  'immediate-expense': '供用年の全額費用',
  'three-year-pool': '3年一括償却',
  'blue-special': '青色申告の少額資産特例',
}

export function softwareAnnualMethodLabel(method: SoftwareMethod['method']): string {
  return methodLabels[method]
}

export function inspectSoftwareAnnualDecision(
  snapshot: BalanceSnapshot,
  planning: PlanningSnapshot,
  accountId: string,
  year: number,
): SoftwareAnnualDecisionContext {
  const account = snapshot.accounts.find((row) => row.id === accountId)
  const selection = account?.softwareMethod
  if (!account || !selection) throw new Error('先に資産全体の方法を記録してください。')
  if (!Number.isInteger(year) || year < Number(selection.usedOn.slice(0, 4)))
    throw new Error('供用年以降の費用化年を指定してください。')
  if (selection.ordinaryThroughYear !== undefined && year > selection.ordinaryThroughYear)
    throw new Error('この年は通常計算の終了後です。記録した理由に沿って別の処理を確認してください。')
  if (softwareEvidenceBasis(planning.evidence, selection.evidenceIds) !== selection.evidenceBasis)
    throw new Error('方法の根拠内容が変わっています。変更を確認してから方法を更新してください。')
  if (selection.evidenceIds.some((id) => !planning.evidence.some((row) => row.id === id)))
    throw new Error('方法の根拠がなくなっています。確認し直してください。')
  if (planning.lifecycleEvents.some((row) => row.taxUnitId === account.taxUnitId &&
      ['retired', 'abandoned'].includes(row.eventType) && row.occurredOn <= `${year}-12-31`))
    throw new Error('終了・中止の出来事があります。継続使用を仮定した年額判断を作りません。')
  const expected = softwareMethodSchedule(snapshot, account.id, selection, year)
    .find((row) => row.year === year)
  if (!expected) throw new Error('対象年の費用化額が計算できません。')
  if (expected.expenseJpy > 0 && selection.blueSpecial &&
      (planning.profile.filingType !== selection.blueSpecial.filingType ||
       planning.profile.incomeCategory !== selection.blueSpecial.incomeCategory))
    throw new Error('青色申告・所得区分が方法確認時から変わっています。方法を再確認してください。')
  const origin = snapshot.movements.find((row) => row.id === selection.acquisitionMovementId)
  if (!origin || !Number.isSafeInteger(origin.amountJpy) || origin.amountJpy <= 0)
    throw new Error('確認済みの取得価額を読み取れません。')
  return {
    accountId: account.id,
    taxUnitId: account.taxUnitId,
    year,
    acquisitionAmountJpy: origin.amountJpy,
    expenseJpy: expected.expenseJpy,
    method: selection.method,
    usedOn: selection.usedOn,
    methodReason: selection.reason,
    evidenceIds: [...selection.evidenceIds],
    methodBasis: softwareMethodPostingBasis(selection),
  }
}

function binding(context: SoftwareAnnualDecisionContext): SoftwareAnnualDecisionBinding {
  return {
    version: 1,
    accountId: context.accountId,
    year: context.year,
    methodBasis: context.methodBasis,
    annualExpenseJpy: context.expenseJpy,
    ordinaryYearConfirmed: true,
  }
}

export function softwareAnnualDecisionMatches(
  decision: DecisionRecord,
  context: SoftwareAnnualDecisionContext,
): boolean {
  return Boolean(
    decision.softwareAnnualBinding &&
    decision.engineVersion === SOFTWARE_ANNUAL_DECISION_VERSION &&
    decision.taxUnitId === context.taxUnitId &&
    decision.taxYear === context.year &&
    decision.candidate === 'ordinary-expense' &&
    decision.selectedCandidate === 'ordinary-expense' &&
    !decision.treatmentBinding &&
    decisionIsConfirmed(decision) &&
    canonicalSoftwareValue(decision.softwareAnnualBinding) === canonicalSoftwareValue(binding(context)),
  )
}

export function softwareAnnualDecisionProposal(
  snapshot: BalanceSnapshot,
  planning: PlanningSnapshot,
  accountId: string,
  year: number,
): SoftwareAnnualDecisionProposal {
  const context = inspectSoftwareAnnualDecision(snapshot, planning, accountId, year)
  if (context.expenseJpy === 0) return { ...context, staleDecisionIds: [] }
  const related = planning.decisions.filter((row) =>
    row.softwareAnnualBinding?.accountId === accountId &&
    row.softwareAnnualBinding.year === year)
  const current = related.filter((row) => softwareAnnualDecisionMatches(row, context))
  if (current.length > 1)
    throw new Error('同じ資産・年・方法の確認済み判断が複数あります。どれかを自動採用せず確認してください。')
  return {
    ...context,
    ...(current[0] ? { existingDecisionId: current[0].id } : {}),
    staleDecisionIds: related.filter((row) => !current.includes(row)).map((row) => row.id),
  }
}

export function confirmSoftwareAnnualDecision(
  proposal: SoftwareAnnualDecisionProposal,
  id: string,
  confirmedAt: string,
): DecisionRecord {
  if (proposal.expenseJpy <= 0)
    throw new Error('年額0円の年には不要な判断記録を作りません。')
  if (proposal.existingDecisionId)
    throw new Error('同じ方法・対象年の確認済み判断があります。既存記録を再利用してください。')
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || !Number.isFinite(Date.parse(confirmedAt)))
    throw new Error('年額判断の識別子または確認日時を確認してください。')
  const label = softwareAnnualMethodLabel(proposal.method)
  return {
    id,
    taxUnitId: proposal.taxUnitId,
    taxYear: proposal.year,
    engineVersion: SOFTWARE_ANNUAL_DECISION_VERSION,
    candidate: 'ordinary-expense',
    selectedCandidate: 'ordinary-expense',
    status: 'confirmed',
    reason: `保存済みの${label}・取得価額・根拠を参照し、${proposal.year}年も継続使用し、転用・中止・特殊調整がないことを本人が確認。方法から計算した年額 ${proposal.expenseJpy}円。`,
    createdAt: confirmedAt,
    confirmedAt,
    softwareAnnualBinding: binding(proposal),
  }
}
