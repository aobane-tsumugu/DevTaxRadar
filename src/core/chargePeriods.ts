import type { ChargeUsageScope } from './contractUsage.js'

export type ChargeProvider = 'claude' | 'codex'

export type ChargeContractBasis = {
  id: string
  provider: ChargeProvider
  planName: string
  serviceStartedOn: string
  serviceEndedOn: string
  billedOn?: string
  amountJpy: number | null
  unknownAmountReason?: string
  note?: string
  evidenceIds?: string[]
}

export type ChargeContractConfirmation = {
  reference: string
  reason: string
  confirmedAt?: string
  basis: ChargeContractBasis
  usageScope?: ChargeUsageScope
}

export type ProviderChargePeriod = ChargeContractBasis & {
  contractConfirmation?: ChargeContractConfirmation
}

/** Explicit whitelist keeps the correspondence out of its own invoice snapshot. */
export function chargeContractBasis(period: ProviderChargePeriod): ChargeContractBasis {
  return {
    id: period.id,
    provider: period.provider,
    planName: period.planName.trim(),
    serviceStartedOn: period.serviceStartedOn,
    serviceEndedOn: period.serviceEndedOn,
    amountJpy: period.amountJpy,
    ...(period.billedOn ? { billedOn: period.billedOn } : {}),
    ...(period.unknownAmountReason ? { unknownAmountReason: period.unknownAmountReason.trim() } : {}),
    ...(period.note?.trim() ? { note: period.note.trim() } : {}),
    evidenceIds: [...(period.evidenceIds ?? [])].sort(),
  }
}

export function chargeContractStatus(
  period: ProviderChargePeriod,
): 'unreviewed' | 'draft' | 'changed' | 'confirmed' {
  const confirmation = period.contractConfirmation
  if (!confirmation) return 'unreviewed'
  if (!confirmation.confirmedAt || !confirmation.reference.trim() || !confirmation.reason.trim()) return 'draft'
  return JSON.stringify(chargeContractBasis(period)) === JSON.stringify(chargeContractBasis(confirmation.basis))
    ? 'confirmed' : 'changed'
}

export function distinctChargeContracts(periods: readonly ProviderChargePeriod[]): boolean {
  return periods.length > 1 &&
    periods.every((period) => chargeContractStatus(period) === 'confirmed') &&
    new Set(periods.map((period) => period.contractConfirmation!.reference.trim())).size === periods.length
}

export function chargeContractMessage(period: ProviderChargePeriod): string | undefined {
  const record = period.contractConfirmation
  if (!record) return undefined
  const status = chargeContractStatus(period)
  const label = status === 'confirmed' ? '契約との対応を確認済み'
    : status === 'changed' ? '請求内容変更のため契約との対応を再確認してください'
      : '契約との対応は確認途中'
  return `${label}。契約の呼び名：${record.reference || '未入力'}。理由：${record.reason || '未入力'}。確認日時：${record.confirmedAt ?? '未確認'}。`
}

const DAY_MS = 86_400_000

/** Matching known charges are review candidates, never instructions to delete or merge. */
export function duplicateChargeGroups(periods: readonly ProviderChargePeriod[]): string[][] {
  const groups = new Map<string, Set<string>>()
  for (const period of periods) {
    if (period.amountJpy === null || !chargePeriodIsValid(period)) continue
    const key = JSON.stringify([period.provider, period.serviceStartedOn, period.serviceEndedOn, period.amountJpy])
    const ids = groups.get(key) ?? new Set<string>()
    ids.add(period.id)
    groups.set(key, ids)
  }
  return [...groups.values()].filter((ids) => ids.size > 1).map((ids) => [...ids].sort())
}

export function validIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

/** Connected overlapping intervals. End dates are inclusive; not every pair must overlap. */
export function overlappingChargeGroups(periods: readonly ProviderChargePeriod[]): string[][] {
  const groups: string[][] = []
  for (const provider of ['claude', 'codex'] as const) {
    const rows = periods.filter((row) => row.provider === provider &&
      validIsoCalendarDate(row.serviceStartedOn) && validIsoCalendarDate(row.serviceEndedOn) &&
      row.serviceStartedOn <= row.serviceEndedOn)
      .sort((a, b) => a.serviceStartedOn.localeCompare(b.serviceStartedOn) || a.id.localeCompare(b.id))
    let ids = new Set<string>()
    let end = ''
    const flush = () => { if (ids.size > 1) groups.push([...ids].sort()) }
    for (const row of rows) {
      if (row.serviceStartedOn > end) { flush(); ids = new Set(); end = '' }
      ids.add(row.id)
      if (row.serviceEndedOn > end) end = row.serviceEndedOn
    }
    flush()
  }
  return groups
}

