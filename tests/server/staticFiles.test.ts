import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { expect, it } from 'vitest'
import { registerStaticFiles } from '../../src/server/staticFiles.js'

it('serves newly added assets and limits HTML fallback to document navigation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devtax-static-'))
  const app = Fastify()
  try {
    writeFileSync(join(root, 'index.html'), '<html><body>DevTax fixture</body></html>')
    await registerStaticFiles(app, root)
    await app.ready()
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'added-after-start.js'), 'export const loaded = true;')
    const asset = await app.inject('/assets/added-after-start.js')
    expect(asset.statusCode).toBe(200)
    expect(asset.headers['content-type']).toMatch(/javascript/)
    expect(asset.headers['x-content-type-options']).toBe('nosniff')
    expect(asset.body).toContain('export const loaded')
    for (const path of ['/', '/index.html', '/review/2026']) {
      const page = await app.inject({
        url: path,
        headers: { accept: 'text/html', 'sec-fetch-dest': 'document' },
      })
      expect(page.statusCode).toBe(200)
      expect(page.body).toContain('DevTax fixture')
      expect(page.headers['cache-control']).toBe('no-store')
    }
    for (const path of [
      '/api',
      '/api/missing',
      '/assets/missing.js',
      '/missing.css',
      '/assets/no-extension',
      '/%61pi/missing',
    ]) {
      const missing = await app.inject({ url: path, headers: { accept: 'text/html' } })
      expect(missing.statusCode, path).toBe(404)
      expect(missing.headers['content-type']).not.toMatch(/text\/html/)
      expect(missing.json()).toEqual({ error: 'not_found' })
    }
    expect((await app.inject({ url: '/missing', headers: { accept: '*/*' } })).statusCode).toBe(404)
    expect(
      (
        await app.inject({
          url: '/missing',
          headers: { accept: 'text/html', 'sec-fetch-dest': 'script' },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await app.inject({ method: 'POST', url: '/missing', headers: { accept: 'text/html' } }))
        .statusCode,
    ).toBe(404)
    rmSync(join(root, 'index.html'))
    expect(
      (await app.inject({ url: '/review', headers: { accept: 'text/html' } })).statusCode,
    ).toBe(404)
  } finally {
    await app.close()
    rmSync(root, { recursive: true, force: true })
  }
})
