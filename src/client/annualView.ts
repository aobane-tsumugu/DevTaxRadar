import type { DashboardData } from './types'

/** Missing year information stays missing; never assign it to the selected year. */
export function billingMonthKey(row: {
  monthKey?: string
  label?: string
  month?: string
}): string | undefined {
  if (row.monthKey && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.monthKey)) return row.monthKey
  const match = /^(\d{4})年(\d{1,2})月$/.exec(row.label ?? row.month ?? '')
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return undefined
  return match[1] + '-' + match[2]!.padStart(2, '0')
}
export function belongsToYear(
  row: { monthKey?: string; label?: string; month?: string },
  year: number,
): boolean {
  return billingMonthKey(row)?.startsWith(String(year) + '-') ?? false
}
export function annualAiView(data: DashboardData, year: number) {
  return {
    months: data.months.filter((row) => belongsToYear(row, year)),
    allocations: data.allocations.filter((row) => belongsToYear(row, year)),
    undatedMonths: data.months.filter((row) => !billingMonthKey(row)).length,
  }
}
