import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { AnnualCostProjection } from '../../src/accounting/costs.js'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace.js'
import { readSoftwareAcquisitionInputs } from '../../src/client/softwareAcquisitionRead.js'

function readers() {
  return {
    runtime: async () => ({ datasetId: 'local-a' }),
    workspace: async () => ({ revision: 7 }),
    projection: async (year: number) => ({ year }) as AnnualCostProjection,
    review: async (id: string) => ({ review: { id, year: 2024 } as BalanceReview }),
  }
}
describe('bounded multi-year reads reuse the existing dataset guard', () => {
  it('returns the explicitly selected years and opening version, without mutating the requests', async () => {
    const years = [2026, 2025], ids = ['opening-version']
    const result = await readSoftwareAcquisitionInputs('local-a', years, ids, readers())
    assert.deepEqual(result.costs.map((row) => row.year), [2025, 2026])
    assert.equal(result.workspaceRevision, 7)
    assert.equal(result.openingReviews[0]!.id, 'opening-version')
    assert.deepEqual(years, [2026, 2025]); assert.deepEqual(ids, ['opening-version'])
  })
  it('does not issue more than four projection reads at once', async () => {
    const r = readers(); let active = 0, peak = 0
    r.projection = async (year) => {
      active++; peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--; return { year } as AnnualCostProjection
    }
    const result = await readSoftwareAcquisitionInputs('local-a', [2020,2021,2022,2023,2024,2025,2026], [], r)
    assert.equal(result.costs.length, 7); assert.equal(peak, 4)
  })
  it('rejects the wrong requested year', async () => {
    const r = readers(); r.projection = async () => ({ year: 2024 }) as AnnualCostProjection
    await assert.rejects(() => readSoftwareAcquisitionInputs('local-a', [2025], [], r), /対象年/)
  })
  it('rejects a workspace update during the reads', async () => {
    const r = readers(); let call = 0
    r.workspace = async () => ({ revision: ++call === 1 ? 7 : 8 })
    await assert.rejects(() => readSoftwareAcquisitionInputs('local-a', [2025], [], r), /変わり/)
  })
  it('rejects another dataset before beginning', async () => {
    await assert.rejects(() => readSoftwareAcquisitionInputs('local-b', [2025], [], readers()), /変わり/)
  })
  it('rejects a dataset replacement while retrieving the archived opening', async () => {
    const r = readers(); let id = 'local-a'
    r.runtime = async () => ({ datasetId: id })
    r.review = async (ref) => { id = 'local-b'; return { review: { id: ref } as BalanceReview } }
    await assert.rejects(() => readSoftwareAcquisitionInputs('local-a', [2025], ['v1'], r), /変わり/)
  })
  it('does not substitute a latest review for the actual opening reference', async () => {
    const r = readers(); r.review = async () => ({ review: { id: 'different' } as BalanceReview })
    await assert.rejects(() => readSoftwareAcquisitionInputs('local-a', [2025], ['v1'], r), /採用版/)
  })
  it('does not return partial data after a failed year or opening fetch', async () => {
    const r = readers(); r.projection = async (year) => { if (year === 2026) throw new Error('read-failed'); return { year } as AnnualCostProjection }
    await assert.rejects(() => readSoftwareAcquisitionInputs('local-a', [2025,2026], [], r), /read-failed/)
  })
  it('rejects invalid or duplicate years before any request', async () => {
    const r = readers(); let calls = 0
    r.runtime = async () => { calls++; return { datasetId: 'local-a' } }
    for (const years of [[], [2025,2025], [2025.5], [10000], Array.from({length:201}, (_, index) => 1900 + index)])
      await assert.rejects(() => readSoftwareAcquisitionInputs('local-a', years, [], r), /対象年/)
    assert.equal(calls, 0)
  })
  it('does not read an absent dataset or multiple opening versions', async () => {
    await assert.rejects(() => readSoftwareAcquisitionInputs(undefined, [2025], [], readers()))
    await assert.rejects(() => readSoftwareAcquisitionInputs('local-a', [2025], ['v1','v2'], readers()))
  })
  it('rejects a malformed revision instead of disabling consistency checks', async () => {
    const r = readers(); r.workspace = async () => ({ revision: NaN })
    await assert.rejects(() => readSoftwareAcquisitionInputs('local-a', [2025], [], r), /変わり/)
  })
})
