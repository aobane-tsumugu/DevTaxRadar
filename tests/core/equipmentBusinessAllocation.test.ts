import { expect, it } from 'vitest'
import { allocateEquipmentBusiness } from '../../src/core/equipmentBusinessAllocation.js'

it('conserves exact integer yen including unallocated, independent of input order', () => {
  const targets = [
    { taxUnitId: 'b', shareBps: 3333 },
    { taxUnitId: 'a', shareBps: 3333 },
  ]
  for (const amount of [0, 1, 2, 3, 100, 30001, Number.MAX_SAFE_INTEGER]) {
    const result = allocateEquipmentBusiness(amount, targets)
    expect(result.reduce((sum, row) => sum + BigInt(row.amountJpy), 0n)).toBe(BigInt(amount))
    expect(result.every((row) => Number.isSafeInteger(row.amountJpy) && row.amountJpy >= 0)).toBe(
      true,
    )
    expect(allocateEquipmentBusiness(amount, [...targets].reverse())).toEqual(result)
  }
  expect(
    allocateEquipmentBusiness(3, [
      { taxUnitId: 'b', shareBps: 5000 },
      { taxUnitId: 'a', shareBps: 5000 },
    ]),
  ).toEqual([
    { taxUnitId: null, amountJpy: 0 },
    { taxUnitId: 'a', amountJpy: 2 },
    { taxUnitId: 'b', amountJpy: 1 },
  ])
})
it('leaves unknown shares unallocated and rejects over-allocation, duplicates and invalid precision', () => {
  expect(
    allocateEquipmentBusiness(100, [
      { taxUnitId: 'a', shareBps: 2500 },
      { taxUnitId: 'b', shareBps: null },
    ]),
  ).toEqual([
    { taxUnitId: null, amountJpy: 75 },
    { taxUnitId: 'a', amountJpy: 25 },
    { taxUnitId: 'b', amountJpy: 0 },
  ])
  expect(allocateEquipmentBusiness(100, [])).toEqual([{ taxUnitId: null, amountJpy: 100 }])
  for (const targets of [
    [
      { taxUnitId: 'a', shareBps: 6000 },
      { taxUnitId: 'b', shareBps: 6000 },
    ],
    [
      { taxUnitId: 'a', shareBps: 1 },
      { taxUnitId: 'a', shareBps: 1 },
    ],
    [{ taxUnitId: 'a', shareBps: 0.1 }],
    [{ taxUnitId: 'a', shareBps: -1 }],
  ])
    expect(() => allocateEquipmentBusiness(100, targets)).toThrow()
})
