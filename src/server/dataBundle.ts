import { readOriginalCharges } from './originalChargesRepository.js'
import { readActivityLedger } from './activityLedgerRepository.js'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { describeBundleFile } from './bundleFile.js'

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const fileSchema = z.object({ bytes: z.number().int().nonnegative(), sha256: hashSchema }).strict()
const manifestSchema = z
  .object({
    format: z.literal('devtax-data-bundle'),
    version: z.literal(1),
    createdAt: z.string().datetime(),
    schemaHash: hashSchema,
    files: z.object({ 'devtax-radar.db': fileSchema, 'identifier-salt': fileSchema }).strict(),
    originalFilesIncluded: z.literal(false),
  })
  .strict()
export type DataBundleManifest = z.infer<typeof manifestSchema>
const files = ['devtax-radar.db', 'identifier-salt'] as const

export function databaseSchemaHash(db: DatabaseSync): string {
  const rows = db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all()
  return digest(
    JSON.stringify({
      rows,
      userVersion: db.prepare('PRAGMA user_version').get(),
      applicationId: db.prepare('PRAGMA application_id').get(),
    }),
  )
}
function assertDatabase(db: DatabaseSync) {
  if (
    db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='app_settings'").get()
  ) {
    readActivityLedger(db)
    readOriginalCharges(db)
  }
  const checks = db.prepare('PRAGMA integrity_check').all()
  if (checks.length !== 1 || checks[0]?.integrity_check !== 'ok')
    throw new Error('バックアップDBの整合性を確認できません。')
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('バックアップDBに参照不整合があります。')
}
function readSalt(path: string) {
  if (statSync(path).size > 512) throw new Error('識別子設定の形式が不正です。')
  const bytes = readFileSync(path)
  if (!/^[A-Za-z0-9_-]{43}\s*$/.test(bytes.toString('utf8')))
    throw new Error('識別子設定が欠けているか不正です。新しい識別子で補完しません。')
  return bytes
}
function publishNewDirectory<T>(destination: string, action: (stage: string) => T): T {
  const target = resolve(destination)
  if (existsSync(target))
    throw new Error('保存先が既に存在します。新しいフォルダを指定してください。')
  mkdirSync(dirname(target), { recursive: true })
  const stage = join(dirname(target), '.devtax-bundle-' + randomUUID())
  mkdirSync(stage, { mode: 0o700 })
  try {
    const result = action(stage)
    // Recheck immediately before publishing; never intentionally replace an existing destination.
    if (existsSync(target)) throw new Error('保存先が作業中に作成されました。上書きしません。')
    renameSync(stage, target)
    return result
  } catch (error) {
    rmSync(stage, { recursive: true, force: true })
    throw error
  }
}

/** Snapshot the complete SQLite database, including WAL changes, plus the stable identifier salt. */
export function createDataBundle(dataDirectory: string, destination: string): DataBundleManifest {
  const source = resolve(dataDirectory)
  const salt = readSalt(join(source, 'identifier-salt'))
  return publishNewDirectory(destination, (stage) => {
    const db = new DatabaseSync(join(source, 'devtax-radar.db'), { readOnly: true, timeout: 5000 })
    try {
      db.prepare('VACUUM INTO ?').run(join(stage, 'devtax-radar.db'))
    } finally {
      db.close()
    }
    if (!salt.equals(readSalt(join(source, 'identifier-salt'))))
      throw new Error('識別子設定が処理中に変更されました。作成をやり直してください。')
    writeFileSync(join(stage, 'identifier-salt'), salt, { mode: 0o600, flag: 'wx' })
    const snapshot = new DatabaseSync(join(stage, 'devtax-radar.db'), { readOnly: true })
    let schemaHash: string
    try {
      assertDatabase(snapshot)
      schemaHash = databaseSchemaHash(snapshot)
    } finally {
      snapshot.close()
    }
    const manifest: DataBundleManifest = {
      format: 'devtax-data-bundle',
      version: 1,
      createdAt: new Date().toISOString(),
      schemaHash,
      files: {
        'devtax-radar.db': describeBundleFile(join(stage, 'devtax-radar.db')),
        'identifier-salt': describeBundleFile(join(stage, 'identifier-salt')),
      },
      originalFilesIncluded: false,
    }
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    })
    writeFileSync(
      join(stage, 'README.txt'),
      'DevTax data bundle v1\nDB全体とidentifier-saltを含みます。source root・証拠参照・自由記述を含むため、相談用出力とは異なります。\n元ログ・証拠原本・外部アプリ設定・未保存の画面入力は含みません。\nmanifest.jsonのSHA-256とDB整合性を検証し、対応するschemaの新しい保存先へ復元してください。\n別PCでは履歴の読み取り元を再接続してから走査を再開してください。\n',
      { encoding: 'utf8', flag: 'wx' },
    )
    verifyDataBundle(stage)
    return manifest
  })
}

export function verifyDataBundle(directory: string): DataBundleManifest {
  const folder = resolve(directory)
  if (statSync(join(folder, 'manifest.json')).size > 16384)
    throw new Error('バックアップ説明が大きすぎます。')
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')),
  )
  const allowed = new Set(['manifest.json', 'README.txt', ...files])
  if (readdirSync(folder).some((name) => !allowed.has(name)))
    throw new Error('未対応のファイルを含むバックアップです。')
  for (const name of files) {
    const expected = manifest.files[name],
      actual = describeBundleFile(join(folder, name))
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new Error(name + 'のサイズまたはhashが一致しません。')
  }
  readSalt(join(folder, 'identifier-salt'))
  const db = new DatabaseSync(join(folder, 'devtax-radar.db'), { readOnly: true })
  try {
    assertDatabase(db)
    if (databaseSchemaHash(db) !== manifest.schemaHash)
      throw new Error('DBのschemaが説明と一致しません。')
  } finally {
    db.close()
  }
  return manifest
}

/** Restore into a new data directory only. Caller must supply the installed engine's schema hash. */
export function restoreDataBundle(
  directory: string,
  destination: string,
  expectedSchemaHash: string,
) {
  const manifest = verifyDataBundle(directory)
  if (manifest.schemaHash !== expectedSchemaHash)
    throw new Error('この実行版に対応しないDB schemaです。内容を削って復元しません。')
  return publishNewDirectory(destination, (stage) => {
    for (const name of files) {
      copyFileSync(join(directory, name), join(stage, name))
      if (describeBundleFile(join(stage, name)).sha256 !== manifest.files[name].sha256)
        throw new Error('復元中にバックアップ内容が変更されました。')
    }
    // Keep the archive manifest beside the restored data for provenance; no process is started here.
    writeFileSync(join(stage, 'restored-from.json'), JSON.stringify(manifest, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    })
    writeFileSync(
      join(stage, 'restore-reconnect-required.json'),
      JSON.stringify({
        version: 1,
        restoredAt: new Date().toISOString(),
        bundleCreatedAt: manifest.createdAt,
        schemaHash: manifest.schemaHash,
      }) + '\n',
      { encoding: 'utf8', flag: 'wx' },
    )
    return manifest
  })
}
