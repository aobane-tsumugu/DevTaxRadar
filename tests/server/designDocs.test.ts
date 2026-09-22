import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'vitest'

const { verifyGeneratedBlueprint, verifyDocs } = createRequire(import.meta.url)(
  '../../scripts/design/verify-docs.cjs',
) as {
  verifyGeneratedBlueprint: (root: string) => { bytes: number; sha256: string; passes: number }
  verifyDocs: (root: string) => {
    apiRoutes: number
    requirements: number
    currentInputs?: { apiRoutes: number }
    regeneration: { passes: number }
  }
}
const output = 'docs/design/workflow-blueprint.html'
const expected = '<!doctype html><html lang="ja"><body>合成設計図</body></html>\n'

function fixture(generator: string, action: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'devtax-design-check-test-'))
  try {
    for (const directory of ['scripts/design', 'docs/design', 'src', '.github/workflows'])
      mkdirSync(join(root, directory), { recursive: true })
    writeFileSync(join(root, output), expected)
    // Every declared generator input must exist; the synthetic generator ignores them.
    writeFileSync(join(root, 'scripts/design/render-current-design.cjs'), '// synthetic renderer\n')
    writeFileSync(join(root, 'docs/design/current-design.json'), '{}')
    writeFileSync(join(root, 'docs/design/acceptance-scenarios.md'), 'synthetic\n')
    writeFileSync(join(root, 'docs/design/requirements-matrix.md'), 'synthetic\n')
    writeFileSync(
      join(root, 'scripts/design/build-workflow-blueprint.cjs'),
      "const fs = require('node:fs'); const path = require('node:path');\n" +
        "const root = path.resolve(__dirname, '../..');\n" +
        `const output = path.join(root, ${JSON.stringify(output)});\n` +
        generator,
    )
    action(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('blueprint regeneration verification', () => {
  it('compares two real generator executions with the checked-in bytes', () => {
    fixture(`fs.writeFileSync(output, ${JSON.stringify(expected)});`, (root) => {
      assert.deepEqual(verifyGeneratedBlueprint(root), {
        bytes: Buffer.byteLength(expected),
        sha256: createHash('sha256').update(expected).digest('hex'),
        passes: 2,
      })
      assert.equal(readFileSync(join(root, output), 'utf8'), expected)
    })
  })

  it('rejects stale output without silently rewriting the working tree', () => {
    fixture("fs.writeFileSync(output, 'changed');", (root) => {
      assert.throws(() => verifyGeneratedBlueprint(root), /is stale/)
      assert.equal(readFileSync(join(root, output), 'utf8'), expected)
    })
  })

  it('rejects non-deterministic output even when the generator exits successfully', () => {
    fixture("fs.writeFileSync(output, require('node:crypto').randomUUID());", (root) => {
      assert.throws(() => verifyGeneratedBlueprint(root), /not deterministic/)
      assert.equal(readFileSync(join(root, output), 'utf8'), expected)
    })
  })

  it('does not pass a generator that fails before producing output', () => {
    fixture("throw new Error('fixture-generation-failed');", (root) => {
      assert.throws(() => verifyGeneratedBlueprint(root), /fixture-generation-failed/)
      assert.equal(readFileSync(join(root, output), 'utf8'), expected)
    })
  })

  it('does not reuse a copied artifact when the generator writes nothing', () => {
    fixture('// intentionally no generated file', (root) => {
      assert.throws(() => verifyGeneratedBlueprint(root), /ENOENT.*workflow-blueprint\.html/)
      assert.equal(readFileSync(join(root, output), 'utf8'), expected)
    })
  })

  it('uses the current declared inputs instead of placeholder files', () => {
    fixture(
      "fs.writeFileSync(output, fs.readFileSync(path.join(root, 'docs/design/acceptance-scenarios.md')));",
      (root) => {
        const input = join(root, 'docs/design/acceptance-scenarios.md')
        writeFileSync(input, expected)
        verifyGeneratedBlueprint(root)
        writeFileSync(input, 'changed source')
        assert.throws(() => verifyGeneratedBlueprint(root), /is stale/)
      },
    )
  })

  it('does not copy a local database or node_modules into the generation workspace', () => {
    fixture(
      "if (fs.existsSync(path.join(root, 'devtax-radar.db')) ||" +
        " fs.existsSync(path.join(root, 'scripts/node_modules/private.txt')) ||" +
        " fs.existsSync(path.join(root, 'src/devtax-radar.db')) ||" +
        " fs.existsSync(path.join(root, 'src/identifier-salt')))" +
        " throw new Error('private file copied');" +
        `fs.writeFileSync(output, ${JSON.stringify(expected)});`,
      (root) => {
        writeFileSync(join(root, 'devtax-radar.db'), 'not a source file')
        writeFileSync(join(root, 'src/devtax-radar.db'), 'not a generator input')
        writeFileSync(join(root, 'src/identifier-salt'), 'not a generator input')
        const dependency = join(root, 'scripts/node_modules/private.txt')
        mkdirSync(dirname(dependency), { recursive: true })
        writeFileSync(dependency, 'not a generator input')
        verifyGeneratedBlueprint(root)
      },
    )
  })
})

const completeHtml =
  '<section id="api">GET /api/health<br>GET /api/observations</section>' +
  '<section id="security">合成境界</section>'
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function completeFixture(action: (root: string) => void): void {
  // The generator is not copied with the page it produces, so it embeds its own output.
  fixture(`fs.writeFileSync(output, ${JSON.stringify(completeHtml)});`, (root) => {
    for (const name of [
      'README.md',
      'TECHNICAL_DESIGN.md',
      'docs/design/README.md',
      'docs/design/purpose-led-redesign.md',
    ])
      writeFileSync(join(root, name), '# 合成文書\n')
    const conditions =
      Array.from({ length: 8 }, (_, i) => '完了条件: 合成 W0' + (i + 1)).join('\n') + '\n'
    writeFileSync(join(root, 'docs/design/implementation-plan.md'), '# 合成文書\n\n' + conditions)
    writeFileSync(join(root, 'PRODUCT_SPEC.md'), 'REQ-TEST-1: 合成要件\n')
    const acceptance = '| AC-TEST | 合成受入 |\n'
    writeFileSync(join(root, 'docs/design/acceptance-scenarios.md'), acceptance)
    writeFileSync(
      join(root, 'docs/design/requirements-matrix.md'),
      '| REQ-TEST-1 | AC-TEST |\n' + acceptance,
    )
    mkdirSync(join(root, 'src/server'), { recursive: true })
    writeFileSync(join(root, 'src/server/index.ts'), "app.get(\n  '/api/health', () => ({}))")
    writeFileSync(join(root, 'src/server/balanceRoutes.ts'), '')
    writeFileSync(join(root, 'src/server/observationRoutes.ts'), "app.get('/api/observations', f)")
    const sources = [
      'src/server/index.ts',
      'src/server/balanceRoutes.ts',
      'src/server/observationRoutes.ts',
    ]
    // verifyDocs also checks the checkout contracts once the declared model exists.
    const model = {
      version: 1,
      baseline: 'a'.repeat(40),
      updatedOn: '2026-09-23',
      requirements: [{ id: 'REQ-TEST-1', refs: [sources[0]], acceptance: ['AC-TEST'] }],
      works: Array.from({ length: 8 }, (_, i) => ({ id: 'W0' + (i + 1), source: sources[0] })),
      api: [
        { method: 'GET', path: '/api/health', source: sources[0] },
        { method: 'GET', path: '/api/observations', source: sources[2] },
      ],
      sourceBlobs: Object.fromEntries(sources.map((source) => [source, 'synthetic'])),
      contracts: {
        acceptanceRowsSha256: sha256(acceptance),
        completionLinesSha256: sha256(conditions),
      },
    }
    writeFileSync(join(root, 'docs/design/current-design.json'), JSON.stringify(model))
    writeFileSync(join(root, output), completeHtml)
    action(root)
  })
}

describe('document verification entry point', () => {
  it('covers multiline registration and the separate observation route module', () => {
    completeFixture((root) => {
      const result = verifyDocs(root)
      assert.equal(result.apiRoutes, 2)
      assert.equal(result.requirements, 1)
      assert.equal(result.currentInputs?.apiRoutes, 2)
      assert.equal(result.regeneration.passes, 2)
    })
  })

  it('rejects an observation route missing from the API document', () => {
    completeFixture((root) => {
      const html = readFileSync(join(root, output), 'utf8').replace('GET /api/observations', '')
      writeFileSync(join(root, output), html)
      assert.throws(() => verifyDocs(root), /undocumented route: GET \/api\/observations/)
    })
  })

  it('does not accept a longer route as documentation of its shorter prefix', () => {
    completeFixture((root) => {
      writeFileSync(
        join(root, 'src/server/observationRoutes.ts'),
        "app.get('/api/observations', f); app.get('/api/observations/detail', f)",
      )
      const html = readFileSync(join(root, output), 'utf8').replace(
        'GET /api/observations',
        'GET /api/observations/detail',
      )
      writeFileSync(join(root, output), html)
      assert.throws(() => verifyDocs(root), /undocumented route: GET \/api\/observations$/)
    })
  })

  it('rejects a removed writer still described as a current API', () => {
    completeFixture((root) => {
      const html = readFileSync(join(root, output), 'utf8').replace(
        '<section id="api">',
        '<section id="api">POST /api/config<br>',
      )
      writeFileSync(join(root, output), html)
      assert.throws(
        () => verifyDocs(root),
        /documented route is not registered: POST \/api\/config/,
      )
    })
  })

  it('rejects duplicate acceptance identifiers instead of silently deduplicating them', () => {
    completeFixture((root) => {
      const matrix = join(root, 'docs/design/requirements-matrix.md')
      writeFileSync(matrix, readFileSync(matrix, 'utf8') + '| AC-TEST | 重複 |\n')
      assert.throws(() => verifyDocs(root), /duplicate acceptance scenario id/)
    })
  })

  it('rejects duplicate requirement mappings', () => {
    completeFixture((root) => {
      const matrix = join(root, 'docs/design/requirements-matrix.md')
      writeFileSync(matrix, readFileSync(matrix, 'utf8') + '| REQ-TEST-1 | AC-TEST |\n')
      assert.throws(() => verifyDocs(root), /requirement coverage/)
    })
  })

  it('rejects a missing API section rather than slicing at a negative index', () => {
    completeFixture((root) => {
      writeFileSync(join(root, output), '<section id="security">合成境界</section>')
      assert.throws(() => verifyDocs(root), /missing API\/security sections/)
    })
  })
})
