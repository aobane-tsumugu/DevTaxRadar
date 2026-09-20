/** Raw control values preserve unfinished dates/numbers instead of silently turning them into zero. */
export type SoftwareMethodForm = {
  accountId: string; acquisitionMovementId: string; method: string; usedOn: string; life: string
  rental: string; business: boolean; ordinary: boolean; rounding: boolean; evidenceIds: string[]
  reason: string; year: string; decisionId: string; ordinaryYear: boolean; endYear: string; endReason: string
}
export function validSoftwareMethodForm(value: unknown): value is SoftwareMethodForm {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return ['accountId','acquisitionMovementId','method','usedOn','life','rental','reason','year','decisionId','endYear','endReason']
    .every((key) => typeof record[key] === 'string' && record[key].length <= 2000) &&
    ['business','ordinary','rounding','ordinaryYear'].every((key) => typeof record[key] === 'boolean') &&
    Array.isArray(record.evidenceIds) && record.evidenceIds.length <= 100 &&
    record.evidenceIds.every((id) => typeof id === 'string' && id.length <= 120)
}
