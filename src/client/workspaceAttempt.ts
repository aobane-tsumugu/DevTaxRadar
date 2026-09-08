import { z } from 'zod'
import { configurationSchema } from '../server/configurationSchema'
import { planningSnapshotSchema, planningSaveSchema } from '../planning/schema'
import type { WorkspaceDraft, WorkspaceSave } from '../planning/workspace'

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
function encode(record: WorkspaceAttempt) {
  schema.parse(record)
  const raw = JSON.stringify(record)
  if (raw.length > 2000000) throw new Error('保存要求の控えが大きすぎます。')
  return raw
}
function decode(raw: string): WorkspaceAttempt {
  if (raw.length > 2000000) throw new Error('保存要求の控えが大きすぎます。')
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
      const record = decode(storage.getItem(name)!)
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
  const raw = encode(record),
    previous = storage.getItem(key(record))
  if (previous !== null) {
    const stored = decode(previous)
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
  if (previous !== encode(record)) throw new Error('保存要求の控えが変更されています。')
  storage.removeItem(key(record))
}
