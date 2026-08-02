export function displayMonth(month: string | undefined): string {
  if (!month) return ''
  const parsed = month.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if (!parsed) return month
  return `${parsed[1]}年${Number(parsed[2])}月`
}
