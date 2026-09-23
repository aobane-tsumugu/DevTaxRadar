import type { LocalSessionReference, NormalizedUsage, UsageProvider } from '../adapters/types.ts'

export type UsageSession = {
  provider: UsageProvider
  sessionKey: string
  projectKey: string
  month: string
  startedAt: string
  endedAt: string
  messageCount: number
  projectLabel?: string
  model?: string
  localReference?: LocalSessionReference
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  schemaVersion: string
  confidence: 'high' | 'medium' | 'low'
}

export type AggregationDiagnostics = { nonUtcTimestamps: number }
const confidenceByGrade = { A: 'high', B: 'medium', C: 'low' } as const
const confidenceRank = { high: 0, medium: 1, low: 2 }

/** Month summaries are for storage/listing; cost attribution can use the matching event cache. */
export function aggregateSessions(
  events: NormalizedUsage[],
  diagnostics?: AggregationDiagnostics,
): UsageSession[] {
  const byKey = new Map<string, UsageSession>()
  for (const event of events) {
    if (diagnostics && !event.observedAt.endsWith('Z')) diagnostics.nonUtcTimestamps++
    const timestamp = new Date(event.observedAt)
    if (!Number.isFinite(timestamp.getTime())) throw new Error('利用記録の時刻を確認してください。')
    const observedAt = timestamp.toISOString()
    const key = JSON.stringify([event.provider, event.sessionKey, event.projectKey, event.month])
    const outputTokens = event.outputTokens + event.reasoningTokens
    const current = byKey.get(key)
    if (!current) {
      byKey.set(key, {
        provider: event.provider,
        sessionKey: event.sessionKey,
        projectKey: event.projectKey,
        month: event.month,
        startedAt: observedAt,
        endedAt: observedAt,
        messageCount: 1,
        projectLabel: event.projectLabel,
        model: event.model,
        localReference: event.localReference,
        inputTokens: event.inputTokens,
        outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        schemaVersion: event.schemaVersion,
        confidence: confidenceByGrade[event.confidence],
      })
      continue
    }
    current.messageCount++
    current.inputTokens += event.inputTokens
    current.outputTokens += outputTokens
    current.cacheReadTokens += event.cacheReadTokens
    current.cacheWriteTokens += event.cacheWriteTokens
    if (observedAt < current.startedAt) current.startedAt = observedAt
    if (observedAt > current.endedAt) current.endedAt = observedAt
    current.projectLabel ??= event.projectLabel
    current.localReference ??= event.localReference
    if (confidenceRank[confidenceByGrade[event.confidence]] > confidenceRank[current.confidence])
      current.confidence = confidenceByGrade[event.confidence]
  }
  return [...byKey.values()]
}
