import { z } from 'zod'
import type { LocalConfiguration } from '../client/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import type { WorkspaceDraft } from '../planning/workspace.js'
import { planningSaveSchema } from '../planning/schema.js'
import { configurationSchema } from '../server/configurationSchema.js'
import { utf8Bytes, WORKSPACE_BODY_LIMIT } from '../planning/workspaceLimits.js'
import {
  activeOriginalCharges,
  canonicalOriginalCharge,
  originalChargeCandidateSchema,
  originalChargeContentHash,
  originalChargeFactSchema,
  originalChargeSourceId,
  originalChargesSchema,
  type OriginalChargeCandidate,
  type OriginalChargeCategory,
} from '../planning/originalCharges.js'
export { originalChargeSourceId } from '../planning/originalCharges.js'

export const ORIGINAL_CHARGE_IMPORT_LIMIT = 512 * 1024
export const ORIGINAL_CHARGE_IMPORT_ROWS = 500
export const ORIGINAL_CHARGE_CSV_COLUMNS = [
  'category',
  'record',
  'original',
  'dates',
  'servicePeriod',
  'contract',
  'evidenceIds',
  'sourceKey',
  'correctsId',
  'legacySourceId',
  'correctionReason',
] as const

type ChargeWorkspace = {
  planning: PlanningSnapshot
  configuration?: { chargePeriods?: LocalConfiguration['chargePeriods'] }
}
function existingRecord(
  workspace: ChargeWorkspace,
  category: OriginalChargeCategory,
  id: string,
): OriginalChargeCandidate['record'] | undefined {
  switch (category) {
    case 'subscription':
      return workspace.configuration?.chargePeriods?.find((row) => row.id === id)
    case 'equipment':
      return workspace.planning.equipment.find((row) => row.id === id)
    case 'home':
      return workspace.planning.homeCosts.find((row) => row.id === id)
    case 'direct':
      return workspace.planning.directCosts.find((row) => row.id === id)
  }
}

/** Tax-allocation/method edits remain independent; original factual edits need a correction. */
function recordFacts(
  category: OriginalChargeCategory,
  record: OriginalChargeCandidate['record'],
): unknown {
  const fields =
    category === 'subscription'
      ? [
          'id',
          'provider',
          'planName',
          'serviceStartedOn',
          'serviceEndedOn',
          'billedOn',
          'amountJpy',
          'unknownAmountReason',
          'note',
        ]
      : category === 'equipment'
        ? [
            'id',
            'name',
            'equipmentType',
            'acquisitionCostJpy',
            'unknownAmountReason',
            'orderedOn',
            'deliveredOn',
            'acquiredOn',
          ]
        : category === 'home'
          ? ['id', 'month', 'category', 'amountJpy', 'unknownAmountReason']
          : ['id', 'incurredOn', 'costType', 'amountJpy', 'unknownAmountReason', 'note']
  const value = record as Record<string, unknown>
  return {
    ...Object.fromEntries(
      fields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
    ),
    evidenceIds: [...(record.evidenceIds ?? [])].sort(),
  }
}
export function validateOriginalChargeBindings(workspace: ChargeWorkspace): void {
  if (!workspace.planning.originalCharges) return
  const ledger = originalChargesSchema.parse(workspace.planning.originalCharges)
  for (const fact of activeOriginalCharges(ledger)) {
    if (fact.category === 'subscription' && !workspace.configuration) continue
    const row = existingRecord(workspace, fact.category, fact.record.id)
    if (
      !row ||
      canonicalOriginalCharge(recordFacts(fact.category, row)) !==
        canonicalOriginalCharge(recordFacts(fact.category, fact.record))
    )
      throw new Error(
        `原請求 ${fact.sourceId} と分類先の記録が一致しません。原請求の訂正として理由付きで変更してください。`,
      )
    if (
      fact.category === 'subscription' &&
      fact.contract &&
      'contractConfirmation' in row &&
      row.contractConfirmation &&
      fact.contract.reference !== row.contractConfirmation.reference
    )
      throw new Error(
        `原請求 ${fact.sourceId} と確認した契約が一致しません。原請求の訂正で契約を修正し、契約との対応を再確認してください。`,
      )
  }
}

