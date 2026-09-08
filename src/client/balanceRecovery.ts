import { z } from 'zod'
import { balanceSnapshotSchema } from '../accounting/balanceSchema'
import type { BalanceDraft } from '../accounting/balanceWorkspace'
import type { BalanceSnapshot } from '../accounting/types'

export type BalanceRecovery = {
  version: 1
  datasetId: string
  editorId: string
  recordId: string
  sequence: number
  savedAt: string
  base: Pick<BalanceDraft, 'revision' | 'snapshot'>
  snapshot: BalanceSnapshot
  year: string
  saveAttempt?: { fingerprint: string; requestId: string }
}
const text = z.string().max(100_000)
const number = z.number().or(z.nan())
const consultationAnswersSchema = z
  .array(
    z
      .object({
        id: text,
        taxYear: number,
        receivedOn: text,
        kind: z.enum(['fact', 'method']),
        answer: text,
        source: text,
      })
      .strict(),
  )
  .max(100)
  .optional()
const texts = z.array(text).max(100)
const amount = z.discriminatedUnion('status', [
  z.object({ status: z.literal('known'), amountJpy: number }).strict(),
  z.object({ status: z.literal('unknown'), amountJpy: z.null(), reasons: texts }).strict(),
])
const movement = {
  id: text,
  occurredOn: text,
  amountJpy: number,
  sourceIds: texts,
  decisionId: text,
  reason: text,
  balanceAllocations: z
    .array(
      z
        .object({
          sourceKind: z.enum(['opening', 'movement']),
          sourceId: text,
          amountJpy: number,
          costAllocations: z
            .array(z.object({ costYear: number, contributionId: text, amountJpy: number }).strict())
            .max(100)
            .optional(),
        })
        .strict(),
    )
    .max(100)
    .optional(),
}
// Preserve unfinished fields and NaN from an empty number input without accepting arbitrary shapes.
const editingSnapshot: z.ZodType<BalanceSnapshot> = z
  .object({
    version: z.literal(1),
    accounts: z
      .array(
        z
          .object({
            id: text,
            taxUnitId: text,
            name: text,
            kind: z.enum(['construction', 'asset', 'prepaid']),
            openingYear: number,
            opening: amount,
            openingRevisionId: text.optional(),
          })
          .strict(),
      )
      .max(2000),
    movements: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              ...movement,
              kind: z.literal('addition'),
              accountId: text,
              costAllocations: z
                .array(
                  z.object({ costYear: number, contributionId: text, amountJpy: number }).strict(),
                )
                .max(100)
                .optional(),
            })
            .strict(),
          z.object({ ...movement, kind: z.literal('expense'), accountId: text }).strict(),
          z.object({ ...movement, kind: z.literal('reduction'), accountId: text }).strict(),
          z
            .object({
              ...movement,
              kind: z.literal('transfer'),
              fromAccountId: text,
              toAccountId: text,
            })
            .strict(),
        ]),
      )
      .max(10000),
    pendingDecisions: z
      .array(
        z
          .object({
            id: text,
            taxUnitId: text,
            taxYear: number,
            amount,
            accountIds: texts,
            answers: consultationAnswersSchema,
            reasons: texts,
            sourceIds: texts,
            resolution: z
              .object({
                taxYear: number,
                decisionId: text,
                reason: text,
                answerBasis: consultationAnswersSchema,
                questionBasis: z
                  .object({
                    pendingId: text,
                    taxUnitId: text,
                    taxYear: number,
                    amount,
                    accountIds: texts,
                    reasons: texts,
                    sourceIds: texts,
                    resolutionYear: number,
                    decisionId: text,
                    resolutionReason: text,
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict()
const recoverySchema: z.ZodType<BalanceRecovery> = z
  .object({
    version: z.literal(1),
    datasetId: z.string().uuid(),
    editorId: z.string().uuid(),
    recordId: z.string().uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    savedAt: z.string().datetime(),
    base: z
      .object({
        revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        snapshot: balanceSnapshotSchema,
      })
      .strict(),
    snapshot: editingSnapshot,
    year: z.string().max(20),
    saveAttempt: z
      .object({ fingerprint: z.string().max(2_000_000), requestId: z.string().uuid() })
      .strict()
      .optional(),
  })
  .strict()
const prefix = 'devtax:balance-recovery:v1:'
/** Shape parsing may reorder object keys; it must not create false conflicts or new save requests. */
export function balanceSaveFingerprint(snapshot: BalanceSnapshot, revision = 0): string {
  const normalize = (value: unknown): unknown => {
    if (typeof value === 'number' && Number.isNaN(value)) return { devtaxEmptyNumber: true }
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      )
    return value
  }
  return JSON.stringify(normalize({ snapshot, revision }))
}
const editorPrefix = (datasetId: string, editorId: string) =>
  prefix + datasetId + ':' + editorId + ':'
const keyFor = (row: BalanceRecovery) =>
  editorPrefix(row.datasetId, row.editorId) + row.sequence + ':' + row.recordId
export function encodeRecovery(value: BalanceRecovery): string {
  const validated = recoverySchema.parse(value)
  const text = JSON.stringify(validated, (_key, value) =>
    typeof value === 'number' && Number.isNaN(value) ? { devtaxEmptyNumber: true } : value,
  )
  if (text.length > 2_000_000) throw new Error('復旧用入力が保存上限を超えました。')
  return text
}
export function decodeRecovery(raw: string): BalanceRecovery {
  if (raw.length > 2_000_000) throw new Error('復旧用入力が保存上限を超えています。')
  return recoverySchema.parse(
    JSON.parse(raw, (_key, value) =>
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      value.devtaxEmptyNumber === true
        ? NaN
        : value,
    ),
  )
}
export function writeRecovery(
  storage: Storage,
  value: BalanceRecovery,
): { cleanupFailed: boolean } {
  const key = keyFor(value),
    raw = encodeRecovery(value)
  const existing = storage.getItem(key)
  if (existing !== null && existing !== raw)
    throw new Error('同じ復旧記録の内容を上書きできません。')
  storage.setItem(key, raw)
  let cleanupFailed = false
  // New input has a new immutable key. Deleting an old version cannot erase a racing edit.
  try {
    const oldKeys: string[] = []
    const scope = editorPrefix(value.datasetId, value.editorId)
    for (let index = 0; index < storage.length; index++) {
      const candidate = storage.key(index)
      if (candidate?.startsWith(scope)) {
        const sequence = Number(candidate.slice(scope.length).split(':')[0])
        if (Number.isSafeInteger(sequence) && sequence < value.sequence) oldKeys.push(candidate)
      }
    }
    for (const old of oldKeys) storage.removeItem(old)
  } catch {
    cleanupFailed = true
  }
  return { cleanupFailed }
}
export function listRecoveries(
  storage: Storage,
  datasetId: string,
): { records: BalanceRecovery[]; unreadable: number } {
  const records: BalanceRecovery[] = []
  let unreadable = 0
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key?.startsWith(prefix + datasetId + ':')) continue
    try {
      const row = decodeRecovery(storage.getItem(key)!)
      if (key !== keyFor(row) || row.datasetId !== datasetId) throw new Error('scope')
      records.push(row)
    } catch {
      unreadable++
    }
  }
  const latest = new Map<string, BalanceRecovery>()
  for (const row of records)
    if (!latest.has(row.editorId) || latest.get(row.editorId)!.sequence < row.sequence)
      latest.set(row.editorId, row)
  return {
    records: [...latest.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    unreadable,
  }
}
/** Never remove a different tab's more recent input. */
export function removeRecovery(storage: Storage, expected: BalanceRecovery): boolean {
  const key = keyFor(expected)
  const raw = storage.getItem(key)
  if (raw === null) return true
  if (raw !== encodeRecovery(expected)) return false
  storage.removeItem(key)
  return true
}
