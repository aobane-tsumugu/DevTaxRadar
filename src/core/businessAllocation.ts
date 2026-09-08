import { allocationTargetsSchema, type AllocationTarget } from '../planning/allocationTargets.js'

/** Exact basis-point allocation, including unallocated weight; ties use stable target IDs. */
export function allocateBusinessTargets(amountJpy: number, input: AllocationTarget[]) {
  if (!Number.isSafeInteger(amountJpy) || amountJpy < 0)
    throw new Error('業務額は非負の安全な整数円が必要です。')
  const targets = allocationTargetsSchema.parse(input)
  const total = targets.reduce((sum, row) => sum + (row.shareBps ?? 0), 0)
  const weights = [
    ...targets.map((row) => ({
      key: 'unit:' + row.taxUnitId,
      taxUnitId: row.taxUnitId as string | null,
      weight: row.shareBps ?? 0,
    })),
    { key: 'unallocated', taxUnitId: null, weight: 10000 - total },
  ]
  const rows = weights.map((row) => {
    const product = BigInt(amountJpy) * BigInt(row.weight)
    return { ...row, amountJpy: Number(product / 10000n), remainder: product % 10000n }
  })
  let remaining = amountJpy - rows.reduce((sum, row) => sum + row.amountJpy, 0)
  const order = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1,
  )
  for (const row of order) {
    if (!remaining) break
    row.amountJpy++
    remaining--
  }
  return rows
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ taxUnitId, amountJpy }) => ({ taxUnitId, amountJpy }))
}
