import { join, resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  createDataBundle,
  verifyDataBundle,
  restoreDataBundle,
  databaseSchemaHash,
} from '../src/server/dataBundle.js'

const [operation, source, destination, ...extra] = process.argv.slice(2)
try {
  if (
    extra.length ||
    !source ||
    (operation === 'create' || operation === 'restore'
      ? !destination
      : operation !== 'verify' || destination)
  )
    throw new Error(
      'Usage: tsx scripts/data-backup.ts create <data-directory> <new-bundle-directory> | verify <bundle-directory> | restore <bundle-directory> <new-data-directory>',
    )
  let result
  if (operation === 'restore') {
    verifyDataBundle(resolve(source))
    const referenceDirectory = mkdtempSync(join(tmpdir(), 'devtax-schema-reference-'))
    const previousDirectory = process.env.DEVTAX_RADAR_DATA_DIR
    let expected: string
    try {
      process.env.DEVTAX_RADAR_DATA_DIR = referenceDirectory
      const { getDatabase } = await import('../src/server/database.js')
      const reference = getDatabase()
      try {
        expected = databaseSchemaHash(reference)
      } finally {
        reference.close()
      }
    } finally {
      if (previousDirectory === undefined) delete process.env.DEVTAX_RADAR_DATA_DIR
      else process.env.DEVTAX_RADAR_DATA_DIR = previousDirectory
      rmSync(referenceDirectory, { recursive: true, force: true })
    }
    result = restoreDataBundle(resolve(source), resolve(destination!), expected)
  } else
    result =
      operation === 'create'
        ? createDataBundle(resolve(source), resolve(destination!))
        : verifyDataBundle(resolve(source))
  console.log(
    JSON.stringify(
      {
        operation,
        ...(operation === 'restore'
          ? {
              dataDirectory: resolve(destination!),
              requiresSourceReconnect: true,
              message:
                '保存済み資料を復元しました。履歴の再接続が完了するまで自動・手動走査を停止します。',
            }
          : {}),
        ...result,
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
