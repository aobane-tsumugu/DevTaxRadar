import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { readTreatmentProjection } from '../../src/client/treatmentProjectionRead.js'
import { fixture } from '../core/helpers/treatmentFixtures.js'

describe('dataset-bound treatment projection reads', () => {
  it('checks identity before and after the projection without changing the response', async () => {
    const { costs } = fixture()
    const order: string[] = []
    const result = await readTreatmentProjection('dataset-a', 2026,
      async () => { order.push('identity'); return { datasetId: 'dataset-a' } },
      async year => { order.push(String(year)); return costs })
    assert.strictEqual(result, costs)
    assert.deepEqual(order, ['identity', '2026', 'identity'])
  })

  it('does not request a projection from an already different dataset', async () => {
    let requested = false
    await assert.rejects(readTreatmentProjection('dataset-a', 2026,
      async () => ({ datasetId: 'dataset-b' }),
      async () => { requested = true; return fixture().costs }), /接続先/)
    assert.equal(requested, false)
  })

  it('rejects a restart or restore that happens during the projection read', async () => {
    let reads = 0
    await assert.rejects(readTreatmentProjection('dataset-a', 2026,
      async () => ({ datasetId: ++reads === 1 ? 'dataset-a' : 'dataset-b' }),
      async () => fixture().costs), /接続先/)
    assert.equal(reads, 2)
  })

  it('does not accept a missing identity at the end of the read', async () => {
    let reads = 0
    await assert.rejects(readTreatmentProjection('dataset-a', 2026,
      async () => ++reads === 1 ? { datasetId: 'dataset-a' } : {},
      async () => fixture().costs), /接続先/)
  })

  it('rejects a response for another year even when both identity checks succeed', async () => {
    await assert.rejects(readTreatmentProjection('dataset-a', 2027,
      async () => ({ datasetId: 'dataset-a' }), async () => fixture().costs), /対象年/)
  })

  it('propagates a failed projection without manufacturing fallback data', async () => {
    const failure = new Error('offline')
    let reads = 0
    await assert.rejects(readTreatmentProjection('dataset-a', 2026,
      async () => { reads++; return { datasetId: 'dataset-a' } },
      async () => { throw failure }), error => error === failure)
    assert.equal(reads, 1)
  })

  it('does not accept data when the final identity request fails', async () => {
    let reads = 0
    await assert.rejects(readTreatmentProjection('dataset-a', 2026,
      async () => { if (++reads === 2) throw new Error('runtime unavailable'); return { datasetId: 'dataset-a' } },
      async () => fixture().costs), /runtime unavailable/)
  })

  it('validates the caller scope before performing any read', async () => {
    let called = false
    for (const [dataset, year] of [[undefined, 2026], ['', 2026], ['a', NaN], ['a', 1899], ['a', 10000], ['a', 2026.5]] as const) {
      await assert.rejects(readTreatmentProjection(dataset, year,
        async () => { called = true; return { datasetId: 'a' } }, async () => fixture().costs))
    }
    assert.equal(called, false)
  })
})
