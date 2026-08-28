export type ChargeProvider = 'claude' | 'codex'

export type ProviderChargePeriod = {
  id: string
  provider: ChargeProvider
  planName: string
  serviceStartedOn: string
  serviceEndedOn: string
  billedOn?: string
  amountJpy: number
  note?: string
}

const DAY_MS = 86_400_000

export function validIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
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
    Number.isInteger(period.amountJpy) &&
    period.amountJpy >= 0,
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
): Array<{ provider: ChargeProvider; month: string; amountJpy: number }> {
  const start = utcDay(period.serviceStartedOn)
  const end = utcDay(period.serviceEndedOn)
  if (start === undefined || end === undefined || start > end || period.amountJpy < 0) return []

  const daysByMonth = new Map<string, number>()
  for (let day = start; day <= end; day += DAY_MS) {
    const month = monthKey(day)
    daysByMonth.set(month, (daysByMonth.get(month) ?? 0) + 1)
  }
  const totalDays = [...daysByMonth.values()].reduce((sum, days) => sum + days, 0)
  const allocations = [...daysByMonth].map(([month, days]) => {
    const exact = (period.amountJpy * days) / totalDays
    const amountJpy = Math.floor(exact)
    return { provider: period.provider, month, amountJpy, remainder: exact - amountJpy }
  })
  let remaining = period.amountJpy - allocations.reduce((sum, item) => sum + item.amountJpy, 0)
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
): Array<{ provider: ChargeProvider; month: string; amountJpy: number }> {
  const totals = new Map<string, { provider: ChargeProvider; month: string; amountJpy: number }>()
  for (const period of periods) {
    for (const amount of monthlyAmountsForCharge(period)) {
      const key = `${amount.provider}:${amount.month}`
      const current = totals.get(key)
      totals.set(key, {
        provider: amount.provider,
        month: amount.month,
        amountJpy: (current?.amountJpy ?? 0) + amount.amountJpy,
      })
    }
  }
  return [...totals.values()].sort(
    (left, right) =>
      left.month.localeCompare(right.month) || left.provider.localeCompare(right.provider),
  )
}
