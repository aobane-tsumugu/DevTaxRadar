import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoDashboard, getDashboardData, isLocalRuntime } from '../../src/client/dashboard.ts'

function location(hostname: string, search = '') {
  vi.stubGlobal('window', { location: { hostname, search } })
}

afterEach(() => vi.unstubAllGlobals())

describe('dashboard runtime mode', () => {
  it.each(['127.0.0.1', 'localhost'])('uses the local API at %s', async (hostname) => {
    location(hostname)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...demoDashboard, meta: { ...demoDashboard.meta, sessionCount: 3 } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await getDashboardData()
    expect(result.meta).toMatchObject({ source: 'local', sessionCount: 3 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(['public.example', '', 'localhost.example'])(
    'does not probe local APIs from %s',
    async (hostname) => {
      location(hostname)
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      expect(await getDashboardData()).toBe(demoDashboard)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('requires explicit demo selection for a loopback preview', async () => {
    location('localhost', '?mode=demo')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(isLocalRuntime()).toBe(false)
    expect(await getDashboardData()).toBe(demoDashboard)
    expect(fetchMock).not.toHaveBeenCalled()
    location('localhost', '?mode=local')
    expect(isLocalRuntime()).toBe(true)
  })

  it('propagates a network failure without returning synthetic money', async () => {
    location('localhost')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection failed')))
    await expect(getDashboardData()).rejects.toThrow('connection failed')
  })

  it.each([403, 500, 503])(
    'propagates HTTP %s without returning synthetic money',
    async (status) => {
      location('localhost')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }))
      await expect(getDashboardData()).rejects.toThrow(`HTTP ${status}`)
    },
  )

  it('rejects malformed responses and JSON parse failures', async () => {
    location('localhost')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: 'not dashboard data' }) }),
    )
    await expect(getDashboardData()).rejects.toThrow('応答形式')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('JSON failed')
        },
      }),
    )
    await expect(getDashboardData()).rejects.toThrow('JSON failed')
  })
})
