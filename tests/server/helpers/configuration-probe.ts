import { getConfiguration, saveConfiguration } from '../../../src/server/database.ts'

if (!process.env.DEVTAX_RADAR_DATA_DIR) {
  throw new Error('DEVTAX_RADAR_DATA_DIR is required')
}

const initial = getConfiguration()

saveConfiguration({
  charges: { claude: 30000, codex: 20000 },
  monthlyCharges: [{ provider: 'claude', month: '2026-07', amountJpy: 30000 }],
  contracts: {
    claude: { startedOn: '2026-07-18' },
    codex: { startedOn: '2026-01-05', endedOn: '2026-05-31' },
  },
  unobservedRatio: 0.1,
})

const saved = getConfiguration()

saveConfiguration({ ...saved, contracts: { claude: {}, codex: {} } })
const cleared = getConfiguration()

process.stdout.write(JSON.stringify({ initial, saved, cleared }))
