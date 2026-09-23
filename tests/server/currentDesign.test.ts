import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'vitest'
const require = createRequire(import.meta.url)
const renderer = require('../../scripts/design/render-current-design.cjs')
const { verifyGeneratedBlueprint } = require('../../scripts/design/verify-docs.cjs')
const root = resolve('.')
function withDocs(action: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-current-design-test-'))
  try {
    cpSync(join(root, 'scripts/design'), join(directory, 'scripts/design'), { recursive: true })
    cpSync(join(root, 'docs/design'), join(directory, 'docs/design'), { recursive: true })
    action(directory)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
describe('actual current blueprint and requirement matrix generation', () => {
  it('renders all 31 requirements, 21 unchanged acceptance scenarios and 39 route contracts', () => {
    const { model, acceptance } = renderer.readInputs(root)
    assert.equal(model.requirements.length, 31); assert.equal(model.api.length, 39)
    assert.equal([...acceptance.matchAll(/^\| AC-/gm)].length, 21)
    assert.equal(renderer.generate(root, { check: true }).checked, true)
  })
  it('uses the real existing isolated two-pass verification with the actual new renderer', () => withDocs((directory) => {
    const result = verifyGeneratedBlueprint(directory)
    assert.equal(result.passes, 2)
    assert.equal(result.sha256, createHash('sha256').update(readFileSync(join(directory, 'docs/design/workflow-blueprint.html'))).digest('hex'))
  }))
  for (const file of ['workflow-blueprint.html', 'requirements-matrix.md']) {
    it(`rejects stale ${file} without overwriting it`, () => withDocs((directory) => {
      const path = join(directory, 'docs/design', file)
      writeFileSync(path, readFileSync(path, 'utf8') + '\nstale')
      const before = readFileSync(path)
      assert.throws(() => renderer.generate(directory, { check: true }), /stale/)
      assert.deepEqual(readFileSync(path), before)
    }))
  }
  it('the full verifier cannot silently regenerate away a stale requirement matrix', () => withDocs((directory) => {
    const path = join(directory, 'docs/design/requirements-matrix.md')
    writeFileSync(path, readFileSync(path, 'utf8') + '\nstale')
    const before = readFileSync(path)
    assert.throws(() => verifyGeneratedBlueprint(directory), /requirements-matrix.md is stale/)
    assert.deepEqual(readFileSync(path), before)
  }))
  it('detects model changes with unchanged artifacts', () => withDocs((directory) => {
    const path = join(directory, 'docs/design/current-design.json')
    const model = JSON.parse(readFileSync(path, 'utf8')); model.works[0].implementation += ' changed'
    writeFileSync(path, JSON.stringify(model))
    assert.throws(() => renderer.generate(directory, { check: true }), /stale/)
  }))
  it('preserves every acceptance-condition row in the matrix without editing its wording', () => {
    const { acceptance } = renderer.readInputs(root)
    const matrix = readFileSync(join(root, 'docs/design/requirements-matrix.md'), 'utf8')
    assert.deepEqual(matrix.split('\n').filter(line => line.startsWith('| AC-')), acceptance.split('\n').filter((line: string) => line.startsWith('| AC-')))
  })
  it('escapes source-supplied HTML instead of inserting executable tags', () => {
    const { model, acceptance } = renderer.readInputs(root)
    model.requirements[0].state = '<script>alert("x")</script>'
    const html = renderer.renderHtml(model, acceptance)
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })
  for (const kind of ['requirement', 'route', 'acceptance', 'mapping', 'work', 'traversal']) {
    it(`rejects invalid ${kind} metadata`, () => {
      const { model, acceptance } = renderer.readInputs(root)
      let ac = acceptance
      if (kind === 'requirement') model.requirements.push(model.requirements[0])
      if (kind === 'route') model.api.push(model.api[0])
      if (kind === 'acceptance') ac += '\n| AC-LIFE | duplicate | duplicate |\n'
      if (kind === 'mapping') model.requirements[0].acceptance = ['AC-MISSING']
      if (kind === 'work') model.works.pop()
      if (kind === 'traversal') model.requirements[0].refs = ['../../private']
      assert.throws(() => renderer.validate(model, ac))
    })
  }
  it('checks the actual CLI entry and rejects unknown flags', () => withDocs((directory) => {
    const entry = join(directory, 'scripts/design/build-workflow-blueprint.cjs')
    const result = JSON.parse(execFileSync(process.execPath, [entry, '--check'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }))
    assert.equal(result.checked, true)
    assert.throws(() => execFileSync(process.execPath, [entry, '--unknown'], { stdio: ['ignore','pipe','pipe'] }))
  }))
  it('contains no duplicate IDs, missing local anchors or external runtime dependencies', () => {
    const html = readFileSync(join(root, 'docs/design/workflow-blueprint.html'), 'utf8')
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
    assert.equal(ids.length, new Set(ids).size)
    for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(m[1]))
    assert.doesNotMatch(html, /<script\b[^>]+src=|<link\b/i)
    assert.ok(!html.includes('\uFFFD'))
  })
})
