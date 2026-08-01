const formatterCache = new Map<string, Intl.DateTimeFormat>()

// Process-lifetime cache: the host time zone cannot change while this
// process is running, and constructing Intl.DateTimeFormat().resolvedOptions()
// on every call was measured to cost ~2.9s across 46,004 events when this
// function is invoked as a default argument once per event.
let cachedZone: string | undefined

export function resolvedTimeZone(): string {
  return (cachedZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone)
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  formatterCache.set(timeZone, created)
  return created
}

/** Formats an instant as YYYY-MM-DD in the given zone. Tax records follow the local calendar. */
export function localDateFromTimestamp(
  value: unknown,
  timeZone: string = resolvedTimeZone(),
): string | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined

  const parts = formatter(timeZone).formatToParts(parsed)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  if (!year || !month || !day) return undefined
  return `${year}-${month}-${day}`
}

export function localMonthFromTimestamp(
  value: unknown,
  timeZone: string = resolvedTimeZone(),
): string | undefined {
  return localDateFromTimestamp(value, timeZone)?.slice(0, 7)
}
