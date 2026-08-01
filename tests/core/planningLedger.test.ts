import { describe, expect, it } from 'vitest'
import { buildPlanningLedger } from '../../src/core/planningLedger.js'
import { emptyPlanningSnapshot, type PlanningSnapshot } from '../../src/planning/types.js'

function ledgerSnapshot(): PlanningSnapshot {
  const snapshot = emptyPlanningSnapshot(2026)
  snapshot.taxUnits = [{
    id: 'app-v1',
    name: 'App v1',
    unitType: 'new-software',
    usageMode: 'mixed',
    revenueModel: 'sales',
    lifecycleStatus: 'developing',
    completionCriteria: '正式利用テストに合格',
    sameAsExternalVersion: 'yes',
  }]
  snapshot.equipment = [{
    id: 'pc-1',
    name: '開発PC',
    equipmentType: 'pc',
    acquisitionCostJpy: 480_000,
    acquiredOn: '2026-01-10',
    businessUseStartedOn: '2026-01-10',
    convertedFromPrivate: false,
    businessUseRatio: 0.8,
    usefulLifeYears: 4,
    role: '開発',
    taxUnitId: 'app-v1',
    projectAllocationRatio: 0.75,
    evidenceIds: ['receipt'],
  }]
  snapshot.homeCosts = [{
    id: 'rent-07',
    month: '2026-07',
    category: 'rent',
    amountJpy: 100_000,
    method: 'area-time',
    businessUseRatio: 0.2,
    basis: '面積20%と利用時間',
    rationale: '共用室のため',
    taxUnitId: 'app-v1',
    projectAllocationRatio: 0.5,
    treatment: 'shared',
    evidenceIds: ['rent-receipt'],
  }]
  snapshot.directCosts = [{
    id: 'license-1',
    taxUnitId: 'app-v1',
    incurredOn: '2026-07-01',
    costType: 'license',
    amountJpy: 30_000,
    directlyAttributable: true,
    treatment: 'direct',
    evidenceIds: ['license-receipt'],
  }]
  return snapshot
}

function expectConservation(snapshot: PlanningSnapshot): void {
  const ledger = buildPlanningLedger(snapshot)
  for (const item of ledger.contributions) {
    expect(item.grossAmountJpy).toBe(item.businessAmountJpy + item.privateAmountJpy)
    expect(item.businessAmountJpy).toBe(item.allocatedAmountJpy + item.unallocatedAmountJpy)
  }
  expect(ledger.totals.grossAmountJpy).toBe(
    ledger.totals.businessAmountJpy + ledger.totals.privateAmountJpy,
  )
  expect(ledger.totals.businessAmountJpy).toBe(
    ledger.totals.allocatedAmountJpy + ledger.totals.unallocatedAmountJpy,
  )
}

