import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { resolveRestoreHistoryRoot } from './paths.js'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const schema = z
  .object({
    version: z.literal(1),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
    sources: z
      .array(
        z
          .object({ sourceId: z.string().min(1), root: z.string().min(1), enabled: z.boolean() })
          .strict(),
      )
      .max(2000),
  })
  .strict()
export type RestoreSourcePlan = z.infer<typeof schema>
export class RestoreSourceConflict extends Error {}
type Source = {
  id: string
  provider: string
  kind: string
  name: string
  root_path: string
  root_key: string
  enabled: number
  created_at: string
  updated_at: string
}
function rows(db: DatabaseSync) {
  return db.prepare('SELECT * FROM history_sources ORDER BY id').all() as Source[]
}
function marker(directory: string) {
  const path = join(directory, 'restore-reconnect-required.json')
  if (!existsSync(path)) return null
  if (statSync(path).size > 16384) throw new Error('復元保留情報が不正です。')
  return hash(readFileSync(path, 'utf8'))
}
function sourceHash(db: DatabaseSync, directory: string) {
  return hash({
    sources: rows(db),
    identity: readFileSync(join(directory, 'identifier-salt'), 'utf8'),
  })
}
export function previewRestoreSources(db: DatabaseSync, directory: string) {
  const markerHash = marker(directory)
  if (!markerHash) throw new RestoreSourceConflict('復元後の再接続待ちではありません。')
  const sources = rows(db)
  return {
    plan: {
      version: 1 as const,
      baseHash: hash({
        markerHash,
        sources: hash({
          sources,
          identity: readFileSync(join(directory, 'identifier-salt'), 'utf8'),
        }),
      }),
      sources: sources.map((s) => ({
        sourceId: s.id,
        root: s.root_path,
        enabled: s.enabled === 1,
      })),
    },
    descriptions: sources.map((s) => ({
      sourceId: s.id,
      provider: s.provider,
      name: s.name,
      kind: s.kind,
    })),
    message:
      '同じ履歴の接続先を指定してください。原本がない読み取り元はenabledをfalseにし、保存済み数値は保持します。再接続だけでは走査しません。',
  }
}

/** Apply all source bindings atomically; preserve IDs and numeric history, invalidate pre-restore file caches. */
export function applyRestoreSources(db: DatabaseSync, directory: string, input: unknown) {
  const plan = schema.parse(input)
  const planHash = hash(plan)
  const markerHash = marker(directory)
  db.exec('BEGIN IMMEDIATE')
  try {
    const saved = db
      .prepare("SELECT value FROM app_settings WHERE key='restore_source_reconnect'")
      .get() as { value: string } | undefined
    const receipt = saved
      ? (JSON.parse(saved.value) as { planHash: string; markerHash: string; afterHash: string })
      : null
    if (receipt?.planHash === planHash) {
      if (
        (markerHash && markerHash !== receipt.markerHash) ||
        sourceHash(db, directory) !== receipt.afterHash
      )
        throw new RestoreSourceConflict(
          '再接続後に資料が変わっています。現在の内容を確認してください。',
        )
    } else {
      if (!markerHash || hash({ markerHash, sources: sourceHash(db, directory) }) !== plan.baseHash)
        throw new RestoreSourceConflict(
          '再接続の確認後に読み取り元または復元資料が変わっています。確認し直してください。',
        )
      const existing = rows(db),
        ids = new Set(plan.sources.map((s) => s.sourceId))
      if (
        ids.size !== plan.sources.length ||
        ids.size !== existing.length ||
        existing.some((s) => !ids.has(s.id))
      )
        throw new Error('すべての読み取り元を一度ずつ指定してください。')
      const normalized = plan.sources.map((s) => ({
        ...s,
        ...resolveRestoreHistoryRoot(s, existing.find((row) => row.id === s.sourceId)!),
      }))
      const keys = new Set<string>()
      for (const row of normalized) {
        const original = existing.find((s) => s.id === row.sourceId)!
        const key = original.provider + '\0' + row.rootKey
        if (keys.has(key)) throw new Error('同じAIサービスの接続先が重複しています。')
        keys.add(key)
        if (row.enabled) {
          if (!statSync(row.root).isDirectory())
            throw new Error('走査対象にはフォルダを指定してください。')
          accessSync(row.root, constants.R_OK)
        }
      }
      const token = randomUUID()
      for (const row of normalized)
        db.prepare('UPDATE history_sources SET root_key=? WHERE id=?').run(
          'reconnect:' + token + ':' + row.sourceId,
          row.sourceId,
        )
      for (const row of normalized) {
        db.prepare(
          'UPDATE history_sources SET root_path=?, root_key=?, enabled=?, updated_at=? WHERE id=?',
        ).run(row.root, row.rootKey, row.enabled ? 1 : 0, new Date().toISOString(), row.sourceId)
        // The same absolute path on another PC is not proof of identical files.
        // Keep numeric records, but require a fresh read before reusing any cache.
        db.prepare('DELETE FROM history_file_cache WHERE source_id=?').run(row.sourceId)
      }
      db.prepare(
        "INSERT INTO app_settings(key,value) VALUES ('restore_source_reconnect',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(
        JSON.stringify({
          planHash,
          markerHash,
          afterHash: sourceHash(db, directory),
          completedAt: new Date().toISOString(),
        }),
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  // If this removal fails, the dataset stays held; the same plan can safely finish removal later.
  if (existsSync(join(directory, 'restore-reconnect-required.json')))
    unlinkSync(join(directory, 'restore-reconnect-required.json'))
  return {
    reconnected: true,
    sources: rows(db).map((s) => ({ sourceId: s.id, root: s.root_path, enabled: s.enabled === 1 })),
    scanStarted: false,
  }
}
