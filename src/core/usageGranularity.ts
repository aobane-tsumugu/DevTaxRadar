import { localMonthFromTimestamp } from '../adapters/localTime.js'
import type { NormalizedUsage } from '../adapters/types.js'
import type { RecordedObservation } from '../accounting/observationRecord.js'

export type UsageObservation = RecordedObservation & {
  sourceName: string
  projectLabel: string | null
  model: string | null
  timePrecision?: 'instant' | 'interval' | 'unknown'
  eventRef?: string
}
export type ObservationCache = {
  sourceId: string
  provider: 'claude' | 'codex'
  fileKey: string
  events: unknown
}

export function observationGroupKey(row: Pick<RecordedObservation, 'sourceId' | 'provider' | 'sessionKey' | 'projectKey' | 'month'>): string {
  return JSON.stringify([row.sourceId, row.provider, row.sessionKey, row.projectKey, row.month])
}

/** Stable identity shared by month summaries and their exact per-event expansion. */
export function collapseObservations(rows: readonly RecordedObservation[]): RecordedObservation[] {
  const result = new Map<string, RecordedObservation>()
  for (const row of rows) {
    const key = observationGroupKey(row), previous = result.get(key)
    const canonicalTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value
    const startedAt = canonicalTime(row.startedAt), endedAt = canonicalTime(row.endedAt)
    const current: RecordedObservation = previous ?? {
      sourceId: row.sourceId, provider: row.provider, sessionKey: row.sessionKey,
      projectKey: row.projectKey, month: row.month, startedAt, endedAt,
      messageCount: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    }
    current.messageCount += row.messageCount
    current.inputTokens += row.inputTokens
    current.outputTokens += row.outputTokens
    current.cacheReadTokens += row.cacheReadTokens
    current.cacheWriteTokens += row.cacheWriteTokens
    if (startedAt < current.startedAt) current.startedAt = startedAt
    if (endedAt > current.endedAt) current.endedAt = endedAt
    for (const count of [current.messageCount, current.inputTokens, current.outputTokens, current.cacheReadTokens, current.cacheWriteTokens])
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('取得値の合計が扱える整数を超えました。')
    result.set(key, current)
  }
  return [...result].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row)
}

function decoded(value: unknown, provider: string): NormalizedUsage[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((row) => row && typeof row === 'object' && row.provider === provider &&
    ['sessionKey', 'projectKey', 'observedAt', 'schemaVersion'].every((key) => typeof row[key] === 'string') &&
    Number.isFinite(Date.parse(row.observedAt)) &&
    ['inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'].every((key) =>
      Number.isSafeInteger(row[key]) && row[key] >= 0))) return undefined
  return value as NormalizedUsage[]
}

/**
 * Only expand a complete cache that reconciles exactly to the authoritative
 * stored month summary. A stale/partial cache can never overwrite totals.
 */
export function expandUsageObservations(
  summaries: readonly UsageObservation[],
  caches: readonly ObservationCache[],
  monthOf: (timestamp: string) => string | undefined = localMonthFromTimestamp,
): UsageObservation[] {
  const byGroup = new Map(summaries.map((row) => [observationGroupKey(row), row]))
  const points = new Map<string, UsageObservation[]>()
  const seen = new Set<string>()
  for (const cached of [...caches].sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId) || a.fileKey.localeCompare(b.fileKey))) {
    const events = decoded(cached.events, cached.provider)
    if (!events) continue
    for (const event of events) {
      const month = monthOf(event.observedAt)
      if (!month) continue
      const key = observationGroupKey({ ...event, sourceId: cached.sourceId, month })
      const summary = byGroup.get(key)
      if (!summary) continue
      if (event.eventKey) {
        const identity = JSON.stringify([cached.sourceId, cached.provider, event.eventKey])
        if (seen.has(identity)) continue
        seen.add(identity)
      }
      const instant = new Date(event.observedAt).toISOString()
      const outputTokens = event.outputTokens + event.reasoningTokens
      if (!Number.isSafeInteger(outputTokens)) continue
      const row: UsageObservation = {
        sourceId: summary.sourceId, sourceName: summary.sourceName,
        provider: event.provider, sessionKey: event.sessionKey, projectKey: event.projectKey,
        projectLabel: summary.projectLabel, model: typeof event.model === 'string' ? event.model : summary.model,
        month, startedAt: instant, endedAt: instant, messageCount: 1,
        inputTokens: event.inputTokens, outputTokens,
        cacheReadTokens: event.cacheReadTokens, cacheWriteTokens: event.cacheWriteTokens,
        timePrecision: event.provider === 'codex' && event.schemaVersion !== 'codex-local-v2' ? 'unknown' : 'instant',
        ...(typeof event.eventKey === 'string' && /^message_[a-f0-9]{24}$/.test(event.eventKey) ? { eventRef: event.eventKey } : {}),
      }
      const group = points.get(key)
      if (group) group.push(row)
      else points.set(key, [row])
    }
  }
  return summaries.flatMap((summary) => {
    const rows = points.get(observationGroupKey(summary))
    if (rows && JSON.stringify(collapseObservations(rows)) === JSON.stringify(collapseObservations([summary])))
      return rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || (a.eventRef ?? '').localeCompare(b.eventRef ?? ''))
    return [{
      ...summary,
      timePrecision: summary.provider === 'codex' ? 'unknown' as const : 'interval' as const,
    }]
  })
}
