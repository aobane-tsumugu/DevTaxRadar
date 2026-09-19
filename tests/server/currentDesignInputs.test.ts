import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'vitest'

const require = createRequire(import.meta.url)
const { verifyCurrentInputs, gitBlob } = require('../../scripts/design/verify-current-inputs.cjs')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const sources = ['src/server/index.ts', 'src/server/balanceRoutes.ts', 'src/server/observationRoutes.ts']
function fixture(action: (root: string, model: any, save: () => void) => void) {
  const root = mkdtempSync(join(tmpdir(), 'devtax-design-inputs-'))
  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  try {
    put('PRODUCT_SPEC.md', 'REQ-TEST-01: synthetic contract\n')
    put('src/server/index.ts', "app.get('/api/health', handler)\n")
    put('src/server/balanceRoutes.ts', '// no synthetic routes\n')
    put('src/server/observationRoutes.ts', '// no synthetic routes\n')
    const acceptance = '| AC-TEST | synthetic input | preserve the contract |\n'
    const conditions = Array.from({ length: 8 }, (_, i) => '完了条件: synthetic W0' + (i + 1)).join('\n') + '\n'
    put('docs/design/acceptance-scenarios.md', acceptance)
    put('docs/design/implementation-plan.md', conditions)
    const model: any = {
      version: 1, baseline: 'a'.repeat(40), updatedOn: '2026-09-19',
      requirements: [{ id: 'REQ-TEST-01', refs: [sources[0]], acceptance: ['AC-TEST'] }],
      works: Array.from({ length: 8 }, (_, i) => ({ id: 'W0' + (i + 1), source: sources[0] })),
      api: [{ method: 'GET', path: '/api/health', source: sources[0] }],
      sourceBlobs: Object.fromEntries(sources.map(source => [source, gitBlob(readFileSync(join(root, source)))])),
      contracts: { acceptanceRowsSha256: digest(acceptance), completionLinesSha256: digest(conditions) },
    }
    const save = () => put('docs/design/current-design.json', JSON.stringify(model))
    save()
    action(root, model, save)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('current checkout documentation contracts', () => {
  it('validates sources, exact routes, references and preserved conditions without writing', () => fixture((root) => {
    const files = [...sources, 'PRODUCT_SPEC.md', 'docs/design/current-design.json', 'docs/design/acceptance-scenarios.md', 'docs/design/implementation-plan.md']
    const before = files.map(file => digest(readFileSync(join(root, file), 'utf8')))
    assert.deepEqual(verifyCurrentInputs(root), {
      requirements: 1, apiRoutes: 1, references: 1, acceptanceScenarios: 1,
      completionConditions: 8, scope: 'checkout documentation contracts, not product acceptance',
    })
    assert.deepEqual(files.map(file => digest(readFileSync(join(root, file), 'utf8'))), before)
  }))
  it('rejects a new specification requirement absent from the matrix', () => fixture((root) => {
    writeFileSync(join(root, 'PRODUCT_SPEC.md'), 'REQ-TEST-01: original\nREQ-TEST-02: added\n')
    assert.throws(() => verifyCurrentInputs(root), /requirement coverage/)
  }))
  it('rejects duplicate requirements in the specification', () => fixture((root) => {
    writeFileSync(join(root, 'PRODUCT_SPEC.md'), 'REQ-TEST-01: original\nREQ-TEST-01: duplicate\n')
    assert.throws(() => verifyCurrentInputs(root), /duplicate specification/)
  }))
  it('rejects unreviewed source changes even when the path remains the same', () => fixture((root) => {
    writeFileSync(join(root, sources[0]!), "app.get('/api/health', changedHandler)\n")
    assert.throws(() => verifyCurrentInputs(root), /fingerprint changed/)
  }))
  it('rejects a missing source module', () => fixture((root) => {
    rmSync(join(root, sources[1]!))
    assert.throws(() => verifyCurrentInputs(root), /ENOENT/)
  }))
  it('rejects a removed API still described by the model', () => fixture((root, model, save) => {
    model.api.push({ method: 'POST', path: '/api/config', source: sources[0] })
    save()
    assert.throws(() => verifyCurrentInputs(root), /API inventory differs/)
  }))
  it('rejects the wrong registration module, not only a wrong route string', () => fixture((root, model, save) => {
    model.api[0].source = sources[1]
    save()
    assert.throws(() => verifyCurrentInputs(root), /API inventory differs/)
  }))
  it('rejects duplicate registration across two current source modules', () => fixture((root, model, save) => {
    writeFileSync(join(root, sources[1]!), "app.get('/api/health', duplicate)\n")
    model.sourceBlobs[sources[1]!] = gitBlob(readFileSync(join(root, sources[1]!)))
    save()
    assert.throws(() => verifyCurrentInputs(root), /duplicate registered/)
  }))
  it('rejects missing code references instead of accepting an existing directory', () => fixture((root, model, save) => {
    model.requirements[0].refs = ['src/server']
    save()
    assert.throws(() => verifyCurrentInputs(root), /not a source file/)
  }))
  it('rejects traversal in a work reference', () => fixture((root, model, save) => {
    model.works[0].source = 'src/../private'
    save()
    assert.throws(() => verifyCurrentInputs(root), /unsafe source/)
  }))
  it('rejects changed W completion criteria', () => fixture((root) => {
    const file = join(root, 'docs/design/implementation-plan.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace('synthetic W01', 'weaker W01'))
    assert.throws(() => verifyCurrentInputs(root), /completion conditions changed/)
  }))
  it('rejects changed acceptance wording even if generated artifacts were refreshed', () => fixture((root) => {
    const file = join(root, 'docs/design/acceptance-scenarios.md')
    writeFileSync(file, readFileSync(file, 'utf8').replace('preserve the contract', 'weaker contract'))
    assert.throws(() => verifyCurrentInputs(root), /acceptance contract changed/)
  }))
  it('does not silently omit a registered route source', () => fixture((root, model, save) => {
    delete model.sourceBlobs[sources[1]!]
    save()
    assert.throws(() => verifyCurrentInputs(root), /registration sources changed/)
  }))
})
