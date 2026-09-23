import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { checkEquipmentCarry } from '../../src/core/equipmentCarryCheck.js'
import type { ReviewMaterials } from '../../src/accounting/reviewMaterials.js'
function materials(method = 'three-year-pool'): ReviewMaterials {
  return {
    year: 2027,
    planning: {
      equipmentMethods: [
        {
          equipmentId: 'pc',
          taxYear: 2027,
          method,
          priorClosing: { taxYear: 2026, amountJpy: 120000, reference: 'actual prior' },
          poolElection: { serviceYear: 2026, reference: 'election', roundingConfirmed: true },
        },
      ],
    },
  } as unknown as ReviewMaterials
}
const prior = (engine = 'jp-individual-equipment-pool/1', closing = 120000) => ({
  id: 'prior',
  year: 2026,
  materials: {
    equipmentCalculations: [
      {
        equipmentId: 'pc',
        taxYear: 2026,
        result: { engineVersion: engine, calculation: { closingBasisJpy: closing } },
      },
    ],
  } as ReviewMaterials,
})
describe('pool continuity through the existing adopted-material check', () => {
  it('matches actual saved pool closing without mutating either record', () => {
    const now = materials(),
      previous = prior(),
      before = structuredClone([now, previous])
    assert.equal(checkEquipmentCarry(now, previous).rows[0]!.status, 'matched')
    assert.deepEqual([now, previous], before)
  })
  it('rejects the same amount from a different prior method', () => {
    assert.equal(
      checkEquipmentCarry(materials(), prior('jp-individual-tangible-straight-line/1')).rows[0]!
        .status,
      'mismatch',
    )
  })
  it('does not switch away from a pool just because its balance is small', () => {
    assert.equal(
      checkEquipmentCarry(materials('straight-line'), prior()).rows[0]!.status,
      'mismatch',
    )
  })
  it('allows a first service-year election when the prior acquired asset was unserved', () => {
    const now = materials()
    now.planning.equipmentMethods![0]!.poolElection!.serviceYear = 2027
    assert.equal(
      checkEquipmentCarry(now, prior('jp-individual-tangible-straight-line/1')).rows[0]!.status,
      'matched',
    )
  })
  it('still rejects changed versions or amounts and never fills absent prior data', () => {
    const now = materials()
    now.planning.equipmentMethods![0]!.priorReviewId = 'other'
    assert.equal(checkEquipmentCarry(now, prior()).rows[0]!.status, 'mismatch')
    delete now.planning.equipmentMethods![0]!.priorReviewId
    assert.equal(checkEquipmentCarry(now, prior(undefined, 120001)).rows[0]!.status, 'mismatch')
    assert.equal(checkEquipmentCarry(now, null).rows[0]!.status, 'unavailable')
  })
  it('leaves old non-pool carry checks unchanged', () => {
    assert.equal(
      checkEquipmentCarry(
        materials('straight-line'),
        prior('jp-individual-tangible-straight-line/1'),
      ).rows[0]!.status,
      'matched',
    )
  })
})
