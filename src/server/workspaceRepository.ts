import { readSourceAdjustments } from './sourceAdjustmentsRepository.js'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { getConfiguration, getDatabase, saveConfiguration } from './database.js'
import {
  getPlanningSnapshot,
  planningSaveSchema,
  savePlanningSnapshot,
} from './planningRepository.js'
import { configurationSchema } from './configurationSchema.js'
import { workspaceRevision } from './workspaceRevision.js'
import type { WorkspaceDraft } from '../planning/workspace.js'

export const workspaceSaveSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    previewHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    configuration: configurationSchema.refine((value) => value.chargePeriods !== undefined, {
      message: '全体保存には請求履歴を含めてください。',
      path: ['chargePeriods'],
    }),
    planning: planningSaveSchema,
  })
  .strict()

export class WorkspaceConflict extends Error {
  readonly currentRevision: number
  constructor(currentRevision: number, message = '別の保存で内容が変わっています。入力は残しています。最新の内容を確認してから変更を反映してください。') {
    super(message)
    this.currentRevision = currentRevision
  }
}

export class WorkspaceRequestReuse extends Error {
  constructor() {
    super('同じ保存要求の内容が変わっています。')
  }
}

// The view callback must be synchronous and read from this same database.
export function readWorkspace<T>(
  view: (draft: WorkspaceDraft) => T,
  db: DatabaseSync = getDatabase(),
): T {
  db.exec('SAVEPOINT devtax_workspace_read')
  try {
    const result = view({
      revision: workspaceRevision(db),
      configuration: getConfiguration(db),
      planning: getPlanningSnapshot(db),
    })
    db.exec('RELEASE devtax_workspace_read')
    return result
  } catch (error) {
    db.exec('ROLLBACK TO devtax_workspace_read')
    db.exec('RELEASE devtax_workspace_read')
    throw error
  }
}

export function saveWorkspace<T>(
  input: unknown,
  view: (draft: WorkspaceDraft) => T,
  db: DatabaseSync = getDatabase(),
  beforeWrite?: (input: z.infer<typeof workspaceSaveSchema>) => void,
): T {
  const parsed = workspaceSaveSchema.parse(input)
  const fingerprint = createHash('sha256').update(JSON.stringify(parsed)).digest('hex')
  db.exec('BEGIN IMMEDIATE')
  try {
    const revision = workspaceRevision(db)
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = 'workspace_last_save'")
      .get() as { value: string } | undefined
    const previous = row
      ? z
          .object({
            requestId: z.string().uuid(),
            fingerprint: z.string(),
            revision: z.number().int().nonnegative(),
          })
          .parse(JSON.parse(row.value))
      : undefined
    if (previous?.requestId === parsed.requestId) {
      if (previous.fingerprint !== fingerprint) throw new WorkspaceRequestReuse()
      if (previous.revision !== revision) throw new WorkspaceConflict(revision)
      const result = readWorkspace(view, db)
      db.exec('COMMIT')
      return result
    }
    if (parsed.expectedRevision !== revision) throw new WorkspaceConflict(revision)
    if (parsed.planning.sourceAdjustments === undefined && readSourceAdjustments(db).length > 0)
      throw new WorkspaceConflict(revision, '保存済みの返金・訂正記録を含む最新の計画を読み直してください。記録を削除する場合は明示的に空の一覧を指定します。')
    beforeWrite?.(parsed)
    saveConfiguration(parsed.configuration, db)
    savePlanningSnapshot(parsed.planning, db)
    const result = readWorkspace(view, db)
    db.prepare(
      "INSERT INTO app_settings(key, value) VALUES ('workspace_last_save', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(
      JSON.stringify({ requestId: parsed.requestId, fingerprint, revision: workspaceRevision(db) }),
    )
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