describe('buildPlanningLedger', () => {
  it('allocates equipment depreciation candidate, home cost and direct cost', () => {
    const snapshot = ledgerSnapshot()
    const result = buildPlanningLedger(snapshot)

    expect(result.totals).toEqual({
      grossAmountJpy: 250_000,
      businessAmountJpy: 146_000,
      allocatedAmountJpy: 112_000,
      privateAmountJpy: 104_000,
      unallocatedAmountJpy: 34_000,
    })
    expect(result.byTaxUnit).toEqual([expect.objectContaining({
      taxUnitId: 'app-v1',
      amountJpy: 112_000,
      candidate: '新規ソフトウェア取得価額候補',
    })])
    expectConservation(snapshot)
  })

  it('uses opening balance for a converted private asset and applies month proration', () => {
    const snapshot = ledgerSnapshot()
    snapshot.homeCosts = []
    snapshot.directCosts = []
    snapshot.equipment[0] = {
      ...snapshot.equipment[0],
      convertedFromPrivate: true,
      openingUnamortizedBalanceJpy: 240_000,
      businessUseStartedOn: '2026-07-01',
      businessUseRatio: 1,
      projectAllocationRatio: 1,
    }

    const result = buildPlanningLedger(snapshot)

    expect(result.contributions[0]).toEqual(expect.objectContaining({
      grossAmountJpy: 30_000,
      businessAmountJpy: 30_000,
      allocatedAmountJpy: 30_000,
      privateAmountJpy: 0,
      unallocatedAmountJpy: 0,
    }))
    expectConservation(snapshot)
  })

  it.each([
    [99_999, 99_999],
    [100_000, 12_500],
  ])('applies the under-100k boundary at %i yen', (cost, expected) => {
    const snapshot = ledgerSnapshot()
    snapshot.homeCosts = []
    snapshot.directCosts = []
    snapshot.equipment[0] = {
      ...snapshot.equipment[0],
      acquisitionCostJpy: cost,
      businessUseStartedOn: '2026-07-01',
      businessUseRatio: 1,
      projectAllocationRatio: 1,
      usefulLifeYears: cost < 100_000 ? undefined : 4,
    }

    const result = buildPlanningLedger(snapshot)

    expect(result.contributions[0].grossAmountJpy).toBe(expected)
    if (cost < 100_000) {
      expect(result.contributions[0].warnings.join(' ')).toContain('全額必要経費候補')
    } else {
      expect(result.contributions[0].warnings.join(' ')).not.toContain('全額必要経費候補')
    }
    expectConservation(snapshot)
  })

  it('does not repeat an under-100k expense after its placed-in-service year', () => {
    const snapshot = ledgerSnapshot()
    snapshot.homeCosts = []
    snapshot.directCosts = []
    snapshot.equipment[0] = {
      ...snapshot.equipment[0],
      acquisitionCostJpy: 99_999,
      businessUseStartedOn: '2025-07-01',
      businessUseRatio: 1,
      projectAllocationRatio: 1,
      usefulLifeYears: undefined,
    }

    const result = buildPlanningLedger(snapshot)

    expect(result.contributions[0].grossAmountJpy).toBe(0)
    expect(result.contributions[0].warnings.join(' ')).toContain('対象年より前')
    expectConservation(snapshot)
  })

  it('only includes home and direct costs from the selected tax year', () => {
    const snapshot = ledgerSnapshot()
    snapshot.equipment = []
    snapshot.homeCosts.push({ ...snapshot.homeCosts[0], id: 'rent-2025', month: '2025-12' })
    snapshot.directCosts.push({ ...snapshot.directCosts[0], id: 'license-2027', incurredOn: '2027-01-01' })

    const result = buildPlanningLedger(snapshot)

    expect(result.contributions.map((item) => item.sourceId)).toEqual(['rent-07', 'license-1'])
    expect(result.totals.grossAmountJpy).toBe(130_000)
    expectConservation(snapshot)
  })

  it('keeps unknown useful life as a warned unallocated basis instead of zero', () => {
    const snapshot = ledgerSnapshot()
    snapshot.homeCosts = []
    snapshot.directCosts = []
    snapshot.equipment[0] = {
      ...snapshot.equipment[0],
      acquisitionCostJpy: 600_000,
      usefulLifeYears: undefined,
      businessUseRatio: 0.9,
      projectAllocationRatio: 1,
    }

    const result = buildPlanningLedger(snapshot)
    const item = result.contributions[0]

    expect(item.grossAmountJpy).toBe(600_000)
    expect(item.allocatedAmountJpy).toBe(0)
    expect(item.unallocatedAmountJpy).toBe(540_000)
    expect(item.warnings.join(' ')).toContain('耐用年数候補が未確認')
    expect(result.byTaxUnit[0].amountJpy).toBe(0)
    expectConservation(snapshot)
  })

  it('does not allocate general home costs or non-attributable direct costs', () => {
    const snapshot = ledgerSnapshot()
    snapshot.equipment = []
    snapshot.homeCosts[0].treatment = 'general'
    snapshot.directCosts[0].directlyAttributable = false

    const result = buildPlanningLedger(snapshot)

    expect(result.totals.allocatedAmountJpy).toBe(0)
    expect(result.totals.unallocatedAmountJpy).toBe(result.totals.businessAmountJpy)
    expect(result.contributions.flatMap((item) => item.warnings).join(' ')).toContain('自動配賦せず')
    expectConservation(snapshot)
  })

  it('maps improvement and sales units to detailed candidates', () => {
    const snapshot = ledgerSnapshot()
    snapshot.taxUnits.push(
      {
        id: 'upgrade', name: '決済改良', unitType: 'improvement-plan', usageMode: 'external',
        revenueModel: 'subscription', lifecycleStatus: 'improving', completionCriteria: '本番反映',
      },
      {
        id: 'content', name: '販売コンテンツ', unitType: 'sales-production', usageMode: 'external',
        revenueModel: 'sales', lifecycleStatus: 'developing', completionCriteria: '販売可能な原稿',
      },
    )

    const result = buildPlanningLedger(snapshot)

    expect(result.byTaxUnit.find((unit) => unit.taxUnitId === 'upgrade')?.candidate).toBe('資本的支出候補')
    expect(result.byTaxUnit.find((unit) => unit.taxUnitId === 'content')?.candidate).toBe('制作原価・仕掛品候補')
  })
})
