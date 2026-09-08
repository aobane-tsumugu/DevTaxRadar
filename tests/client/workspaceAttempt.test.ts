// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import {
  listWorkspaceAttempts,
  writeWorkspaceAttempt,
  removeWorkspaceAttempt,
  type WorkspaceAttempt,
} from '../../src/client/workspaceAttempt'
import { emptyPlanningSnapshot } from '../../src/planning/types'
afterEach(() => localStorage.clear())
it('retains the exact request across reload, isolates datasets and refuses changed controls', () => {
  const configuration = {
    charges: { claude: 0, codex: 0 },
    monthlyCharges: [],
    contracts: { claude: {}, codex: {} },
    chargePeriods: [],
    unobservedRatio: null,
  }
  const planning = emptyPlanningSnapshot(2026)
  const record: WorkspaceAttempt = {
    version: 1,
    datasetId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    base: { revision: 1, configuration, planning },
    request: {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      configuration,
      planning,
      previewHash: 'a'.repeat(64),
    },
  }
  writeWorkspaceAttempt(localStorage, record)
  expect(listWorkspaceAttempts(localStorage, record.datasetId).records).toEqual([record])
  expect(listWorkspaceAttempts(localStorage, crypto.randomUUID()).records).toEqual([])
  expect(
    writeWorkspaceAttempt(localStorage, {
      ...record,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    }),
  ).toEqual(record)
  expect(() =>
    writeWorkspaceAttempt(localStorage, {
      ...record,
      request: { ...record.request, previewHash: 'b'.repeat(64) },
    }),
  ).toThrow('同じ保存要求')
  const key = localStorage.key(0)!
  localStorage.setItem(key, JSON.stringify({ ...record, version: 2 }))
  expect(listWorkspaceAttempts(localStorage, record.datasetId).unreadable).toBe(1)
  expect(() => removeWorkspaceAttempt(localStorage, record)).toThrow()
  localStorage.setItem(key, JSON.stringify(record))
  removeWorkspaceAttempt(localStorage, record)
  expect(localStorage.length).toBe(0)
  const broken = { ...record, base: { ...record.base, revision: 2 } }
  expect(() => writeWorkspaceAttempt(localStorage, broken)).toThrow()
  expect(() =>
    writeWorkspaceAttempt(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error('容量不足')
        },
      } as unknown as Storage,
      record,
    ),
  ).toThrow('容量不足')
})
