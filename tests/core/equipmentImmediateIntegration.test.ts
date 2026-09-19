import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'
import { inspectEquipmentAnnualCalculation } from '../../src/core/equipmentAnnualCalculation.js'
import { equipmentMethodSchema } from '../../src/planning/equipmentMethods.js'
import {
  initializeEquipmentMethodsSchema, readEquipmentMethods, writeEquipmentMethods,
} from '../../src/server/equipmentMethodsRepository.js'

function fixture(year = 2026) {
  const planning = emptyPlanningSnapshot(year)
  planning.taxUnits = [{ id: 'software', name: '合成ソフト', unitType: 'new-software',
    usageMode: 'internal', revenueModel: 'efficiency', lifecycleStatus: 'developing' }]
  planning.evidence = [{ id: 'receipt', evidenceType: 'receipt', strength: 'external',
    recordedAt: '2026-06-01T00:00:00Z', note: '合成の取得価額の証拠' }]
  planning.equipment = [{ id: 'device', name: '少額設備', equipmentType: 'pc',
    acquisitionCostJpy: 80000, acquiredOn: '2026-04-01', businessUseStartedOn: '2026-06-01',
    convertedFromPrivate: false, businessUseRatio: 0.5, projectAllocationRatio: 1,
    taxUnitId: 'software', role: '製作', evidenceIds: ['receipt'] }]
  planning.equipmentMethods = [{ id: 'annual', equipmentId: 'device', taxYear: year,
    taxpayer: 'individual', assetKind: 'tangible-equipment', method: 'immediate-expense',
    rentalUse: 'none', methodReason: '設備全体額が10万円未満で貸付用ではない',
    usefulLifeYears: null, useThroughYearEnd: 'unknown', ordinaryTreatment: 'confirmed',
    priorClosing: null, recordedAt: '2026-06-01T00:00:00Z',
    allocation: { businessUseRatio: 0.5, projectAllocationRatio: 1,
      taxUnitId: 'software', reason: '合成の業務使用割合' } }]
  return planning
}

describe('small-equipment integration through the production schema, storage and common projection', () => {
  it('uses the actual schema and annual material calculation with no invented life', () => {
    const p = fixture(), method = equipmentMethodSchema.parse(p.equipmentMethods![0])
    const row = inspectEquipmentAnnualCalculation(p.equipment[0]!, method)
    assert.equal(row.result!.engineVersion, 'jp-individual-small-equipment/1')
    assert.equal(row.result!.calculation!.depreciationJpy, 80000)
    assert.deepEqual(row.inputIssues, [])
  })
  it('allocates the service-year expense once, keeping original price and private amount separate', () => {
    const p = fixture(), before = structuredClone(p)
    const projection = projectWorkspaceCosts(p, [])
    assert.equal(projection.sources[0]!.originalAmountJpy, 80000)
    assert.equal(projection.totals.knownBasisJpy, 80000)
    assert.equal(projection.totals.privateJpy, 40000)
    assert.equal(projection.totals.taxUnitJpy, 40000)
    assert.equal(projection.bases[0]!.method.id, 'jp-individual-small-equipment/1')
    assert.ok(projection.contributions.some((row) => row.reason.includes('少額設備')))
    assert.deepEqual(p, before)
  })
  it('does not reintroduce the purchase price into next-year costs', () => {
    const p = fixture(2027)
    p.equipmentMethods![0]!.priorClosing = { taxYear: 2026, amountJpy: 0, reference: '供用年に費用化' }
    const projection = projectWorkspaceCosts(p, [])
    assert.equal(projection.sources[0]!.originalAmountJpy, 80000)
    assert.equal(projection.totals.knownBasisJpy, 0)
    assert.equal(projection.contributions.length, 0)
    assert.deepEqual(projection.totals.unknownBasisIds, [])
  })
  it('leaves an unknown rental condition uncalculated instead of assuming ordinary use', () => {
    const p = fixture()
    delete p.equipmentMethods![0]!.rentalUse
    const projection = projectWorkspaceCosts(p, [])
    assert.equal(projection.bases[0]!.amount.status, 'unknown')
    assert.equal(projection.sources[0]!.originalAmountJpy, 80000)
  })
  it('rejects a purchase of 100000 even if the business share is only 50000', () => {
    const p = fixture(); p.equipment[0]!.acquisitionCostJpy = 100000
    const projection = projectWorkspaceCosts(p, [])
    assert.equal(projection.bases[0]!.amount.status, 'unknown')
    assert.equal(projection.totals.taxUnitJpy, 0)
  })
  it('retains ordinary depreciation for a larger equipment with an explicit life', () => {
    const p = fixture(); p.equipment[0]!.acquisitionCostJpy = 200000
    Object.assign(p.equipmentMethods![0]!, {
      method: 'straight-line', usefulLifeYears: 4, useThroughYearEnd: 'confirmed',
    })
    const row = inspectEquipmentAnnualCalculation(p.equipment[0]!, p.equipmentMethods![0]!)
    assert.equal(row.result!.engineVersion, 'jp-individual-tangible-straight-line/1')
    assert.equal(row.result!.calculation!.depreciationJpy, 29167)
  })
  it('persists the new method and rental condition in the existing JSON table', () => {
    const p = fixture(), db = new DatabaseSync(':memory:')
    try {
      db.exec("CREATE TABLE planning_equipment(id TEXT PRIMARY KEY); INSERT INTO planning_equipment VALUES ('device')")
      initializeEquipmentMethodsSchema(db)
      db.exec('SAVEPOINT existing_planning')
      writeEquipmentMethods(db, p.equipmentMethods!)
      assert.deepEqual(readEquipmentMethods(db), p.equipmentMethods)
      db.exec('ROLLBACK TO existing_planning; RELEASE existing_planning')
      assert.deepEqual(readEquipmentMethods(db), [])
    } finally { db.close() }
  })
})
