import type { CostTreatmentFacts } from '../core/costTreatmentFacts.js'
import { validateCostTreatmentFacts } from '../core/costTreatmentFacts.js'
export type TreatmentEditorValue = {
  draft: CostTreatmentFacts
  previous: CostTreatmentFacts | null
  numericInputs?: Partial<Record<MethodNumberKey, string>>
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Check types, not completion: invalid/incomplete method dates and amounts must remain editable. */
export function validTreatmentEditorValue(value: unknown): value is TreatmentEditorValue {
  if (
    !object(value) ||
    !object(value.draft) ||
    !('previous' in value) ||
    Object.keys(value).some((key) => !['draft', 'previous', 'numericInputs'].includes(key))
  )
    return false
  if (
    value.numericInputs !== undefined &&
    (!object(value.numericInputs) ||
      Object.entries(value.numericInputs).some(
        ([key, item]) =>
          !methodNumberKeys.includes(key as MethodNumberKey) ||
          typeof item !== 'string' ||
          item.length > 120,
      ))
  )
    return false
  try {
    for (const fact of [value.draft, value.previous]) {
      if (fact === null) continue
      if (!object(fact)) return false
      const { methodComparison, ...base } = fact
      validateCostTreatmentFacts([base])
      if (methodComparison !== undefined) {
        if (
          !object(methodComparison) ||
          !Array.isArray(methodComparison.contributionIds) ||
          methodComparison.contributionIds.some((id) => typeof id !== 'string')
        )
          return false
        for (const key of ['assetKind', 'scopeBasis', 'taxpayer', 'rentalUse', 'reason'])
          if (typeof methodComparison[key] !== 'string') return false
        for (const key of ['acquiredOn', 'usedOn'])
          if (methodComparison[key] !== null && typeof methodComparison[key] !== 'string')
            return false
        for (const key of ['usefulLifeYears', 'annualSpecialUsedJpy', 'businessMonths'])
          if (methodComparison[key] !== null && typeof methodComparison[key] !== 'number')
            return false
        if (typeof methodComparison.throughYear !== 'number') return false
        for (const key of [
          'completeCostConfirmed',
          'businessOnly',
          'ordinaryConditions',
          'eligibleSmallBusiness',
          'statementReady',
          'roundingConfirmed',
        ])
          if (methodComparison[key] !== null && typeof methodComparison[key] !== 'boolean')
            return false
      }
    }
    return true
  } catch {
    return false
  }
}

export const methodNumberKeys = [
  'throughYear',
  'usefulLifeYears',
  'annualSpecialUsedJpy',
  'businessMonths',
] as const
export type MethodNumberKey = (typeof methodNumberKeys)[number]
const parsedNumber = (raw: string): number | null => {
  if (!/^\d+$/.test(raw.trim())) return null
  const number = Number(raw.trim())
  return Number.isSafeInteger(number) ? number : null
}

export function editTreatmentMethodNumber(
  value: TreatmentEditorValue,
  key: MethodNumberKey,
  raw: string,
): TreatmentEditorValue {
  const method = value.draft.methodComparison
  if (!method || !methodNumberKeys.includes(key) || raw.length > 120)
    throw new Error('編集する方法の数値項目を確認してください。')
  const parsed = parsedNumber(raw)
  return {
    ...value,
    numericInputs: { ...value.numericInputs, [key]: raw },
    draft: {
      ...value.draft,
      methodComparison: {
        ...method,
        [key]: key === 'throughYear' ? (parsed ?? method.throughYear) : parsed,
      },
    },
  }
}

/** Validate only at save, so an incomplete numeric string survives reload without becoming a false zero. */
export function assertTreatmentEditorSave(value: TreatmentEditorValue): void {
  const method = value.draft.methodComparison
  if (method)
    for (const key of methodNumberKeys) {
      const raw = value.numericInputs?.[key]
      if (raw === undefined) continue
      const parsed = parsedNumber(raw)
      if (
        (parsed === null && (key === 'throughYear' || raw.trim() !== '')) ||
        method[key] !== parsed
      )
        throw new Error(
          '入力途中の方法条件があります。空欄・未完成の数値を0円へ変換せず、入力を保持しています。',
        )
    }
  validateCostTreatmentFacts([value.draft])
}
