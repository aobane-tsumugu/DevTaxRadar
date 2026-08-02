import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { createLoopbackHostGuard, csrfToken, protectMutation } from '../../src/server/security.ts'

function createTestApp() {
  const app = Fastify()
  app.addHook('preHandler', protectMutation)
  app.get('/read', async () => ({ ok: true }))
  app.post('/write', async () => ({ ok: true }))
  return app
}

describe('local API mutation protection', () => {
  it('allows read-only requests without a CSRF token', async () => {
    const app = createTestApp()
    const response = await app.inject({ method: 'GET', url: '/read' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    await app.close()
  })

  it('rejects mutations without the per-process CSRF token', async () => {
    const app = createTestApp()
    const response = await app.inject({
      method: 'POST',
      url: '/write',
      headers: { origin: 'http://127.0.0.1:4317' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'csrf_token_invalid' })
    await app.close()
  })

  it('rejects a valid token sent from a non-local browser origin', async () => {
    const app = createTestApp()
    const response = await app.inject({
      method: 'POST',
      url: '/write',
      headers: {
        origin: 'https://attacker.example',
        'x-devtax-csrf': csrfToken,
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'origin_not_allowed' })
    await app.close()
  })

  it.each(['http://127.0.0.1:4317', 'http://localhost:4317'])(
    'allows a valid token from local origin %s',
    async (origin) => {
      const app = createTestApp()
      const response = await app.inject({
        method: 'POST',
        url: '/write',
        headers: {
          origin,
          'x-devtax-csrf': csrfToken,
        },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      await app.close()
    },
  )
})

describe('loopback host guard', () => {
  function createGuardedApp(port: number) {
    const app = Fastify()
    app.addHook('preHandler', createLoopbackHostGuard(port))
    app.get('/read', async () => ({ ok: true }))
    return app
  }

  it.each(['127.0.0.1:4317', 'localhost:4317'])(
    'allows a request whose Host header names this loopback port (%s)',
    async (host) => {
      const app = createGuardedApp(4317)
      const response = await app.inject({ method: 'GET', url: '/read', headers: { host } })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      await app.close()
    },
  )

  it('rejects a request whose Host header names a different origin (DNS rebinding)', async () => {
    const app = createGuardedApp(4317)
    const response = await app.inject({
      method: 'GET',
      url: '/read',
      headers: { host: 'attacker.example' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'host_not_allowed' })
    await app.close()
  })

  it('rejects a Host header naming the right hostname but the wrong port', async () => {
    const app = createGuardedApp(4317)
    const response = await app.inject({
      method: 'GET',
      url: '/read',
      headers: { host: '127.0.0.1:9999' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'host_not_allowed' })
    await app.close()
  })
})
