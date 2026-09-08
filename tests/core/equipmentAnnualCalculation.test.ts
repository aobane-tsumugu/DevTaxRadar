import { expect, it } from 'vitest'
import { inspectEquipmentAnnualCalculation } from '../../src/core/equipmentAnnualCalculation.js'
import type { EquipmentRecord } from '../../src/planning/types.js'
import type { EquipmentAnnualMethod } from '../../src/planning/equipmentMethods.js'

it('separates invalid input, missing facts and whole asset balances while ignoring allocation metadata', () => {
  const equipment: EquipmentRecord = {
    id: 'pc',
    name: 'PC',
    equipmentType: 'pc',
    acquisitionCostJpy: 240000,
    acquiredOn: '2026-01-01',
    businessUseStartedOn: '2026-07-31',
    businessUseRatio: 0.5,
    projectAllocationRatio: 1,
    convertedFromPrivate: false,
    role: '開発',
    evidenceIds: [],
  }
  const method: EquipmentAnnualMethod = {
    id: 'm',
    equipmentId: 'pc',
    taxYear: 2026,
    taxpayer: 'individual',
    assetKind: 'tangible-equipment',
    method: 'straight-line',
    methodReason: '確認資料',
    usefulLifeYears: 4,
    useThroughYearEnd: 'confirmed',
    ordinaryTreatment: 'confirmed',
    priorClosing: null,
    recordedAt: '2026-09-08T00:00:00Z',
    allocation: {
      taxUnitId: null,
      businessUseRatio: null,
      projectAllocationRatio: null,
      reason: '',
    },
  }
  expect(inspectEquipmentAnnualCalculation(equipment, method).result?.calculation).toMatchObject({
    openingBasisJpy: 240000,
    depreciationJpy: 30000,
    closingBasisJpy: 210000,
  })
  method.usefulLifeYears = null
  expect(inspectEquipmentAnnualCalculation(equipment, method).result?.status).toBe('missing-facts')
  equipment.acquiredOn = '2026-02-30'
  const invalid = inspectEquipmentAnnualCalculation(equipment, method)
  expect(invalid.result).toBeNull()
  expect(invalid.inputIssues.join(' ')).toContain('acquiredOn')
  expect(equipment.acquiredOn).toBe('2026-02-30')
})
