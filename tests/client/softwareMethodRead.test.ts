import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { BalancePreview } from '../../src/accounting/balanceWorkspace.js'
import { readSoftwareMethodPreview } from '../../src/client/softwareMethodRead.js'
import { methodFixture } from '../core/helpers/softwareMethodFixture.js'
import { buildAnnualBalances } from '../../src/core/annualBalances.js'

function fixture() {
  const f = methodFixture()
  const preview = {
    draftRevision: 2,
    snapshot: structuredClone(f.snapshot),
    projection: buildAnnualBalances(f.snapshot, 2026),
    materials: {
      year: 2026,
      costs: f.costs[1],
      costLinks: { costs: f.costs },
      planning: f.planning,
    },
  } as unknown as BalancePreview
  return { f, preview }
}
describe('atomic-preview inputs for method selection and posting', () => {
  it('uses the existing single preview and checks the dataset before and after', async () => {
    const { f, preview } = fixture(),
      calls: string[] = []
    const result = await readSoftwareMethodPreview(
      'dataset',
      2,
      f.snapshot,
      2026,
      async () => {
        calls.push('runtime')
        return { datasetId: 'dataset' }
      },
      async (year) => {
        calls.push('preview:' + year)
        return preview
      },
    )
    assert.strictEqual(result, preview)
    assert.deepEqual(calls, ['runtime', 'preview:2026', 'runtime'])
  })
  it('validates identifiers, revision and year before reading', async () => {
    const { f, preview } = fixture()
    let calls = 0
    for (const [id, revision, year] of [
      [undefined, 2, 2026],
      ['dataset', -1, 2026],
      ['dataset', 2, NaN],
      ['dataset', 2, 2006],
      ['dataset', 2, 2101],
    ] as const)
      await assert.rejects(
        readSoftwareMethodPreview(
          id,
          revision,
          f.snapshot,
          year,
          async () => {
            calls++
            return { datasetId: 'dataset' }
          },
          async () => preview,
        ),
      )
    assert.equal(calls, 0)
  })
  it('rejects a dataset change before the preview', async () => {
    const { f, preview } = fixture()
    let calls = 0
    await assert.rejects(
      readSoftwareMethodPreview(
        'dataset',
        2,
        f.snapshot,
        2026,
        async () => ({ datasetId: 'different' }),
        async () => {
          calls++
          return preview
        },
      ),
    )
    assert.equal(calls, 0)
  })
  it('rejects a dataset change during the preview', async () => {
    const { f, preview } = fixture()
    let calls = 0
    await assert.rejects(
      readSoftwareMethodPreview(
        'dataset',
        2,
        f.snapshot,
        2026,
        async () => ({ datasetId: ++calls === 1 ? 'dataset' : 'different' }),
        async () => preview,
      ),
      /読取り中/,
    )
  })
  it('rejects new draft revisions and changed contents even at the same revision', async () => {
    for (const kind of ['revision', 'contents']) {
      const { f, preview } = fixture()
      if (kind === 'revision') preview.draftRevision++
      else preview.snapshot!.accounts[0]!.name += ' changed'
      await assert.rejects(
        readSoftwareMethodPreview(
          'dataset',
          2,
          f.snapshot,
          2026,
          async () => ({ datasetId: 'dataset' }),
          async () => preview,
        ),
        /保存版/,
      )
    }
  })
  it('rejects wrong material/projection/cost years and a missing linked-cost collection', async () => {
    for (const kind of ['projection', 'materials', 'cost', 'links']) {
      const { f, preview } = fixture()
      if (kind === 'projection') preview.projection.year = 2027
      if (kind === 'materials') preview.materials!.year = 2027
      if (kind === 'cost') preview.materials!.costs.year = 2027
      if (kind === 'links') delete preview.materials!.costLinks
      await assert.rejects(
        readSoftwareMethodPreview(
          'dataset',
          2,
          f.snapshot,
          2026,
          async () => ({ datasetId: 'dataset' }),
          async () => preview,
        ),
        /対象年/,
      )
    }
  })
  it('does not replace a failed read with stale figures or mutate the edit draft', async () => {
    const { f } = fixture(),
      before = JSON.stringify(f.snapshot)
    await assert.rejects(
      readSoftwareMethodPreview(
        'dataset',
        2,
        f.snapshot,
        2026,
        async () => ({ datasetId: 'dataset' }),
        async () => {
          throw new Error('offline')
        },
      ),
      /offline/,
    )
    assert.equal(JSON.stringify(f.snapshot), before)
  })
})
