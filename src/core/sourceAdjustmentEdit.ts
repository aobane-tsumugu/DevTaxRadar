import { validateSourceAdjustments, type SourceAdjustmentRecord } from './sourceAdjustments.js'

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => JSON.stringify(key) + ':' + stable(entry))
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'undefined'
}

/** Keep unrelated records and reject an edit based on a superseded record. */
export function editSourceAdjustment(
  current: readonly SourceAdjustmentRecord[],
  next: SourceAdjustmentRecord | null,
  previous: SourceAdjustmentRecord | null,
): SourceAdjustmentRecord[] {
  validateSourceAdjustments(current)
  if (!next && !previous) throw new Error('変更する返金・訂正記録がありません。')
  if (next) validateSourceAdjustments([next])
  if (previous) validateSourceAdjustments([previous])
  if (next && previous && next.id !== previous.id)
    throw new Error('編集する記録IDを変更できません。')
  const id = next?.id ?? previous!.id
  const existing = current.find((row) => row.id === id)
  if (stable(existing) === stable(next ?? undefined)) return structuredClone([...current])
  if (stable(existing) !== stable(previous ?? undefined))
    throw new Error(
      '編集中にこの返金・訂正が変わりました。入力は保持しています。最新の記録を読み直して比較してください。',
    )
  const result = current.filter((row) => row.id !== id)
  if (next) result.push(next)
  validateSourceAdjustments(result)
  return structuredClone(result)
}
