import { expect, it } from 'vitest'
import type { AnnualCostProjection } from '../../src/accounting/costs.js'
import { costLotLabel, describeCostLots } from '../../src/core/costLotLabel.js'

it('uses the supplied year and source names, preserves multiple origins, and never decodes missing IDs', () => {
  const costs: AnnualCostProjection = {
    version: 1,
    engineVersion: 'cost-projection/1',
    year: 2026,
    invariantSatisfied: true,
    sources: ['請求書A', '設備B'].map((label, i) => ({
      id: 's' + i,
      label,
      kind: 'direct',
      originalAmountJpy: 10,
      currency: 'JPY',
      evidenceIds: [],
      origin: 'entered',
    })),
    bases: [
      {
        id: 'b',
        sourceId: 's0',
        parentContributionIds: [],
        affectedTaxUnitIds: ['u'],
        period: { startedOn: '2026-01-01', endedOn: '2026-12-31' },
        amount: { status: 'known', amountJpy: 10 },
        method: { id: 'm', version: '1', explanation: '合成' },
        warnings: [],
      },
    ],
    contributions: [
      {
        id: 'same',
        basisId: 'b',
        sourceIds: ['s0', 's1'],
        target: { kind: 'tax-unit', taxUnitId: 'u' },
        amountJpy: 10,
        reason: '合成',
        evidenceIds: [],
      },
    ],
    byTaxUnit: [
      {
        taxUnitId: 'u',
        name: '当時の制作物',
        amountJpy: 10,
        contributionIds: ['same'],
        unknownBasisIds: [],
      },
    ],
    totals: {
      knownBasisJpy: 10,
      taxUnitJpy: 10,
      generalJpy: 0,
      privateJpy: 0,
      unallocatedJpy: 0,
      unobservedJpy: 0,
      roundingJpy: 0,
      unknownBasisIds: [],
    },
  }
  const labels = describeCostLots([costs])
  const lot = { costYear: 2026, contributionId: 'same' }
  expect(costLotLabel(lot, labels)).toBe(
    '2026年 / 請求書A + 設備B / 2026-01-01〜2026-12-31 / 当時の制作物 / 費用配分ID same',
  )
  costs.sources[0]!.label = '現在の名称'
  expect(costLotLabel(lot, labels)).not.toContain('現在の名称')
  expect(costLotLabel({ ...lot, costYear: 2027 }, labels)).toContain('未収録')
  expect(
    costLotLabel({ costYear: 2026, contributionId: 'direct:invented:2026-01-01' }, labels),
  ).toContain('費用名・対象期間未収録')
  costs.sources = []
  costs.bases = []
  expect(costLotLabel(lot, describeCostLots([costs]))).toContain(
    '費用名未収録 + 費用名未収録 / 対象期間未収録',
  )
})
