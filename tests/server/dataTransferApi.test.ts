import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'vitest'

type Running = { origin: string; child: ChildProcess; csrfToken: string }

async function freePort(): Promise<number> {
  const server = createServer()
  const listening = once(server, 'listening')
  server.listen(0, '127.0.0.1')
  await listening
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  )
  return address.port
}

async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  const force = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    child.kill('SIGTERM')
    await exited
  } finally {
    clearTimeout(force)
  }
}

async function start(data: string, home: string): Promise<Running> {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      DEVTAX_RADAR_DATA_DIR: data,
      HOME: home,
      USERPROFILE: home,
      DEVTAX_RADAR_CLAUDE_SETTINGS: join(home, 'claude-settings.json'),
      DEVTAX_RADAR_AUTO_SCAN: '0',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  child.stdout?.on('data', (bytes) => (diagnostics = (diagnostics + String(bytes)).slice(-8000)))
  child.stderr?.on('data', (bytes) => (diagnostics = (diagnostics + String(bytes)).slice(-8000)))
  const deadline = Date.now() + 15000
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    try {
      const response = await fetch(origin + '/api/runtime', { signal: AbortSignal.timeout(1000) })
      if (response.ok)
        return {
          origin,
          child,
          csrfToken: ((await response.json()) as { csrfToken: string }).csrfToken,
        }
    } catch {
      // Poll only the isolated process, never a user's existing runtime.
    }
    await new Promise((done) => setTimeout(done, 50))
  }
  await stop(child)
  throw new Error('Data-transfer API fixture failed to start: ' + diagnostics)
}

function post(server: Running, route: string, body: unknown): Promise<Response> {
  return fetch(server.origin + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: server.origin,
      'X-DevTax-CSRF': server.csrfToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
}

describe('data-transfer API', () => {
  it('backs up, verifies and restores a data folder that never scanned any history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-transfer-'))
    const data = join(root, 'data')
    const server = await start(data, join(root, 'home'))
    try {
      assert.equal(existsSync(join(data, 'identifier-salt')), false)
      const backup = await post(server, '/api/data-transfer/backup', {
        destination: join(root, 'backup'),
      })
      assert.equal(backup.status, 200, await backup.clone().text())
      assert.ok(existsSync(join(root, 'backup', 'identifier-salt')))
      const verify = await post(server, '/api/data-transfer/verify', {
        bundle: join(root, 'backup'),
      })
      assert.equal(verify.status, 200, await verify.clone().text())
      const restore = await post(server, '/api/data-transfer/restore', {
        bundle: join(root, 'backup'),
        destination: join(root, 'restored'),
      })
      assert.equal(restore.status, 200, await restore.clone().text())
      assert.ok(existsSync(join(root, 'restored', 'devtax-radar.db')))
    } finally {
      await stop(server.child)
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }, 60_000)
})
