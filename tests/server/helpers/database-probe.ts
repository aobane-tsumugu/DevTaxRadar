import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { getUsageOverview, replaceProviderSessions } from '../../../src/server/database.ts'

const dataDirectory = process.env.DEVTAX_RADAR_DATA_DIR
if (!dataDirectory) {
  throw new Error('DEVTAX_RADAR_DATA_DIR is required')
}

replaceProviderSessions(
  'claude',
  [
    {
      provider: 'claude',
      month: '2026-04',
      sessionKey: 'hashed-session-a',
      projectKey: 'hashed-project-a',
      startedAt: '2026-04-10T10:00:00.000Z',
      endedAt: '2026-04-10T11:00:00.000Z',
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

const overview = getUsageOverview()
process.stdout.write(
  JSON.stringify({
    databaseExists: existsSync(join(dataDirectory, 'devtax-radar.db')),
    overview,
  }),
)
