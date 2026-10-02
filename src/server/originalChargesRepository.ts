import { validateOriginalChargeBindings } from '../core/originalChargeIntake.js'
import type { DatabaseSync } from 'node:sqlite'
import { originalChargesSchema, type OriginalCharges } from '../planning/originalCharges.js'
import { canonicalTreatmentValue } from '../core/costTreatmentFacts.js'

const key = 'planning_original_charges_v1'
export class OriginalChargesConflict extends Error {}
export function readOriginalCharges(db: DatabaseSync): OriginalCharges | undefined {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row ? originalChargesSchema.parse(JSON.parse(row.value)) : undefined
}
/** Append-only factual provenance, never a second monetary ledger. */
export function validateOriginalChargesUpdate(
  db: DatabaseSync,
  value: OriginalCharges | undefined,
): OriginalCharges | undefined {
  const previous = readOriginalCharges(db)
  if (!value) {
    if (previous)
      throw new OriginalChargesConflict(
        '原始請求の記録を含む最新の計画を読み直してください。旧版からは保存できません。',
      )
    return
  }
  const next = originalChargesSchema.parse(value)
  for (const [index, fact] of (previous?.facts ?? []).entries()) {
    if (canonicalTreatmentValue(next.facts[index]) !== canonicalTreatmentValue(fact))
      throw new OriginalChargesConflict(
        '保存済みの原始請求は変更・削除できません。取り込み画面から訂正元と理由を付けて訂正してください。',
      )
  }
  return next
}
export function writeOriginalCharges(db: DatabaseSync, value: OriginalCharges | undefined): void {
  const next = validateOriginalChargesUpdate(db, value)
  if (!next) return
  db.prepare(
    'INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(key, JSON.stringify(next))
}

export function validateOriginalChargeWorkspace(
  input: Parameters<typeof validateOriginalChargeBindings>[0],
): void {
  try {
    validateOriginalChargeBindings(input)
  } catch (error) {
    throw new OriginalChargesConflict(
      error instanceof Error ? error.message : '原始請求と分類先の対応を確認してください。',
    )
  }
}

/** The server checks legacy correction origin against the saved row, not a client claim. */
export function validateOriginalChargeTransition(
  previous: Parameters<typeof validateOriginalChargeBindings>[0],
  next: Parameters<typeof validateOriginalChargeBindings>[0],
): void {
  const oldFacts = previous.planning.originalCharges?.facts ?? []
  const additions = (next.planning.originalCharges?.facts ?? []).slice(oldFacts.length)
  const rows = new Map<string, unknown>([
    ...(previous.configuration?.chargePeriods ?? []).map(
      (row) => [`ai:charge:${row.id}`, row] as const,
    ),
    ...previous.planning.equipment.map((row) => [`equipment:${row.id}`, row] as const),
    ...previous.planning.homeCosts.map((row) => [`home:${row.id}`, row] as const),
    ...previous.planning.directCosts.map((row) => [`direct:${row.id}`, row] as const),
  ])
  for (const fact of additions) {
    if (fact.category === 'subscription' && !previous.configuration) continue
    const row = rows.get(fact.sourceId)
    if (!fact.correctsId) {
      if (
        row &&
        (!fact.legacySourceId ||
          canonicalTreatmentValue(row) !== canonicalTreatmentValue(fact.legacyPreviousRecord))
      )
        throw new OriginalChargesConflict(
          '既存の原始請求の訂正前記録が保存済みの内容と一致しません。最新の記録から訂正してください。',
        )
      if (!row && fact.legacySourceId)
        throw new OriginalChargesConflict('訂正元の既存請求がありません。')
    }
    rows.set(fact.sourceId, fact.record)
  }
}
