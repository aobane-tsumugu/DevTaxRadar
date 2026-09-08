import { getDatabase, getHistorySources, getUsageOverview } from '../../../src/server/database.js'
import {
  scanHistorySources,
  automaticSourceScanEnabled,
} from '../../../src/server/historySources.js'
import { restoreRequiresReconnect } from '../../../src/server/paths.js'

const db = getDatabase()
try {
  let scanRejected = false
  let scanResult
  try {
    scanResult = await scanHistorySources()
  } catch (error) {
    scanRejected = error instanceof Error && error.message.includes('再接続')
    if (!scanRejected) throw error
  }
  console.log(
    JSON.stringify({
      restoreRequiresReconnect: restoreRequiresReconnect(),
      automaticScan: automaticSourceScanEnabled(),
      scanRejected,
      scanResult,
      sources: getHistorySources(),
      overview: getUsageOverview(),
    }),
  )
} finally {
  db.close()
}
