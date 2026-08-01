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

export type AggregationDiagnostics = {
  nonUtcTimestamps: number
}

const confidenceByGrade = { A: 'high', B: 'medium', C: 'low' } as const

/**
 * Folds message-level events into one row per session, project and month.
 * A session that crosses a month boundary stays split, because the monthly
 * fee is allocated per calendar month.
 */
export function aggregateSessions(
  events: NormalizedUsage[],
  diagnostics?: AggregationDiagnostics,
): UsageSession[] {
  const byKey = new Map<string, UsageSession>()

  for (const event of events) {
    // Zサフィックスでない時刻が来ると文字列比較の順序が狂うため、検出できるようにしている
    if (diagnostics && !event.observedAt.endsWith('Z')) {
      diagnostics.nonUtcTimestamps += 1
    }

    const key = `${event.provider}:${event.sessionKey}:${event.projectKey}:${event.month}`
    const current = byKey.get(key)
    const outputTokens = event.outputTokens + event.reasoningTokens

    if (!current) {
      byKey.set(key, {
        provider: event.provider,
        sessionKey: event.sessionKey,
        projectKey: event.projectKey,
        month: event.month,
        startedAt: event.observedAt,
        endedAt: event.observedAt,
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

    current.messageCount += 1
    current.inputTokens += event.inputTokens
    current.outputTokens += outputTokens
    current.cacheReadTokens += event.cacheReadTokens
    current.cacheWriteTokens += event.cacheWriteTokens
    if (event.observedAt < current.startedAt) current.startedAt = event.observedAt
    if (event.observedAt > current.endedAt) current.endedAt = event.observedAt
    current.projectLabel ??= event.projectLabel
    current.localReference ??= event.localReference
  }

  return [...byKey.values()]
}
