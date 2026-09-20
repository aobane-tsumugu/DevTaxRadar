import { compareAnnualMethods, type MethodScenario } from '../core/annualMethodComparison.js'

export type SoftwareMethodForm = {
  accountId: string; acquisitionMovementId: string; method: string; usedOn: string; life: string
  rental: string; business: boolean; ordinary: boolean; rounding: boolean; evidenceIds: string[]
  specialEligibility: string; specialUsedJpy: string; businessMonths: string; statementReady: string
  reason: string; year: string; decisionId: string; ordinaryYear: boolean; endYear: string; endReason: string
}
const textFields = ['accountId','acquisitionMovementId','method','usedOn','life','rental','specialEligibility','specialUsedJpy','businessMonths','statementReady','reason','year','decisionId','endYear','endReason'] as const
const flags = ['business','ordinary','rounding','ordinaryYear'] as const
export function validSoftwareMethodForm(value: unknown): value is SoftwareMethodForm {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>, fields: string[] = [...textFields, ...flags, 'evidenceIds']
  return Object.keys(record).length === fields.length && Object.keys(record).every((key) => fields.includes(key)) &&
    textFields.every((key) => typeof record[key] === 'string' && record[key].length <= 2000) && flags.every((key) => typeof record[key] === 'boolean') &&
    Array.isArray(record.evidenceIds) && record.evidenceIds.length <= 100 && record.evidenceIds.every((id) => typeof id === 'string' && id.length <= 120) && new Set(record.evidenceIds).size === record.evidenceIds.length
}
const tri = (value: string): boolean | null => value === 'yes' ? true : value === 'no' ? false : null
const integer = (value: string): number | null => { if (!/^\d+$/.test(value.trim())) return null; const parsed = Number(value.trim()); return Number.isSafeInteger(parsed) ? parsed : null }
export function softwareMethodAlternatives(form: SoftwareMethodForm, amountJpy: number, acquiredOn: string, profile: { filingType: string; incomeCategory: string }): MethodScenario[] {
  const acquiredYear = Number(acquiredOn.slice(0, 4)), throughYear = Number(form.year)
  if (!/^\d{4}$/.test(form.year) || throughYear < acquiredYear) return []
  return compareAnnualMethods(amountJpy, {
    assetKind: 'software', contributionIds: [form.acquisitionMovementId], scopeBasis: '', completeCostConfirmed: form.business ? true : null,
    businessOnly: form.business ? true : null, acquiredOn, usedOn: form.usedOn || null, usefulLifeYears: form.life === '' ? null : Number(form.life),
    taxpayer: form.ordinary ? 'individual' : 'unknown', ordinaryConditions: form.ordinary ? true : null,
    rentalUse: ['none','primary-business','other'].includes(form.rental) ? form.rental as 'none' | 'primary-business' | 'other' : 'unknown',
    throughYear, eligibleSmallBusiness: tri(form.specialEligibility), annualSpecialUsedJpy: integer(form.specialUsedJpy),
    businessMonths: integer(form.businessMonths), statementReady: tri(form.statementReady), roundingConfirmed: form.rounding, reason: form.reason,
  }, profile, form.accountId, acquiredYear).scenarios
}
