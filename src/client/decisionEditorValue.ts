import type { DecisionRecord } from '../planning/types.js'

export type DecisionEditorValue = {
  decisions: DecisionRecord[]
  originals: Array<{ id: string; value: DecisionRecord | null }>
  yearInputs: Array<{ id: string; raw: string }>
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
const identifier = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 120
const decision = (value: unknown): value is DecisionRecord => {
  if (!object(value)) return false
  const keys = new Set([
    'id',
    'taxUnitId',
    'taxYear',
    'engineVersion',
    'candidate',
    'status',
    'selectedCandidate',
    'reason',
    'createdAt',
    'confirmedAt',
    'treatmentBinding',
    'softwareAnnualBinding',
  ])
  if (Object.keys(value).some((key) => !keys.has(key))) return false
  if (
    !identifier(value.id) ||
    !text(value.taxUnitId, 120) ||
    typeof value.taxYear !== 'number' ||
    !Number.isInteger(value.taxYear) ||
    !identifier(value.engineVersion) ||
    !text(value.candidate, 160) ||
    !['pending', 'confirmed', 'overridden'].includes(String(value.status)) ||
    (value.selectedCandidate !== undefined && !text(value.selectedCandidate, 160)) ||
    (value.reason !== undefined && !text(value.reason, 2000)) ||
    !text(value.createdAt, 80) ||
    !Number.isFinite(Date.parse(String(value.createdAt))) ||
    (value.confirmedAt !== undefined &&
      (!text(value.confirmedAt, 80) || !Number.isFinite(Date.parse(String(value.confirmedAt)))))
  )
    return false
  for (const key of ['treatmentBinding', 'softwareAnnualBinding'])
    if (value[key] !== undefined && !object(value[key])) return false
  return true
}

export function validDecisionEditorValue(value: unknown): value is DecisionEditorValue {
  if (
    !object(value) ||
    !Array.isArray(value.decisions) ||
    !Array.isArray(value.originals) ||
    !Array.isArray(value.yearInputs) ||
    Object.keys(value).some((key) => !['decisions', 'originals', 'yearInputs'].includes(key))
  )
    return false
  if (value.decisions.length > 20_000 || !value.decisions.every(decision)) return false
  const originals = new Set<string>()
  for (const item of value.originals) {
    if (
      !object(item) ||
      Object.keys(item).sort().join(',') !== 'id,value' ||
      !identifier(item.id) ||
      (item.value !== null && !decision(item.value)) ||
      originals.has(item.id as string)
    )
      return false
    originals.add(item.id as string)
  }
  const years = new Set<string>()
  for (const item of value.yearInputs) {
    if (
      !object(item) ||
      Object.keys(item).sort().join(',') !== 'id,raw' ||
      !identifier(item.id) ||
      typeof item.raw !== 'string' ||
      item.raw.length > 32 ||
      years.has(item.id as string)
    )
      return false
    years.add(item.id as string)
  }
  return true
}

export function canonicalDecisionEditorValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalDecisionEditorValue).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonicalDecisionEditorValue(item))
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'null'
}
