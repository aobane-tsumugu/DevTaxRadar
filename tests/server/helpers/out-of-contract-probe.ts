import { replaceProviderSessions, saveConfiguration } from '../../../src/server/database.ts'
import { buildDashboard } from '../../../src/server/dashboard.ts'

if (!process.env.DEVTAX_RADAR_DATA_DIR) {
  throw new Error('DEVTAX_RADAR_DATA_DIR is required')
}

// sessionAggregation splits a session that crosses a month boundary into one
// row per month, so both rows carry the same sessionKey. Reproduce that shape
// directly: it is the only way two out-of-contract rows can collide on id.
const sharedSessionKey = 'hashed-session-crossing-a-month-boundary'

replaceProviderSessions(
  'claude',
  [
    {
      provider: 'claude',
      month: '2026-06',
      sessionKey: sharedSessionKey,
      projectKey: 'hashed-project-a',
      startedAt: '2026-06-30T14:50:00.000Z',
      endedAt: '2026-06-30T14:59:59.000Z',
      messageCount: 2,
      model: 'synthetic-model',
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      schemaVersion: 'test-v1',
      confidence: 'medium',
    },
    {
      provider: 'claude',
      month: '2026-07',
      sessionKey: sharedSessionKey,
      projectKey: 'hashed-project-a',
      startedAt: '2026-07-01T00:10:00.000Z',
      endedAt: '2026-07-01T00:20:00.000Z',
      messageCount: 3,
      model: 'synthetic-model',
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 60,
      cacheWriteTokens: 20,
      schemaVersion: 'test-v1',
      confidence: 'medium',
    },
  ],
  { filesSeen: 1, malformedLines: 0 },
)

saveConfiguration({
  charges: { claude: 30000, codex: 0 },
  monthlyCharges: [],
  contracts: { claude: { startedOn: '2030-01-01' }, codex: {} },
  unobservedRatio: 0.1,
})

const dashboard = buildDashboard()
process.stdout.write(
  JSON.stringify({
    guidance: dashboard.guidance.map((item) => ({
      title: item.title,
      severity: item.severity,
    })),
    monthCount: dashboard.months.length,
    allocations: dashboard.allocations.map((row) => ({
      id: row.id,
      month: row.month,
      amount: row.amount,
      taxCandidate: row.taxCandidate,
      sessionDate: row.session.date,
    })),
  }),
)
