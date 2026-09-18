import { validateAnnualMethodFacts, type AnnualMethodFacts } from './annualMethodComparison.js'
import type { TaxDecisionInput, WorkPurpose, TaxCandidate } from './types.js'

export type CostTreatmentFacts = {
  methodComparison?: AnnualMethodFacts
  id: string
  costYear: number
  contributionId: string
  /** Canonical record of the cost and evidence that the user actually inspected. */
  costBasis: string
  recordedAt: string
  workPurpose: WorkPurpose
  placedInService: TaxDecisionInput['placedInService']
  assetKind: 'software' | 'other' | 'none' | 'unknown'
  directlyAttributable: boolean | null
  serviceProvidedInCurrentPeriod: boolean | null
  /** Required only for a prepaid amount; an unperformed obligation is not a prepayment. */
  paidByYearEnd: boolean | null
  workInProgressAtPeriodEnd: boolean | null
  /** Applies to ordinary expenses, not depreciation already calculated as a basis. */
  liabilityFixedAtYearEnd: boolean | null
  reason: string
  evidenceIds: string[]
}

export const treatmentPurposeLabels: Record<WorkPurpose, string> = {
  'new-development': '新規ソフトウエアの製作',
  'ordinary-operation': '通常業務',
  maintenance: '維持管理',
  'bug-fix': '不具合の除去',
  restoration: '原状回復',
  'feature-addition': '機能追加',
  'feature-improvement': '機能向上',
  'value-increase': '価値の増加',
  'useful-life-extension': '使用可能期間の延長',
  'sales-production': '販売物の制作',
  hobby: '趣味',
  'general-learning': '一般学習',
  'private-research': '私的調査',
  unknown: '未確認',
}

export function canonicalTreatmentValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalTreatmentValue).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalTreatmentValue(item)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

const fields = new Set([
  'methodComparison', 'id', 'costYear', 'contributionId', 'costBasis', 'recordedAt', 'workPurpose',
  'placedInService', 'assetKind', 'directlyAttributable', 'serviceProvidedInCurrentPeriod',
  'workInProgressAtPeriodEnd', 'liabilityFixedAtYearEnd', 'paidByYearEnd', 'reason', 'evidenceIds',
])
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

function validTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 ||
      Number(match[5] ?? 0) > 23 || Number(match[6] ?? 0) > 59) return false
  const day = new Date(match[1] + 'T00:00:00Z')
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1] &&
    Number.isFinite(Date.parse(value))
}

/** Shared by API schema, repository, recovery and the pure projection. Never strip unknown fields. */
export function validateCostTreatmentFacts(value: unknown): asserts value is CostTreatmentFacts[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error('処理条件の一覧が不正です。')
  const ids = new Set<string>(), keys = new Set<string>()
  for (const record of value) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).some((key) => !fields.has(key)) ||
        !text(record.id, 120) || !text(record.contributionId, 500) ||
        !Number.isInteger(record.costYear) || record.costYear < 2000 || record.costYear > 2100 ||
        !text(record.costBasis, 131072) ||
        !text(record.recordedAt, 40) || !validTimestamp(record.recordedAt) ||
        !Object.hasOwn(treatmentPurposeLabels, record.workPurpose) ||
        !['before', 'after', 'unknown'].includes(record.placedInService) ||
        !['software', 'other', 'none', 'unknown'].includes(record.assetKind) ||
        !['directlyAttributable', 'serviceProvidedInCurrentPeriod', 'workInProgressAtPeriodEnd', 'liabilityFixedAtYearEnd', 'paidByYearEnd']
          .every((key) => record[key] === null || typeof record[key] === 'boolean') ||
        typeof record.reason !== 'string' || record.reason.length > 2000 ||
        !Array.isArray(record.evidenceIds) || record.evidenceIds.length > 100 ||
        record.evidenceIds.some((id: unknown) => !text(id, 120)) ||
        new Set(record.evidenceIds).size !== record.evidenceIds.length)
      throw new Error('処理条件の形式・対象年・根拠を確認してください。')
    if (record.methodComparison !== undefined) validateAnnualMethodFacts(record.methodComparison)
    const key = JSON.stringify([record.costYear, record.contributionId])
    if (ids.has(record.id) || keys.has(key)) throw new Error('同じ費用配分の処理条件が重複しています。')
    ids.add(record.id); keys.add(key)
    let basis: unknown
    try { basis = JSON.parse(record.costBasis) } catch { throw new Error('処理条件の確認元が不正です。') }
    if (!basis || typeof basis !== 'object' || Array.isArray(basis) ||
        canonicalTreatmentValue(basis) !== record.costBasis)
      throw new Error('処理条件の確認元は正規化した資料である必要があります。')
  }
}

/** Compare a whole edited record: never silently mix another tab's facts and old evidence. */
export function editCostTreatmentFacts(
  records: readonly CostTreatmentFacts[], next: CostTreatmentFacts | null, previous: CostTreatmentFacts | null,
): CostTreatmentFacts[] {
  if (!next && !previous) throw new Error('変更する処理条件を指定してください。')
  if (next) validateCostTreatmentFacts([next])
  if (previous && next && previous.id !== next.id) throw new Error('処理条件のIDを変更できません。')
  const id = previous?.id ?? next!.id
  const matches = records.filter((row) => row.id === id)
  if (previous ? matches.length !== 1 || canonicalTreatmentValue(matches[0]) !== canonicalTreatmentValue(previous) : matches.length !== 0)
    throw new Error('処理条件が別の保存で変わっています。入力を保持して最新の内容を確認してください。')
  const result = records.filter((row) => row.id !== id).map((row) => structuredClone(row))
  if (next) result.push(structuredClone(next))
  validateCostTreatmentFacts(result)
  return result
}

export const treatmentCandidateLabels: Record<TaxCandidate, string> = {
  'ordinary-expense': '通常経費の候補',
  'software-acquisition-cost': 'ソフトウエア製作原価の候補',
  'capital-expenditure': '資本的支出の候補（方法未算定）',
  'production-cost': '期末制作原価の候補',
  'prepaid-expense': '前払の候補',
  'private-use': '私用・対象外',
  unclassified: '未判断',
}
