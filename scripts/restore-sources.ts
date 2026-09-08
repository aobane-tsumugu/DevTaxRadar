import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { previewRestoreSources, applyRestoreSources } from '../src/server/restoreSources.js'

const [action, dataPath, planPath, ...extra] = process.argv.slice(2)
let db: DatabaseSync | undefined
try {
  if (!['preview', 'apply'].includes(action ?? '') || !dataPath || !planPath || extra.length)
    throw new Error(
      'Usage: tsx scripts/restore-sources.ts preview <restored-data-directory> <new-plan.json> | apply <restored-data-directory> <plan.json>',
    )
  const directory = resolve(dataPath)
  const databasePath = join(directory, 'devtax-radar.db')
  if (!statSync(databasePath).isFile()) throw new Error('復元DBがありません。')
  db = new DatabaseSync(databasePath, {
    readOnly: action === 'preview',
    timeout: 5000,
    enableForeignKeyConstraints: true,
  })
  if (action === 'preview') {
    const view = previewRestoreSources(db, directory)
    writeFileSync(resolve(planPath), JSON.stringify(view.plan, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    })
    console.log(JSON.stringify({ ...view, planPath: resolve(planPath) }, null, 2))
  } else {
    if (statSync(resolve(planPath)).size > 2 * 1024 * 1024)
      throw new Error('再接続計画が大きすぎます。')
    console.log(
      JSON.stringify(
        applyRestoreSources(db, directory, JSON.parse(readFileSync(resolve(planPath), 'utf8'))),
        null,
        2,
      ),
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  db?.close()
}