/** Entry-point for a manual form. No import keys or parser payload survive this adapter. */
export function manualOriginalChargeCandidate(value: unknown): OriginalChargeCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('原請求の入力形式を確認してください。')
  return originalChargeCandidateSchema.parse({ ...value, provenance: { kind: 'manual' } })
}

/** Returns a correction draft. The caller must provide a reason before validation/apply. */
export function originalChargeCandidateFromSource(
  workspace: WorkspaceDraft,
  category: OriginalChargeCategory,
  recordId: string,
): OriginalChargeCandidate {
  const record = existingRecord(workspace, category, recordId)
  if (!record) throw new Error('訂正する分類先の記録が見つかりません。')
  const sourceId = originalChargeSourceId({ category, record })
  const prior = activeOriginalCharges(workspace.planning.originalCharges).find(
    (fact) => fact.sourceId === sourceId,
  )
  if (prior) {
    const {
      id: _id,
      recordedAt: _recordedAt,
      sourceId: _sourceId,
      correctsId: _correctsId,
      legacySourceId: _legacySourceId,
      legacyPreviousRecord: _legacyPreviousRecord,
      correctionReason: _reason,
      ...candidate
    } = prior
    return structuredClone({
      ...candidate,
      record,
      correctsId: prior.id,
      provenance: { kind: 'manual' },
    }) as OriginalChargeCandidate
  }
  const amount = 'acquisitionCostJpy' in record ? record.acquisitionCostJpy : record.amountJpy
  const candidate: Record<string, unknown> = {
    category,
    record,
    original: {
      currency: 'JPY',
      amount: amount === null ? null : String(amount),
      amountJpy: amount,
      ...(amount === null
        ? {
            unknownAmountReason: record.unknownAmountReason,
            unknownJpyReason: record.unknownAmountReason,
          }
        : {}),
    },
    evidenceIds: [...(record.evidenceIds ?? [])],
    provenance: { kind: 'manual' },
    legacySourceId: sourceId,
  }
  if ('serviceStartedOn' in record) {
    candidate.servicePeriod = { startedOn: record.serviceStartedOn, endedOn: record.serviceEndedOn }
    if (record.billedOn) candidate.dates = { billedOn: record.billedOn }
    if (record.contractConfirmation?.reference)
      candidate.contract = {
        reference: record.contractConfirmation.reference,
        ...(record.contractConfirmation.reason
          ? { reason: record.contractConfirmation.reason }
          : {}),
      }
  } else if ('acquiredOn' in record) candidate.dates = { acquiredOn: record.acquiredOn }
  else if ('incurredOn' in record) candidate.dates = { incurredOn: record.incurredOn }
  return structuredClone(candidate) as OriginalChargeCandidate
}

