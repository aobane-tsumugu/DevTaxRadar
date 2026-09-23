import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import {
  equipmentMethodSchema,
  equipmentMethodsSchema,
  type EquipmentAnnualMethod,
} from '../../src/planning/equipmentMethods.js'
import { planningSaveSchema } from '../../src/planning/schema.js'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'
import {
  initializeEquipmentMethodsSchema,
  readEquipmentMethods,
  writeEquipmentMethods,
} from '../../src/server/equipmentMethodsRepository.js'
function fixture() {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits = [
    {
      id: 'software',
      name: '合成ソフト',
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'efficiency',
      lifecycleStatus: 'developing',
    },
  ]
  planning.evidence = [
    {
      id: 'proof',
      evidenceType: 'receipt',
      strength: 'external',
      recordedAt: '2026-09-20T00:00:00Z',
      note: '合成の取得と選択資料',
    },
  ]
  planning.equipment = [
    {
      id: 'pc',
      name: '合成PC',
      equipmentType: 'pc',
      acquisitionCostJpy: 150000,
      acquiredOn: '2026-01-01',
      businessUseStartedOn: '2026-07-01',
      convertedFromPrivate: false,
      businessUseRatio: 0.8,
      projectAllocationRatio: 0.5,
      taxUnitId: 'software',
      role: '製作',
      evidenceIds: ['proof'],
    },
  ]
  const method: EquipmentAnnualMethod = {
    id: 'method-2026',
    equipmentId: 'pc',
    taxYear: 2026,
    taxpayer: 'individual',
    assetKind: 'tangible-equipment',
    method: 'three-year-pool',
    methodReason: '供用年の選択',
    rentalUse: 'none',
    usefulLifeYears: null,
    useThroughYearEnd: 'unknown',
    ordinaryTreatment: 'confirmed',
    priorClosing: null,
    recordedAt: '2026-09-20T00:00:00Z',
    poolElection: { serviceYear: 2026, reference: '合成の原明細', roundingConfirmed: true },
    allocation: {
      businessUseRatio: 0.8,
      projectAllocationRatio: 0.5,
      taxUnitId: 'software',
      reason: '当年の利用実態',
    },
  }
  planning.equipmentMethods = [method]
  return { planning, method }
}
describe('pool schema, common cost projection and actual SQLite adapter', () => {
  it('preserves all election fields through the real planning schema', () => {
    const { planning, method } = fixture()
    assert.deepEqual(
      planningSaveSchema.parse(planning).equipmentMethods![0]!.poolElection,
      method.poolElection,
    )
    assert.equal(equipmentMethodSchema.parse(method).usefulLifeYears, null)
  })
  it('routes the selected pool into the existing source/basis/contribution graph and applies ratios once', () => {
    const { planning } = fixture(),
      costs = projectWorkspaceCosts(planning, [])
    assert.equal(costs.sources[0]!.originalAmountJpy, 150000)
    assert.equal(costs.totals.knownBasisJpy, 50000)
    assert.equal(costs.totals.privateJpy, 10000)
    assert.equal(costs.totals.taxUnitJpy, 20000)
    assert.equal(costs.totals.unallocatedJpy, 20000)
    assert.equal(costs.invariantSatisfied, true)
  })
  it('uses the real prior closing in year two and does not re-add the purchase amount', () => {
    const { planning, method } = fixture()
    planning.profile.taxYear = 2027
    planning.equipmentMethods!.push({
      ...method,
      id: 'method-2027',
      taxYear: 2027,
      priorClosing: { taxYear: 2026, amountJpy: 100000, reference: 'actual 2026 closing' },
    })
    assert.equal(
      projectWorkspaceCosts(planningSaveSchema.parse(planning), []).totals.knownBasisJpy,
      50000,
    )
  })
  it('keeps missing or changed prior closing unresolved, not zero or the acquisition amount', () => {
    const { planning, method } = fixture()
    planning.profile.taxYear = 2027
    planning.equipmentMethods = [{ ...method, id: 'method-2027', taxYear: 2027 }]
    const costs = projectWorkspaceCosts(planning, [])
    assert.ok(costs.bases.some((row) => row.amount.status === 'unknown'))
    assert.equal(costs.contributions.length, 0)
    assert.equal(costs.sources[0]!.originalAmountJpy, 150000)
  })
  it('does not silently overwrite an earlier elected method', () => {
    const { method } = fixture()
    assert.throws(
      () =>
        equipmentMethodsSchema.parse([
          { ...method, method: 'straight-line' },
          { ...method, id: 'later', taxYear: 2027 },
        ]),
      /選択が矛盾/,
    )
  })
  it('roundtrips using the real SQLite repository and rolls back with the existing caller savepoint', () => {
    const { method } = fixture(),
      db = new DatabaseSync(':memory:')
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE planning_equipment(id TEXT PRIMARY KEY) STRICT; INSERT INTO planning_equipment VALUES('pc');",
      )
      initializeEquipmentMethodsSchema(db)
      writeEquipmentMethods(db, [method])
      assert.deepEqual(readEquipmentMethods(db), [method])
      db.exec('SAVEPOINT planning; DELETE FROM planning_equipment_methods;')
      writeEquipmentMethods(db, [
        { ...method, poolElection: { ...method.poolElection!, reference: 'not committed' } },
      ])
      db.exec('ROLLBACK TO planning; RELEASE planning;')
      assert.deepEqual(readEquipmentMethods(db), [method])
    } finally {
      db.close()
    }
  })
  it('retains a no-pool legacy record without inventing new metadata', () => {
    const { method } = fixture()
    delete method.poolElection
    method.method = 'straight-line'
    method.usefulLifeYears = 4
    assert.equal(Object.hasOwn(equipmentMethodSchema.parse(method), 'poolElection'), false)
  })
})
