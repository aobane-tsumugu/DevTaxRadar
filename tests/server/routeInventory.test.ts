import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'vitest'
const require = createRequire(import.meta.url)
const { extractRoutes } = require('../../scripts/design/route-inventory.cjs') as {
  extractRoutes: (source: string) => string[][]
}
const root = resolve('.')

describe('API registration extraction, including actual typed observation routes', () => {
  it('parses the actual complete observationRoutes source at its verified blob', () => {
    const bytes = readFileSync(join(root, 'src/server/observationRoutes.ts'))
    const hash = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex')
    assert.equal(hash, '89312522da733e41d08b16d48490d6b27bdff05b')
    assert.deepEqual(extractRoutes(bytes.toString()).map(row => row[2]), ['/api/observations/records','/api/observations/records/:id'])
  })
  it('handles multiline and nested type arguments with arrow types', () => {
    const routes = extractRoutes("app.get<{ Params: Record<string, { f: () => '>' }> }>(\n '/api/typed/:id', f)")
    assert.deepEqual(routes.map(row => row.slice(1)), [['get','/api/typed/:id']])
  })
  it('ignores comment, string, template and regexp lookalikes', () => {
    const source = "// app.get('/api/comment', f)\n/* app.post('/api/block', f) */\n" +
      'const text = "app.get(\'/api/string\', f)";\n' +
      "const template = `app.get('/api/template', f)`;\nconst re = /app.get('fake')/;\napp.put('/api/real', f)"
    assert.deepEqual(extractRoutes(source).map(row => row[2]), ['/api/real'])
  })
  it('keeps paths exact, not prefix-based and not merely substring matches', () => {
    assert.deepEqual(extractRoutes("app.get('/api/items', f);app.get('/api/items/detail', f); myapp.get('/api/not-app', f)").map(row => row[2]), ['/api/items','/api/items/detail'])
  })
})


describe('route inventory rejects ambiguous declarations', () => {
  it('does not treat a nested object property as the application router', () => {
    assert.deepEqual(extractRoutes("other.app.get('/api/not-this-router', handler); app.get('/api/real', handler)"),
      [['get /api/real', 'get', '/api/real']])
  })
  it('refuses computed paths instead of documenting only a literal prefix', () => {
    for (const source of ["app.get(path, handler)", "app.get('/api/prefix' + suffix, handler)",
      "app.get(`/api/template`, handler)"])
      assert.throws(() => extractRoutes(source), /computed route/)
  })
})