function replaceRecord(workspace: WorkspaceDraft, candidate: OriginalChargeCandidate) {
  function replace<T extends { id: string }>(rows: T[], row: T): T[] {
    const index = rows.findIndex((existing) => existing.id === row.id)
    return index === -1 ? [...rows, row] : rows.map((existing, i) => (i === index ? row : existing))
  }
  switch (candidate.category) {
    case 'subscription':
      workspace.configuration.chargePeriods = replace(
        workspace.configuration.chargePeriods,
        candidate.record,
      )
      break
    case 'equipment':
      workspace.planning.equipment = replace(workspace.planning.equipment, candidate.record)
      break
    case 'home':
      workspace.planning.homeCosts = replace(workspace.planning.homeCosts, candidate.record)
      break
    case 'direct':
      workspace.planning.directCosts = replace(workspace.planning.directCosts, candidate.record)
      break
  }
}
export function applyOriginalChargeCandidates(
  current: WorkspaceDraft,
  input: readonly OriginalChargeCandidate[],
  options: { recordedAt: string; createId?: () => string },
): { workspace: WorkspaceDraft; addedFactIds: string[]; skippedSourceKeys: string[] } {
  if (!Array.isArray(input) || input.length > ORIGINAL_CHARGE_IMPORT_ROWS)
    throw new Error(`一度に取り込める原請求は${ORIGINAL_CHARGE_IMPORT_ROWS}件までです。`)
  const candidates = input.map((candidate) => originalChargeCandidateSchema.parse(candidate))
  validateOriginalChargeBindings(current)
  const workspace = structuredClone(current)
  const ledger = workspace.planning.originalCharges ?? { version: 1 as const, facts: [] }
  const addedFactIds: string[] = [],
    skippedSourceKeys: string[] = []
  for (const candidate of candidates) {
    const sourceId = originalChargeSourceId(candidate)
    const key = candidate.provenance.sourceKey
    const imported = key ? ledger.facts.filter((fact) => fact.provenance.sourceKey === key) : []
    if (
      imported.some(
        (fact) =>
          fact.sourceId === sourceId &&
          fact.provenance.contentHash === candidate.provenance.contentHash &&
          fact.correctsId === candidate.correctsId &&
          fact.legacySourceId === candidate.legacySourceId &&
          fact.correctionReason === candidate.correctionReason,
      )
    ) {
      skippedSourceKeys.push(key!)
      continue
    }
    if (
      imported.length &&
      (!candidate.correctsId || imported.some((fact) => fact.sourceId !== sourceId))
    )
      throw new Error(
        `取込元キー ${key} の内容が変更されています。現在の事実を訂正元に指定し、訂正理由を入力してください。`,
      )
    const prior = activeOriginalCharges(ledger).find((fact) => fact.sourceId === sourceId)
    const record = existingRecord(workspace, candidate.category, candidate.record.id)
    if (
      prior
        ? candidate.correctsId !== prior.id || candidate.legacySourceId
        : candidate.correctsId !== undefined
    )
      throw new Error('訂正元が現在の原請求と一致しません。最新の記録を読み直してください。')
    if (!prior && record && candidate.legacySourceId !== sourceId)
      throw new Error(
        '同じIDの記録が既にあります。既存記録の訂正として元費用IDと理由を指定してください。',
      )
    if (candidate.legacySourceId && (!record || prior))
      throw new Error('既存記録の訂正元を確認してください。')
    const fact = originalChargeFactSchema.parse({
      ...candidate,
      id: options.createId?.() ?? `original-${globalThis.crypto.randomUUID()}`,
      recordedAt: options.recordedAt,
      sourceId,
      ...(candidate.legacySourceId ? { legacyPreviousRecord: structuredClone(record) } : {}),
    })
    ledger.facts.push(fact)
    replaceRecord(workspace, candidate)
    addedFactIds.push(fact.id)
  }
  if (addedFactIds.length || workspace.planning.originalCharges)
    workspace.planning.originalCharges = ledger
  planningSaveSchema.parse(workspace.planning)
  configurationSchema.parse(workspace.configuration)
  const envelope = {
    expectedRevision: workspace.revision,
    requestId: 'x'.repeat(36),
    previewHash: '0'.repeat(64),
    configuration: workspace.configuration,
    planning: workspace.planning,
  }
  if (utf8Bytes(JSON.stringify(envelope)) > WORKSPACE_BODY_LIMIT)
    throw new Error(
      '入力全体が保存上限（UTF-8のJSON全体で2 MiB）を超えています。取込件数を減らしてください。',
    )
  validateOriginalChargeBindings(workspace)
  return { workspace, addedFactIds, skippedSourceKeys }
}

