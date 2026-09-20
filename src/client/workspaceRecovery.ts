import { z } from 'zod'
import { planningSnapshotSchema } from '../planning/schema'
import { configurationSchema } from '../server/configurationSchema'
import type { PlanningSnapshot } from '../planning/types'
import type { LocalConfiguration, ProviderKey } from './types'
import type { WorkspaceDraft } from '../planning/workspace'
import type { CandidateDestinations } from './candidateGrouping'

// Preserve editing values while retaining the schema's field types and enums.
// Persistence validation remains the original schema at the API boundary.
export function editingShape(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodDefault) return editingShape(schema.removeDefault() as z.ZodType)
  if (schema instanceof z.ZodObject)
    return z
      .object(
        Object.fromEntries(
          Object.entries(schema.shape).map(([key, value]) => [
            key,
            editingShape(value as z.ZodType),
          ]),
        ),
      )
      .strict()
  if (schema instanceof z.ZodString) return z.string().max(20000)
  if (schema instanceof z.ZodNumber) return z.union([z.number(), z.nan()])
  if (schema instanceof z.ZodOptional) return editingShape(schema.unwrap() as z.ZodType).optional()
  if (schema instanceof z.ZodNullable) return editingShape(schema.unwrap() as z.ZodType).nullable()
  if (schema instanceof z.ZodArray)
    return z.array(editingShape(schema.element as z.ZodType)).max(20000)
  // These opaque fields are not edited in this wizard. Keep their real validator
  // and transformation rather than stripping it or failing during module import.
  if (schema instanceof z.ZodPipe || schema instanceof z.ZodCustom) return schema
  if (schema instanceof z.ZodUnion) {
    const options = schema.options.map((option) => editingShape(option as z.ZodType))
    return z.union(options as [z.ZodType, z.ZodType, ...z.ZodType[]])
  }
  if (schema instanceof z.ZodRecord)
    return z.record(schema.keyType, editingShape(schema.valueType as z.ZodType))
  if (
    schema instanceof z.ZodEnum ||
    schema instanceof z.ZodLiteral ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodNull ||
    schema instanceof z.ZodUndefined ||
    schema instanceof z.ZodUnknown
  )
    return schema
  throw new Error('Unsupported editing schema')
}

export type WorkspaceEditorInput = {
  claudeCharge?: number | null
  codexCharge?: number | null
  unknownChargeReasons?: LocalConfiguration['unknownChargeReasons']
  monthlyCharges: LocalConfiguration['monthlyCharges']
  contracts: LocalConfiguration['contracts']
  chargePeriods: NonNullable<LocalConfiguration['chargePeriods']>
  unobservedPercent: number | null
  planning: PlanningSnapshot
  candidateDestinations: CandidateDestinations
  selectedProviders: ProviderKey[]
  step: number
}
const configurationEditing = editingShape(configurationSchema) as z.ZodObject
const editorSchema = z
  .object({
    claudeCharge: z.union([z.number(), z.nan(), z.null()]).optional(),
    codexCharge: z.union([z.number(), z.nan(), z.null()]).optional(),
    unknownChargeReasons: configurationEditing.shape.unknownChargeReasons,
    monthlyCharges: configurationEditing.shape.monthlyCharges,
    contracts: configurationEditing.shape.contracts,
    chargePeriods: (configurationEditing.shape.chargePeriods as z.ZodOptional).unwrap(),
    unobservedPercent: z.union([z.number(), z.nan(), z.null()]),
    planning: editingShape(planningSnapshotSchema),
    candidateDestinations: z.record(
      z.string(),
      z.union([
        z
          .object({
            kind: z.literal('product'),
            group: z.string(),
            existingTaxUnitId: z.string().optional(),
          })
          .strict(),
        z
          .object({
            kind: z.enum(['private', 'learning', 'later']),
            existingTaxUnitId: z.string().optional(),
          })
          .strict(),
      ]),
    ),
    selectedProviders: z.array(z.enum(['claude', 'codex'])).max(2),
    step: z.number().int().min(0).max(4),
  })
  .strict()
const recordSchema = z
  .object({
    version: z.literal(1),
    datasetId: z.string().uuid(),
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    base: z
      .object({
        revision: z.number().int().nonnegative(),
        configuration: configurationSchema,
        planning: planningSnapshotSchema,
      })
      .strict(),
    input: editorSchema,
  })
  .strict()
export type WorkspaceRecovery = {
  version: 1
  datasetId: string
  id: string
  createdAt: string
  base: WorkspaceDraft
  input: WorkspaceEditorInput
}
const prefix = (datasetId: string) => `devtax:workspace-input:v1:${datasetId}:`
const marker = { devtaxEmptyNumber: true }
export function encodeWorkspaceRecovery(record: WorkspaceRecovery) {
  recordSchema.parse(record)
  const raw = JSON.stringify(record, (_key, value) =>
    typeof value === 'number' && Number.isNaN(value) ? marker : value,
  )
  if (raw.length > 2000000) throw new Error('入力の控えが大きすぎます。')
  return raw
}
export function decodeWorkspaceRecovery(raw: string): WorkspaceRecovery {
  if (raw.length > 2000000) throw new Error('入力の控えが大きすぎます。')
  const parsed = JSON.parse(raw, (_key, value) =>
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    value.devtaxEmptyNumber === true
      ? NaN
      : value,
  )
  recordSchema.parse(parsed)
  return parsed as WorkspaceRecovery
}
export function listWorkspaceRecovery(storage: Storage, datasetId: string) {
  const records: WorkspaceRecovery[] = []
  let unreadable = 0
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix(datasetId))) continue
    try {
      const record = decodeWorkspaceRecovery(storage.getItem(key)!)
      if (record.datasetId !== datasetId || prefix(datasetId) + record.id !== key)
        throw new Error('Invalid identity')
      records.push(record)
    } catch {
      unreadable++
    }
  }
  return { records: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), unreadable }
}
export function writeWorkspaceRecovery(storage: Storage, record: WorkspaceRecovery) {
  const raw = encodeWorkspaceRecovery(record)
  const key = prefix(record.datasetId) + record.id
  const previous = storage.getItem(key)
  if (previous !== null && previous !== raw) throw new Error('控えが変更されています。')
  storage.setItem(key, raw)
}
export function removeWorkspaceRecovery(storage: Storage, record: WorkspaceRecovery) {
  const key = prefix(record.datasetId) + record.id
  const previous = storage.getItem(key)
  if (previous === null) return
  if (previous !== encodeWorkspaceRecovery(record)) throw new Error('控えが変更されています。')
  storage.removeItem(key)
}
