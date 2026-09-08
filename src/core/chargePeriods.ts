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
}
export type ProviderChargePeriod = ChargeContractBasis & {
  contractConfirmation?: ChargeContractConfirmation
}

/** Explicit whitelist keeps the confirmation out of its own snapshot. */
export function chargeContractBasis(period: ProviderChargePeriod): ChargeContractBasis {
  return {
    id: period.id, provider: period.provider, planName: period.planName.trim(),
    serviceStartedOn: period.serviceStartedOn, serviceEndedOn: period.serviceEndedOn,
    amountJpy: period.amountJpy,
    ...(period.billedOn ? { billedOn: period.billedOn } : {}),
    ...(period.unknownAmountReason ? { unknownAmountReason: period.unknownAmountReason.trim() } : {}),
    ...(period.note?.trim() ? { note: period.note.trim() } : {}),
    evidenceIds: [...(period.evidenceIds ?? [])].sort(),
  }
}
export function chargeContractStatus(period: ProviderChargePeriod): 'unreviewed' | 'draft' | 'changed' | 'confirmed' {
  const confirmation = period.contractConfirmation
  if (!confirmation) return 'unreviewed'
  if (!confirmation.confirmedAt || !confirmation.reference.trim() || !confirmation.reason.trim()) return 'draft'
  return JSON.stringify(chargeContractBasis(period)) === JSON.stringify(chargeContractBasis(confirmation.basis)) ? 'confirmed' : 'changed'
}
export function distinctChargeContracts(periods: readonly ProviderChargePeriod[]): boolean {
  return periods.length > 1 && periods.every((period) => chargeContractStatus(period) === 'confirmed') &&
    new Set(periods.map((period) => period.contractConfirmation!.reference.trim())).size === periods.length
}
export function chargeContractMessage(period: ProviderChargePeriod): string | undefined {
  const record = period.contractConfirmation
  if (!record) return undefined
  const status = chargeContractStatus(period)
  const label = status === 'confirmed' ? '契約との対応を確認済み' : status === 'changed' ? '請求内容変更のため契約との対応を再確認してください' : '契約との対応は確認途中'
  return `${label}。契約の呼び名：${record.reference || '未入力'}。理由：${record.reason || '未入力'}。確認日時：${record.confirmedAt ?? '未確認'}。`
}

const DAY_MS = 86_400_000

/** Matching known charges are review candidates, never instructions to delete or merge. */
export function duplicateChargeGroups(periods: readonly ProviderChargePeriod[]): string[][] {
  const groups = new Map<string, Set<string>>()
  for (const period of periods) {
    if (period.amountJpy === null || !chargePeriodIsValid(period)) continue
    const key = JSON.stringify([
      period.provider,
      period.serviceStartedOn,
      period.serviceEndedOn,
      period.amountJpy,
    ])
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

/** Connected overlapping intervals, not a claim that every pair overlaps. End dates are inclusive. */
export function overlappingChargeGroups(periods: readonly ProviderChargePeriod[]): string[][] {
  const groups: string[][] = []
  for (const provider of ['claude', 'codex'] as const) {
    const rows = periods
      .filter(
        (row) =>
          row.provider === provider &&
          validIsoCalendarDate(row.serviceStartedOn) &&
          validIsoCalendarDate(row.serviceEndedOn) &&
          row.serviceStartedOn <= row.serviceEndedOn,
      )
      .sort(
        (a, b) => a.serviceStartedOn.localeCompare(b.serviceStartedOn) || a.id.localeCompare(b.id),
      )
    let ids = new Set<string>(),
      end = ''
    const flush = () => {
      if (ids.size > 1) groups.push([...ids].sort())
    }
    for (const row of rows) {
      if (row.serviceStartedOn > end) {
        flush()
        ids = new Set()
        end = ''
      }
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
    if (!Number.isInteger(year) || year < 0 || year > 9999)
      throw new RangeError('Invalid charge review year')
    const label = String(year).padStart(4, '0')
    periods = periods.filter(
      (row) => row.serviceStartedOn <= `${label}-12-31` && row.serviceEndedOn >= `${label}-01-01`,
    )
  }
  const duplicates = duplicateChargeGroups(periods)
  const exact = new Set(duplicates.map((ids) => JSON.stringify(ids)))
  return [
    ...duplicates.map((ids) => ({ kind: 'duplicate' as const, ids })),
    ...overlappingChargeGroups(periods)
      .filter((ids) => !exact.has(JSON.stringify(ids)))
      .map((ids) => ({ kind: 'overlap' as const, ids })),
  ]
}

function utcDay(value: string): number | undefined {
  if (!validIsoCalendarDate(value)) return undefined
  return Date.parse(`${value}T00:00:00.000Z`)
}

function monthKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 7)
}

export function chargePeriodIsValid(period: ProviderChargePeriod): boolean {
  const start = utcDay(period.serviceStartedOn)
  const end = utcDay(period.serviceEndedOn)
  return Boolean(
    start !== undefined &&
    end !== undefined &&
    start <= end &&
    (period.amountJpy === null
      ? Boolean(period.unknownAmountReason?.trim())
      : Number.isSafeInteger(period.amountJpy) &&
        period.amountJpy >= 0 &&
        !period.unknownAmountReason),
  )
}

export function chargePeriodCoversDate(period: ProviderChargePeriod, date: string): boolean {
  return period.serviceStartedOn <= date && date <= period.serviceEndedOn
}

export function chargePeriodCoversMonth(period: ProviderChargePeriod, month: string): boolean {
  const monthStart = `${month}-01`
  const [year, monthNumber] = month.split('-').map(Number)
  if (!year || !monthNumber) return false
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10)
  return period.serviceStartedOn < nextMonth && period.serviceEndedOn >= monthStart
}