function importCandidate(
  value: unknown,
  kind: 'csv' | 'json' | 'receipt',
): OriginalChargeCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('原請求の取込行はオブジェクトにしてください。')
  const raw = value as Record<string, unknown>
  const provenance = raw.provenance as Record<string, unknown> | undefined
  if (
    provenance !== undefined &&
    (!provenance ||
      typeof provenance !== 'object' ||
      Array.isArray(provenance) ||
      Object.keys(provenance).some((key) => !['kind', 'sourceKey', 'contentHash'].includes(key)))
  )
    throw new Error('取込元情報に未対応の項目があります。')
  if (
    provenance?.kind !== undefined &&
    !['manual', 'csv', 'json', 'receipt'].includes(String(provenance.kind))
  )
    throw new Error('取込元情報の形式を確認してください。')
  const { sourceKey: topKey, ...fields } = raw
  if (
    topKey !== undefined &&
    provenance?.sourceKey !== undefined &&
    topKey !== provenance.sourceKey
  )
    throw new Error('取込元キーが一致しません。')
  const sourceKey = topKey ?? provenance?.sourceKey
  if (typeof sourceKey !== 'string' || !sourceKey.trim() || sourceKey.length > 300)
    throw new Error('取込元キー sourceKey を指定してください。別契約は別のキーにしてください。')
  // Validate with manual provenance first; digest exactly the normalized payload, not parser input.
  const candidate = originalChargeCandidateSchema.parse({
    ...fields,
    provenance: { kind: 'manual' },
  })
  const contentHash = originalChargeContentHash(candidate)
  if (provenance?.contentHash !== undefined && provenance.contentHash !== contentHash)
    throw new Error('取込の内容hashが原請求と一致しません。')
  return originalChargeCandidateSchema.parse({
    ...candidate,
    provenance: { kind, sourceKey, contentHash },
  })
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    endedQuote = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
          endedQuote = true
        }
      } else field += char
      continue
    }
    if (char === '"') {
      if (field || endedQuote) throw new Error('CSVの引用符を確認してください。')
      quoted = true
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field)
      field = ''
      endedQuote = false
      if (char !== ',') {
        rows.push(row)
        row = []
        if (char === '\r' && text[index + 1] === '\n') index++
        if (rows.length > ORIGINAL_CHARGE_IMPORT_ROWS + 1)
          throw new Error('CSVの件数上限を超えています。')
      }
    } else {
      if (endedQuote) throw new Error('CSVの引用符の後には区切り文字が必要です。')
      field += char
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません。')
  if (field || row.length || endedQuote) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Strict bounded structured input. File names, paths and raw payloads are never returned. */
export function parseOriginalChargeImport(
  text: string,
  format: 'json' | 'csv',
): OriginalChargeCandidate[] {
  if (
    typeof text !== 'string' ||
    new TextEncoder().encode(text).byteLength > ORIGINAL_CHARGE_IMPORT_LIMIT
  )
    throw new Error('原請求ファイルは512 KiB以内にしてください。')
  const source = text.replace(/^\uFEFF/, '')
  let records: unknown[]
  if (format === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      throw new Error('JSONの形式を確認してください。')
    }
    const schema = z.union([
      z.array(z.unknown()).max(ORIGINAL_CHARGE_IMPORT_ROWS),
      z.strictObject({
        version: z.literal(1),
        candidates: z.array(z.unknown()).max(ORIGINAL_CHARGE_IMPORT_ROWS),
      }),
    ])
    const envelope = schema.parse(parsed)
    records = Array.isArray(envelope) ? envelope : envelope.candidates
  } else if (format === 'csv') {
    const [header, ...rows] = parseCsv(source)
    if (
      !header ||
      header.some((key) => !(ORIGINAL_CHARGE_CSV_COLUMNS as readonly string[]).includes(key)) ||
      new Set(header).size !== header.length ||
      ['category', 'record', 'original', 'evidenceIds', 'sourceKey'].some(
        (key) => !header.includes(key),
      )
    )
      throw new Error('CSVの列名・必須列・重複列を確認してください。')
    const structured = new Set([
      'record',
      'original',
      'dates',
      'servicePeriod',
      'contract',
      'evidenceIds',
    ])
    records = rows.map((row, index) => {
      if (row.length !== header.length)
        throw new Error(`CSV ${index + 2}行目の列数が一致しません。`)
      return Object.fromEntries(
        header.flatMap((key, column) => {
          const value = row[column]
          if (!value) return []
          if (!structured.has(key)) return [[key, value]]
          try {
            return [[key, JSON.parse(value)]]
          } catch {
            throw new Error(`CSV ${index + 2}行目の${key}はJSONで指定してください。`)
          }
        }),
      )
    })
  } else throw new Error('対応形式はCSVまたはJSONです。')
  if (!records.length || records.length > ORIGINAL_CHARGE_IMPORT_ROWS)
    throw new Error('原請求を1件以上500件以内で指定してください。')
  return records.map((record) => importCandidate(record, format))
}

/** Future receipt extraction supplies the same structured candidates; it cannot bypass validation. */
export type OriginalChargeCandidateAdapter<Payload> = {
  kind: 'receipt'
  extract(payload: Payload): unknown[]
}
export function adaptOriginalChargeCandidates<Payload>(
  adapter: OriginalChargeCandidateAdapter<Payload>,
  payload: Payload,
): OriginalChargeCandidate[] {
  const records = adapter.extract(payload)
  if (!Array.isArray(records) || !records.length || records.length > ORIGINAL_CHARGE_IMPORT_ROWS)
    throw new Error('領収書の抽出候補は1件以上500件以内にしてください。')
  return records.map((record) => importCandidate(record, 'receipt'))
}
