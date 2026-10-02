/**
 * A Codex rollout is a cumulative series, not an independently additive file.
 * Select one whole series per source/session before aggregation AND expansion.
 * Active copies win over archived copies. Modification time is only a stable
 * fallback for duplicate copies in the same class, not proof of authenticity.
 */
export function selectCodexFileContributions<
  E extends { sessionKey: string },
  F extends {
    sourceId?: string
    fileKey: string
    fileMtime: string
    sourceState?: 'present' | 'missing'
    sourceRank?: number
    sessionKeys?: string[]
    events: E[]
  },
>(files: readonly F[]): F[] {
  const selected = new Set<string>()
  return [...files]
    .sort(
      (a, b) =>
        Number(a.sourceState === 'missing') - Number(b.sourceState === 'missing') ||
        (a.sourceRank ?? 0) - (b.sourceRank ?? 0) ||
        b.fileMtime.localeCompare(a.fileMtime) ||
        a.fileKey.localeCompare(b.fileKey),
    )
    .map((file) => {
      const sessions = new Set([
        ...(file.sessionKeys ?? []),
        ...file.events.map((event) => event.sessionKey),
      ])
      const accepted = new Set<string>()
      for (const sessionKey of sessions) {
        const key = JSON.stringify([file.sourceId ?? '', sessionKey])
        if (!selected.has(key)) {
          selected.add(key)
          accepted.add(sessionKey)
        }
      }
      return { ...file, events: file.events.filter((event) => accepted.has(event.sessionKey)) }
    })
}