export function chargeReviewGroups(
  periods: readonly ProviderChargePeriod[],
  year?: number,
): { kind: 'duplicate' | 'overlap'; ids: string[] }[] {
  if (year !== undefined) {
    if (!Number.isInteger(year) || year < 0 || year > 9999) throw new RangeError('Invalid charge review year')
    const label = String(year).padStart(4, '0')
    periods = periods.filter((row) => row.serviceStartedOn <= `${label}-12-31` && row.serviceEndedOn >= `${label}-01-01`)
  }
  const duplicates = duplicateChargeGroups(periods)
  const exact = new Set(duplicates.map((ids) => JSON.stringify(ids)))
  return [
    ...duplicates.map((ids) => ({ kind: 'duplicate' as const, ids })),
    ...overlappingChargeGroups(periods).filter((ids) => !exact.has(JSON.stringify(ids)))
      .map((ids) => ({ kind: 'overlap' as const, ids })),
  ]
}

function utcDay(value: string): number | undefined {
  return validIsoCalendarDate(value) ? Date.parse(`${value}T00:00:00.000Z`) : undefined
}

export function chargePeriodIsValid(period: ProviderChargePeriod): boolean {
  const start = utcDay(period.serviceStartedOn)
  const end = utcDay(period.serviceEndedOn)
  return start !== undefined && end !== undefined && start <= end &&
    (period.amountJpy === null ? Boolean(period.unknownAmountReason?.trim())
      : Number.isSafeInteger(period.amountJpy) && period.amountJpy >= 0 && !period.unknownAmountReason)
}

export function chargePeriodCoversDate(period: ProviderChargePeriod, date: string): boolean {
  return period.serviceStartedOn <= date && date <= period.serviceEndedOn
}

export function chargePeriodCoversMonth(period: ProviderChargePeriod, month: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false
  const start = Date.parse(`${month}-01T00:00:00.000Z`)
  const next = new Date(start)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const periodStart = utcDay(period.serviceStartedOn)
  const periodEnd = utcDay(period.serviceEndedOn)
  return periodStart !== undefined && periodEnd !== undefined &&
    periodStart < next.getTime() && periodEnd >= start
}

/** Exact day-based invoice proration, in O(months), without floating-point yen loss. */
export function monthlyAmountsForCharge(
  period: ProviderChargePeriod,
): Array<{ provider: ChargeProvider; month: string; amountJpy: number | null }> {
  const start = utcDay(period.serviceStartedOn)
  const end = utcDay(period.serviceEndedOn)
  if (start === undefined || end === undefined || !chargePeriodIsValid(period)) return []
  const months: Array<{ month: string; days: number }> = []
  for (let cursor = start; cursor <= end;) {
    const next = new Date(cursor)
    next.setUTCDate(1)
    next.setUTCMonth(next.getUTCMonth() + 1)
    const last = Math.min(end, next.getTime() - DAY_MS)
    months.push({ month: new Date(cursor).toISOString().slice(0, 7), days: (last - cursor) / DAY_MS + 1 })
    cursor = last + DAY_MS
  }
  const original = period.amountJpy
  if (original === null) return months.map(({ month }) => ({ provider: period.provider, month, amountJpy: null }))
  const denominator = BigInt((end - start) / DAY_MS + 1)
  const rows = months.map(({ month, days }) => {
    const numerator = BigInt(original) * BigInt(days)
    return { provider: period.provider, month, amountJpy: Number(numerator / denominator), remainder: numerator % denominator }
  })
  let remaining = original - rows.reduce((sum, row) => sum + row.amountJpy, 0)
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder
    ? a.month.localeCompare(b.month) : a.remainder > b.remainder ? -1 : 1)
  for (const row of ranked) {
    if (remaining <= 0) break
    row.amountJpy++
    remaining--
  }
  return rows.map(({ provider, month, amountJpy }) => ({ provider, month, amountJpy }))
}

export function monthlyAmountsForCharges(
  periods: ProviderChargePeriod[],
): Array<{ provider: ChargeProvider; month: string; amountJpy: number | null }> {
  const totals = new Map<string, { provider: ChargeProvider; month: string; amountJpy: number | null }>()
  for (const period of periods) {
    for (const amount of monthlyAmountsForCharge(period)) {
      const key = `${amount.provider}:${amount.month}`
      const current = totals.get(key)
      const amountJpy = current?.amountJpy === null || amount.amountJpy === null
        ? null : (current?.amountJpy ?? 0) + amount.amountJpy
      if (amountJpy !== null && !Number.isSafeInteger(amountJpy)) throw new RangeError('Monthly charge total exceeds exact yen range')
      totals.set(key, { provider: amount.provider, month: amount.month, amountJpy })
    }
  }
  return [...totals.values()].sort((a, b) => a.month.localeCompare(b.month) || a.provider.localeCompare(b.provider))
}
