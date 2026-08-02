import {
  getDatabase,
  replaceProviderSessions,
  saveConfiguration,
} from '../../../src/server/database.ts'
import { buildDashboard } from '../../../src/server/dashboard.ts'

if (!process.env.DEVTAX_RADAR_DATA_DIR) {
  throw new Error('DEVTAX_RADAR_DATA_DIR is required')
}

replaceProviderSessions(
  'claude',
  [
    {
      provider: 'claude',
      month: '2026-07',
      sessionKey: 'hashed-session-a',
      projectKey: 'hashed-project-a',
      startedAt: '2026-07-10T10:00:00.000Z',
      endedAt: '2026-07-10T11:00:00.000Z',
      messageCount: 2,
      model: 'synthetic-model',
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      schemaVersion: 'test-v1',
      confidence: 'medium',
    },
  ],
  { filesSeen: 1, malformedLines: 0 },
)

saveConfiguration({
  charges: { claude: 30000, codex: 0 },
  monthlyCharges: [],
  contracts: { claude: {}, codex: {} },
  unobservedRatio: 0.1,
})

// replaceProviderSessions always writes the process's real resolvedTimeZone()
// (memoised for the process lifetime -- see src/adapters/localTime.ts), so
// right after a scan the recorded zone always matches the current one.
const beforeGuidance = buildDashboard().guidance.map((item) => ({
  title: item.title,
  severity: item.severity,
}))

// Simulate a machine that scanned in a different zone than the one now
// running this probe. The only way to produce a differing value without
// spawning yet another process with a different TZ is to overwrite the
// stored scan row directly.
getDatabase()
  .prepare(
    `UPDATE scans SET time_zone = 'Etc/Never-Matches-Test-Zone' WHERE id = (SELECT MAX(id) FROM scans)`,
  )
  .run()

const afterGuidance = buildDashboard().guidance.map((item) => ({
  title: item.title,
  severity: item.severity,
}))

process.stdout.write(JSON.stringify({ beforeGuidance, afterGuidance }))
