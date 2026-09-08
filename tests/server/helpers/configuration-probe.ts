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

saveConfiguration({ ...cleared, unobservedRatio: null })
const unknown = getConfiguration()
saveConfiguration({ ...unknown, unobservedRatio: 0 })
const confirmedNone = getConfiguration()

saveConfiguration({
  ...confirmedNone,
  charges: { claude: null, codex: 0 },
  unknownChargeReasons: { claude: '請求書を確認中' },
})
const unknownDefault = getConfiguration()
const { unknownChargeReasons: _reasons, ...knownConfiguration } = unknownDefault
saveConfiguration({ ...knownConfiguration, charges: { claude: 0, codex: 0 } })
const zeroDefault = getConfiguration()

process.stdout.write(
  JSON.stringify({ initial, saved, cleared, unknown, confirmedNone, unknownDefault, zeroDefault }),
)
