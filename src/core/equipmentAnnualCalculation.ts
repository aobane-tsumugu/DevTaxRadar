import type { EquipmentRecord } from '../planning/types.js'
import type { EquipmentAnnualMethod } from '../planning/equipmentMethods.js'
import {
  calculateEquipmentDepreciation,
  equipmentDepreciationInputSchema,
  type EquipmentDepreciationResult,
} from './equipmentDepreciation.js'

export type EquipmentAnnualCalculation = {
  equipmentId: string
  methodRecordId: string
  taxYear: number
  result: EquipmentDepreciationResult | null
  inputIssues: string[]
}

/** One calculation entrance for current costs and frozen annual materials. */
export function inspectEquipmentAnnualCalculation(
  equipment: EquipmentRecord,
  method: EquipmentAnnualMethod,
): EquipmentAnnualCalculation {
  const {
    id,
    recordedAt: _recordedAt,
    allocation: _allocation,
    priorReviewId: _priorReviewId,
    ...conditions
  } = method
  const input = equipmentDepreciationInputSchema.safeParse({
    ...conditions,
    acquisitionCostJpy: equipment.acquisitionCostJpy,
    acquiredOn: equipment.acquiredOn,
    businessUseStartedOn: equipment.businessUseStartedOn ?? null,
    convertedFromPrivate: equipment.convertedFromPrivate,
  })
  return {
    equipmentId: equipment.id,
    methodRecordId: id,
    taxYear: method.taxYear,
    result: input.success ? calculateEquipmentDepreciation(input.data) : null,
    inputIssues: input.success
      ? []
      : input.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  }
}
