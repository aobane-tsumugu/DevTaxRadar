import type { DatabaseSync } from 'node:sqlite'
import { expandUsageObservations, type UsageObservation } from '../core/usageGranularity.js'

/** Reads numerical cache only; never reopens transcript files during a dashboard calculation. */
export function readUsageObservations(db: DatabaseSync, summaries: readonly UsageObservation[]): UsageObservation[] {
  const rows = db.prepare(`SELECT source_id AS sourceId, provider, file_key AS fileKey,
    events_json AS eventsJson FROM history_file_cache ORDER BY source_id, file_key`).all() as
    Array<{ sourceId: string; provider: 'claude' | 'codex'; fileKey: string; eventsJson: string }>
  return expandUsageObservations(summaries, rows.map(({ eventsJson, ...row }) => {
    let events: unknown
    try { events = JSON.parse(eventsJson) } catch { events = undefined }
    return { ...row, events }
  }))
}
