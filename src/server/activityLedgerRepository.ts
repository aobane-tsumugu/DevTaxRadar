import type { DatabaseSync } from 'node:sqlite'
import { activityLedgerSchema, type ActivityLedger } from '../planning/activityFacts.js'
import { canonicalTreatmentValue } from '../core/costTreatmentFacts.js'

const key = 'planning_activity_ledger_v1'
export class ActivityLedgerConflict extends Error {}
export function readActivityLedger(db: DatabaseSync): ActivityLedger | undefined {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row ? activityLedgerSchema.parse(JSON.parse(row.value)) : undefined
}
/** Additive data migration on the existing atomic workspace boundary. No legacy fact is promoted. */
export function validateActivityLedgerUpdate(
  db: DatabaseSync,
  value: ActivityLedger | undefined,
): ActivityLedger | undefined {
  const previous = readActivityLedger(db)
  if (!value) {
    if (previous)
      throw new ActivityLedgerConflict(
        '活動記録を含む最新の計画を読み直してください。旧版からは保存できません。',
      )
    return
  }
  const next = activityLedgerSchema.parse(value)
  if (previous) {
    for (const fact of previous.facts) {
      if (
        canonicalTreatmentValue(next.facts.find((row) => row.id === fact.id)) !==
        canonicalTreatmentValue(fact)
      )
        throw new ActivityLedgerConflict(
          '保存済みの活動事実は変更・削除できません。訂正理由を付けた新しい事実を追加してください。',
        )
    }
    for (const product of previous.products)
      if (!next.products.some((row) => row.id === product.id))
        throw new ActivityLedgerConflict('制作物の識別子は保持してください。')
    for (const link of previous.unitLinks)
      if (
        !next.unitLinks.some(
          (row) => canonicalTreatmentValue(row) === canonicalTreatmentValue(link),
        )
      )
        throw new ActivityLedgerConflict('保存済みの制作物と費用単位の対応は保持してください。')
  }
  return next
}
export function writeActivityLedger(db: DatabaseSync, value: ActivityLedger | undefined): void {
  const next = validateActivityLedgerUpdate(db, value)
  if (!next) return
  db.prepare(
    'INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(key, JSON.stringify(next))
}
