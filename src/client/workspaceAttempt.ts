import { z } from 'zod'
import { configurationSchema } from '../server/configurationSchema'
import { planningSnapshotSchema, planningSaveSchema } from '../planning/schema'
import type { WorkspaceDraft, WorkspaceSave } from '../planning/workspace'
import { WORKSPACE_ATTEMPT_LIMIT, utf8Bytes } from '../planning/workspaceLimits'

const schema = z
  .object({
    version: z.literal(1),
    datasetId: z.string().uuid(),
    createdAt: z.string().datetime(),
    base: z
      .object({
        revision: z.number().int().nonnegative(),
        configuration: configurationSchema,
        planning: planningSnapshotSchema,
      })
      .strict(),
    request: z
      .object({
        requestId: z.string().uuid(),
        expectedRevision: z.number().int().nonnegative(),
        configuration: configurationSchema,
        planning: planningSaveSchema,
        previewHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (record) => record.base.revision === record.request.expectedRevision,
    '保存元の版が一致しません。',
  )
export type WorkspaceAttempt = {
  version: 1
  datasetId: string
  createdAt: string
  base: WorkspaceDraft
  request: WorkspaceSave
}
const prefix = (id: string) => 'devtax:workspace-attempt:v1:' + id + ':'
const key = (record: WorkspaceAttempt) => prefix(record.datasetId) + record.request.requestId

export function encodeWorkspaceAttempt(record: WorkspaceAttempt): string {
  schema.parse(record)
  const raw = JSON.stringify(record)
  if (utf8Bytes(raw) > WORKSPACE_ATTEMPT_LIMIT)
    throw new Error('保存要求の控えが大きすぎます。編集中の入力は保持しています。')
  return raw
}

export function decodeWorkspaceAttempt(raw: string): WorkspaceAttempt {
  if (utf8Bytes(raw) > WORKSPACE_ATTEMPT_LIMIT) throw new Error('保存要求の控えが大きすぎます。')
  const record = JSON.parse(raw) as WorkspaceAttempt
  schema.parse(record)
  return record
}

export function listWorkspaceAttempts(storage: Storage, datasetId: string) {
  const records: WorkspaceAttempt[] = []
  let unreadable = 0
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i)
    if (!name?.startsWith(prefix(datasetId))) continue
    try {
      const record = decodeWorkspaceAttempt(storage.getItem(name)!)
      if (key(record) !== name) throw new Error('identity')
      records.push(record)
    } catch {
      unreadable++
    }
  }
  return { records: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), unreadable }
}

export function writeWorkspaceAttempt(
  storage: Storage,
  record: WorkspaceAttempt,
): WorkspaceAttempt {
  const raw = encodeWorkspaceAttempt(record)
  const previous = storage.getItem(key(record))
  if (previous !== null) {
    const stored = decodeWorkspaceAttempt(previous)
    if (
      JSON.stringify(stored.request) !== JSON.stringify(record.request) ||
      JSON.stringify(stored.base) !== JSON.stringify(record.base)
    )
      throw new Error('同じ保存要求の内容が変わっているため送信を中止しました。')
    return stored
  }
  storage.setItem(key(record), raw)
  return record
}

export function removeWorkspaceAttempt(storage: Storage, record: WorkspaceAttempt) {
  const previous = storage.getItem(key(record))
  if (previous === null) return
  if (previous !== encodeWorkspaceAttempt(record))
    throw new Error('保存要求の控えが変更されています。')
  storage.removeItem(key(record))
}

/** Used only when the browser refuses its local recovery copy. */
export function retainWorkspaceAttempt(record: WorkspaceAttempt): WorkspaceAttempt | null {
  try {
    return writeWorkspaceAttempt(window.localStorage, record)
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      !['QuotaExceededError', 'SecurityError'].includes(error.name)
    )
      throw error
    const raw = encodeWorkspaceAttempt(record)
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `devtax-workspace-attempt-${record.request.requestId}.json`
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    if (
      !window.confirm(
        'ブラウザ内に送信控えを保存できないため、個人用のJSON控えをファイルとして出力しました。料金・計画と自由記述を含みます。ファイルを保存できたことを確認してから「OK」で送信してください。「キャンセル」では送信せず、編集中の入力を保持します。',
      )
    )
      throw new Error(
        '送信していません。控えファイルの保存を確認するまで、編集中の画面を閉じないでください。',
      )
    // The original request and its base are now in the explicitly confirmed
    // file copy. No localStorage copy may be deleted on this path.
    return null
  }
}
