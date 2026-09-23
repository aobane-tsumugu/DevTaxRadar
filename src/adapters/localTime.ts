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

// Zone offsets are whole multiples of 15 minutes, so local midnight and every offset change
// fall on a 15-minute UTC boundary: all instants inside one such bucket share a local date.
// The dashboard asks for the date of every dated usage row on every read (measured 6s of a
// 9.5s read for 480 sessions), and those rows cluster into far fewer buckets.
const QUARTER_HOUR_MS = 15 * 60 * 1000
const MAX_CACHED_BUCKETS = 500_000
const dateCache = new Map<string, Map<number, string | undefined>>()

/** Formats an instant as YYYY-MM-DD in the given zone. Tax records follow the local calendar. */
export function localDateFromTimestamp(
  value: unknown,
  timeZone: string = resolvedTimeZone(),
): string | undefined {
  if (typeof value !== 'string') return undefined
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return undefined
  const bucket = Math.floor(time / QUARTER_HOUR_MS)
  let zoneCache = dateCache.get(timeZone)
  if (zoneCache?.has(bucket)) return zoneCache.get(bucket)
  const date = formatLocalDate(new Date(time), timeZone)
  // Historical zones with odd offsets can change date inside a bucket; cache only when the
  // bucket's first and last instant agree.
  const start = bucket * QUARTER_HOUR_MS
  if (
    formatLocalDate(new Date(start), timeZone) !== date ||
    formatLocalDate(new Date(start + QUARTER_HOUR_MS - 1), timeZone) !== date
  )
    return date
  if (!zoneCache || zoneCache.size >= MAX_CACHED_BUCKETS) {
    zoneCache = new Map()
    dateCache.set(timeZone, zoneCache)
  }
  zoneCache.set(bucket, date)
  return date
}

function formatLocalDate(parsed: Date, timeZone: string): string | undefined {
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