/** Split one actual charge across calendar months while preserving its exact yen total. */
export function monthlyAmountsForCharge(
  period: ProviderChargePeriod,
): Array<{ provider: ChargeProvider; month: string; amountJpy: number | null }> {
  const start = utcDay(period.serviceStartedOn)
  const end = utcDay(period.serviceEndedOn)
  if (start === undefined || end === undefined || !chargePeriodIsValid(period)) return []

  const daysByMonth = new Map<string, number>()
  for (let day = start; day <= end; day += DAY_MS) {
    const month = monthKey(day)
    daysByMonth.set(month, (daysByMonth.get(month) ?? 0) + 1)
  }
  const totalDays = [...daysByMonth.values()].reduce((sum, days) => sum + days, 0)
  const originalAmount = period.amountJpy
  if (originalAmount === null)
    return [...daysByMonth.keys()].map((month) => ({
      provider: period.provider,
      month,
      amountJpy: null,
    }))
  const allocations = [...daysByMonth].map(([month, days]) => {
    const exact = (originalAmount * days) / totalDays
    const amountJpy = Math.floor(exact)
    return { provider: period.provider, month, amountJpy, remainder: exact - amountJpy }
  })
  let remaining = originalAmount - allocations.reduce((sum, item) => sum + item.amountJpy, 0)
  for (const item of [...allocations].sort(
    (left, right) => right.remainder - left.remainder || left.month.localeCompare(right.month),
  )) {
    if (remaining <= 0) break
    item.amountJpy += 1
    remaining -= 1
  }
  return allocations.map(({ provider, month, amountJpy }) => ({ provider, month, amountJpy }))
}

export function monthlyAmountsForCharges(
  periods: ProviderChargePeriod[],
): Array<{ provider: ChargeProvider; month: string; amountJpy: number | null }> {
  const totals = new Map<
    string,
    { provider: ChargeProvider; month: string; amountJpy: number | null }
  >()
  for (const period of periods) {
    for (const amount of monthlyAmountsForCharge(period)) {
      const key = `${amount.provider}:${amount.month}`
      const current = totals.get(key)
      totals.set(key, {
        provider: amount.provider,
        month: amount.month,
        amountJpy:
          current?.amountJpy === null || amount.amountJpy === null
            ? null
            : (current?.amountJpy ?? 0) + amount.amountJpy,
      })
    }
  }
  return [...totals.values()].sort(
    (left, right) =>
      left.month.localeCompare(right.month) || left.provider.localeCompare(right.provider),
  )
}
