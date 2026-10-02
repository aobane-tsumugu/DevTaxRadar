import type { DatabaseSync } from 'node:sqlite'
import { expandUsageObservations, type UsageObservation } from '../core/usageGranularity.js'
import { selectCodexFileContributions } from '../core/codexFileSelection.js'
import { parseCachedEvents } from './database.js'

/** Reads numerical cache only; never reopens transcript files during a dashboard calculation. */
export function readUsageObservations(
  db: DatabaseSync,
  summaries: readonly UsageObservation[],
): UsageObservation[] {
  const rows = db
    .prepare(
      `SELECT source_id AS sourceId, provider, file_key AS fileKey,
    file_mtime AS fileMtime, source_state AS sourceState, source_rank AS sourceRank,
    session_keys_json AS sessionKeysJson, events_json AS eventsJson
    FROM history_file_cache ORDER BY source_id, file_key`,
    )
    .all() as Array<{
    sourceId: string
    provider: 'claude' | 'codex'
    fileKey: string
    fileMtime: string
    sourceState: 'present' | 'missing'
    sourceRank: number
    sessionKeysJson: string
    eventsJson: string
  }>
  const caches = rows.flatMap(({ eventsJson, sessionKeysJson, ...row }) => {
    const events = parseCachedEvents(eventsJson, row.provider)
    if (!events) return []
    let sessionKeys: string[] = []
    try {
      const value: unknown = JSON.parse(sessionKeysJson)
      if (
        Array.isArray(value) &&
        value.every((key) => typeof key === 'string' && /^session_[a-f0-9]{24}$/.test(key))
      )
        sessionKeys = value
    } catch {
      /* Only validated opaque identities participate in selection. */
    }
    return [{ ...row, sessionKeys, events }]
  })
  return expandUsageObservations(summaries, [
    ...caches.filter((row) => row.provider === 'claude'),
    ...selectCodexFileContributions(caches.filter((row) => row.provider === 'codex')),
  ])
}
