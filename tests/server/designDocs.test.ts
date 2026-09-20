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
  verifyDocs: (root: string) => { apiRoutes: number; requirements: number }
}
const output = 'docs/design/workflow-blueprint.html'
const expected = '<!doctype html><html lang="ja"><body>合成設計図</body></html>\n'

function fixture(generator: string, action: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'devtax-design-check-test-'))
  try {
    for (const directory of ['scripts/design', 'docs/design', 'src', '.github/workflows'])
      mkdirSync(join(root, directory), { recursive: true })
    writeFileSync(join(root, output), expected)
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
      assert.throws(() => verifyGeneratedBlueprint(root), /ENOENT/)
      assert.equal(readFileSync(join(root, output), 'utf8'), expected)
    })
  })

  it('uses current source and workflow references instead of placeholder files', () => {
    fixture(
      "fs.readFileSync(path.join(root, '.github/workflows/ci.yml'));" +
        "fs.writeFileSync(output, fs.readFileSync(path.join(root, 'src/current.txt')));",
      (root) => {
        writeFileSync(join(root, '.github/workflows/ci.yml'), 'name: fixture\n')
        writeFileSync(join(root, 'src/current.txt'), expected)
        verifyGeneratedBlueprint(root)
        writeFileSync(join(root, 'src/current.txt'), 'changed source')
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

function completeFixture(action: (root: string) => void): void {
  fixture(
    "fs.writeFileSync(output, fs.readFileSync(path.join(root, 'docs/design/source.html')));",
    (root) => {
      for (const name of [
        'README.md',
        'TECHNICAL_DESIGN.md',
        'docs/design/README.md',
        'docs/design/implementation-plan.md',
        'docs/design/purpose-led-redesign.md',
      ])
        writeFileSync(join(root, name), '# 合成文書\n')
      writeFileSync(join(root, 'PRODUCT_SPEC.md'), 'REQ-TEST-1: 合成要件\n')
      writeFileSync(
        join(root, 'docs/design/requirements-matrix.md'),
        '| REQ-TEST-1 | AC-TEST |\n| AC-TEST | 合成受入 |\n',
      )
      mkdirSync(join(root, 'src/server'), { recursive: true })
      writeFileSync(join(root, 'src/server/index.ts'), "app.get(\n  '/api/health', () => ({}))")
      writeFileSync(join(root, 'src/server/balanceRoutes.ts'), '')
      writeFileSync(join(root, 'src/server/observationRoutes.ts'), "app.get('/api/observations', f)")
      const html =
        '<section id="api">GET /api/health<br>GET /api/observations</section>' +
        '<section id="security">合成境界</section>'
      writeFileSync(join(root, output), html)
      writeFileSync(join(root, 'docs/design/source.html'), html)
      action(root)
    },
  )
}

describe('document verification entry point', () => {
  it('covers multiline registration and the separate observation route module', () => {
    completeFixture((root) => {
      const result = verifyDocs(root)
      assert.equal(result.apiRoutes, 2)
      assert.equal(result.requirements, 1)
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
      assert.throws(() => verifyDocs(root), /documented route is not registered: POST \/api\/config/)
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
