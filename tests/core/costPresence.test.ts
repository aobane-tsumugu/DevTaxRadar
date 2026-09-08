import { expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import {
  assessCostPresence,
  costPresenceRecordsSchema,
  type CostPresenceRecord,
} from '../../src/planning/costPresence.js'

const declaration: CostPresenceRecord = {
  id: 'direct-2026',
  taxYear: 2026,
  category: 'direct',
  status: 'not-applicable',
  reason: '当年の支払記録を確認した',
  recordedAt: '2026-12-31T12:00:00+09:00',
}
it('separates absent records from an explicit annual declaration and does not carry it to next year', () => {
  const planning = emptyPlanningSnapshot(2026)
  expect(assessCostPresence(planning, []).every((item) => item.status === 'unreviewed')).toBe(true)
  expect(assessCostPresence(planning, [declaration])[2].status).toBe('not-applicable')
  expect(assessCostPresence(planning, [declaration], 2027)[2].status).toBe('unreviewed')
})
it('keeps unknown and zero-valued expenses and exposes contradictory declarations', () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.directCosts = [
    {
      id: 'unknown',
      incurredOn: '2026-01-01',
      costType: 'other',
      amountJpy: null,
      unknownAmountReason: '確認待ち',
      directlyAttributable: false,
      treatment: 'general',
      evidenceIds: [],
    },
    {
      id: 'zero',
      incurredOn: '2026-01-02',
      costType: 'other',
      amountJpy: 0,
      directlyAttributable: false,
      treatment: 'general',
      evidenceIds: [],
    },
  ]
  const before = structuredClone(planning)
  expect(assessCostPresence(planning, [declaration])[2]).toMatchObject({
    status: 'conflict',
    recordIds: ['unknown', 'zero'],
  })
  expect(assessCostPresence(planning, [{ ...declaration, status: 'deferred' }])[2]).toMatchObject({
    status: 'deferred',
    recordIds: ['unknown', 'zero'],
  })
  expect(planning).toEqual(before)
})
it('includes older equipment until its use can be reviewed, but excludes future purchases from the year', () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.equipment = ['2025', '2027'].map((year) => ({
    id: year,
    name: year,
    equipmentType: 'pc',
    acquiredOn: `${year}-01-01`,
    acquisitionCostJpy: null,
    unknownAmountReason: '確認待ち',
    convertedFromPrivate: false,
    businessUseRatio: 1,
    role: '開発',
    projectAllocationRatio: 0,
    evidenceIds: [],
  }))
  expect(
    assessCostPresence(planning, [{ ...declaration, category: 'equipment' }])[0],
  ).toMatchObject({ status: 'conflict', recordIds: ['2025'] })
})
it('rejects incomplete declarations and duplicate annual categories rather than selecting one silently', () => {
  expect(costPresenceRecordsSchema.safeParse([{ ...declaration, reason: ' ' }]).success).toBe(false)
  expect(costPresenceRecordsSchema.safeParse([{ ...declaration, recordedAt: '' }]).success).toBe(
    false,
  )
  expect(
    costPresenceRecordsSchema.safeParse([declaration, { ...declaration, id: 'other' }]).success,
  ).toBe(false)
  expect(
    costPresenceRecordsSchema.safeParse([declaration, { ...declaration, category: 'home' }])
      .success,
  ).toBe(false)
})
