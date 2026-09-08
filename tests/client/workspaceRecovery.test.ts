// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { planningSnapshotSchema } from '../../src/planning/schema'
import {
  encodeWorkspaceRecovery,
  decodeWorkspaceRecovery,
  writeWorkspaceRecovery,
  listWorkspaceRecovery,
  removeWorkspaceRecovery,
  type WorkspaceRecovery,
} from '../../src/client/workspaceRecovery'
afterEach(() => localStorage.clear())
function fixture(): WorkspaceRecovery {
  const planning = emptyPlanningSnapshot(2026)
  const configuration = {
    charges: { claude: 0, codex: 0 },
    contracts: { claude: {}, codex: {} },
    monthlyCharges: [],
    chargePeriods: [],
    unobservedRatio: null,
  }
  return {
    version: 1,
    datasetId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    base: { revision: 1, planning, configuration },
    input: {
      monthlyCharges: [],
      contracts: configuration.contracts,
      chargePeriods: [],
      unobservedPercent: null,
      planning: structuredClone(planning),
      selectedProviders: [],
      candidateDestinations: {},
      step: 3,
    },
  }
}
it('preserves unfinished dates, whitespace, NaN, unknown amounts and candidate grouping without relaxing persistence', () => {
  const record = fixture()
  record.input.claudeCharge = null
  record.input.unknownChargeReasons = { claude: '  ' }
  record.input.planning.profile.taxYear = NaN
  record.input.planning.profile.activityStartedOn = ''
  record.input.planning.profile.notes = '  入力途中  '
  record.input.planning.equipmentMethods = [
    {
      id: 'method',
      equipmentId: 'unfinished',
      taxYear: 2026,
      taxpayer: 'unknown',
      assetKind: 'unknown',
      method: 'unknown',
      methodReason: '  確認途中  ',
      allocation: {
        businessUseRatio: NaN,
        projectAllocationRatio: null,
        reason: '  割合の入力途中  ',
      },
      usefulLifeYears: NaN,
      useThroughYearEnd: 'unknown',
      ordinaryTreatment: 'unknown',
      priorClosing: { taxYear: 2025, amountJpy: NaN, reference: '' },
      recordedAt: '',
    },
  ]
  record.input.planning.costPresence = [
    {
      id: 'presence',
      taxYear: 2026,
      category: 'home',
      status: 'deferred',
      reason: '  理由の入力途中  ',
      recordedAt: '',
    },
  ]
  record.input.planning.directCosts.push({
    id: 'unfinished',
    incurredOn: '',
    costType: 'other',
    amountJpy: null,
    unknownAmountReason: '',
    directlyAttributable: true,
    treatment: 'direct',
    evidenceIds: [],
  })
  record.input.candidateDestinations = { candidate: { kind: 'product', group: '' } }
  const decoded = decodeWorkspaceRecovery(encodeWorkspaceRecovery(record))
  expect(decoded).toEqual(record)
  expect(Number.isNaN(decoded.input.planning.profile.taxYear)).toBe(true)
  expect(planningSnapshotSchema.safeParse(decoded.input.planning).success).toBe(false)
  const invalid = structuredClone(record)
  ;(invalid.input.planning.profile as unknown as Record<string, unknown>).filingType = 'unsupported'
  expect(() => encodeWorkspaceRecovery(invalid)).toThrow()
})
it('isolates datasets, retains unknown formats and removes only the selected immutable record', () => {
  const record = fixture()
  writeWorkspaceRecovery(localStorage, record)
  const next = { ...record, id: crypto.randomUUID() }
  writeWorkspaceRecovery(localStorage, next)
  expect(() =>
    writeWorkspaceRecovery(localStorage, { ...record, createdAt: '2026-01-01T00:00:00Z' }),
  ).toThrow()
  localStorage.setItem(`devtax:workspace-input:v1:${record.datasetId}:future`, '{"version":2}')
  removeWorkspaceRecovery(localStorage, record)
  expect(listWorkspaceRecovery(localStorage, record.datasetId)).toEqual({
    records: [next],
    unreadable: 1,
  })
  expect(listWorkspaceRecovery(localStorage, crypto.randomUUID()).records).toEqual([])
})

it('retains incomplete contract correspondence and the original confirmation snapshot', () => {
  const record = fixture()
  const period = { id:'a',provider:'claude' as const,planName:'合成',serviceStartedOn:'2026-01-01',serviceEndedOn:'2026-01-31',amountJpy:1000 }
  record.input.chargePeriods = [{...period,contractConfirmation:{reference:'  入力途中  ',reason:'',basis:period}}]
  expect(decodeWorkspaceRecovery(encodeWorkspaceRecovery(record))).toEqual(record)
})