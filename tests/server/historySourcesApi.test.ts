import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const temporaryDirectories: string[] = []
const children: ChildProcess[] = []

function copyCleanClaudeFixture(destination: string): void {
  cpSync(resolve('fixtures/claude'), destination, { recursive: true })
  const historyPath = join(destination, 'synthetic-history.jsonl')
  const cleanLines = readFileSync(historyPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== 'not valid json')
    .join('\n')
  writeFileSync(historyPath, cleanLines, 'utf8')
}

function copyCleanCodexFixture(destination: string): void {
  cpSync(resolve('fixtures/codex'), destination, { recursive: true })
  const historyPath = join(destination, '2026', '04', 'synthetic-session.jsonl')
  const cleanLines = readFileSync(historyPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '{broken')
    .join('\n')
  writeFileSync(historyPath, cleanLines, 'utf8')
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('test port unavailable'))
        return
      }
      server.close(() => resolvePort(address.port))
    })
  })
}

async function waitForJson<T>(
  port: number,
  path: string,
  accept?: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 10_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      if (response.ok) {
        const value = (await response.json()) as T
        if (!accept || accept(value)) return value
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw lastError instanceof Error ? lastError : new Error(`timed out waiting for ${path}`)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill()
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(resolveExit, 2_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild))
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('history source API', () => {
  it('共有フォルダを明示設定画面だけに表示し、自動集約と削除をsource単位で行う', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-source-api-'))
    temporaryDirectories.push(root)
    const fixture = join(root, 'pc1-claude')
    copyCleanClaudeFixture(fixture)
    const port = await reservePort()
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(port),
        HOME: join(root, 'home'),
        USERPROFILE: join(root, 'home'),
        DEVTAX_RADAR_DATA_DIR: join(root, 'data'),
        DEVTAX_RADAR_CLAUDE_SETTINGS: join(root, 'claude-settings.json'),
        DEVTAX_RADAR_AUTO_SCAN: '0',
      },
    })
    children.push(child)

    const runtime = await waitForJson<{ csrfToken: string }>(port, '/api/runtime')
    const mutationHeaders = {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${port}`,
      'x-devtax-csrf': runtime.csrfToken,
    }

    const immutableDelete = await fetch(`http://127.0.0.1:${port}/api/sources/local-claude`, {
      method: 'DELETE',
      headers: {
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
    })
    expect(immutableDelete.status).toBe(409)

    const immutableEdit = await fetch(`http://127.0.0.1:${port}/api/sources/local-claude`, {
      method: 'PATCH',
      headers: mutationHeaders,
      body: JSON.stringify({ provider: 'claude', name: 'local', root: fixture }),
    })
    expect(immutableEdit.status).toBe(409)

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ provider: 'claude', name: 'PC1', root: fixture }),
    })
    expect(unauthorized.status).toBe(403)

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/sources`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ provider: 'claude', name: 'PC1', root: fixture }),
    })
    expect(createResponse.status).toBe(200)
    const createText = await createResponse.text()
    expect(createText).not.toContain(fixture)
    const created = JSON.parse(createText) as { saved: true; sourceId: string }
    expect(created).toEqual({ saved: true, sourceId: expect.any(String) })

    const updateResponse = await fetch(`http://127.0.0.1:${port}/api/sources/${created.sourceId}`, {
      method: 'PATCH',
      headers: mutationHeaders,
      body: JSON.stringify({ provider: 'claude', name: 'PC1', root: fixture }),
    })
    expect(updateResponse.status).toBe(200)
    const updateText = await updateResponse.text()
    expect(updateText).not.toContain(fixture)
    expect(JSON.parse(updateText)).toEqual({ saved: true, sourceId: created.sourceId })

    const duplicateResponse = await fetch(`http://127.0.0.1:${port}/api/sources`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ provider: 'claude', name: 'PC1 duplicate', root: fixture }),
    })
    expect(duplicateResponse.status).toBe(409)

    const relativeResponse = await fetch(`http://127.0.0.1:${port}/api/sources`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ provider: 'claude', name: 'bad', root: './relative' }),
    })
    expect(relativeResponse.status).toBe(400)

    const scanResponse = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ providers: ['claude'] }),
    })
    expect(scanResponse.status).toBe(200)
    const scanText = await scanResponse.text()
    expect(scanText).not.toContain(fixture)
    const scan = JSON.parse(scanText) as { sources: Array<{ sourceId: string; status: string }> }
    expect(scan.sources).toContainEqual(
      expect.objectContaining({ sourceId: created.sourceId, status: 'complete' }),
    )

    const sourcesPayload = (await fetch(`http://127.0.0.1:${port}/api/sources`).then((response) =>
      response.json(),
    )) as { sources: Array<{ id: string; root: string }> }
    expect(sourcesPayload.sources).toContainEqual(
      expect.objectContaining({ id: created.sourceId, root: fixture }),
    )

    const dashboard = await waitForJson<{ meta: { sessionCount: number } }>(port, '/api/dashboard')
    expect(dashboard.meta.sessionCount).toBe(1)
    const foldersText = await fetch(`http://127.0.0.1:${port}/api/folders`).then((response) =>
      response.text(),
    )
    expect(foldersText).toContain('PC1')
    expect(foldersText).not.toContain(fixture)
    const exportText = await fetch(`http://127.0.0.1:${port}/api/export?format=markdown`).then(
      (response) => response.text(),
    )
    expect(exportText).not.toContain(fixture)

    const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/sources/${created.sourceId}`, {
      method: 'DELETE',
      headers: {
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
    })
    expect(deleteResponse.status).toBe(200)
    expect(
      (await waitForJson<{ meta: { sessionCount: number } }>(port, '/api/dashboard')).meta
        .sessionCount,
    ).toBe(0)
    expect(existsSync(fixture)).toBe(true)
  }, 20_000)

  it('サーバー起動時に設定済み共有フォルダを走査する', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-source-startup-'))
    temporaryDirectories.push(root)
    const fixture = join(root, 'dgx-codex')
    copyCleanCodexFixture(fixture)
    const dataDirectory = join(root, 'data')
    const previousData = process.env.DEVTAX_RADAR_DATA_DIR
    const previousHome = process.env.HOME
    const previousProfile = process.env.USERPROFILE
    process.env.DEVTAX_RADAR_DATA_DIR = dataDirectory
    process.env.HOME = join(root, 'home')
    process.env.USERPROFILE = join(root, 'home')
    vi.resetModules()
    const database = await import('../../src/server/database.ts')
    const configured = database.createHistorySource({
      provider: 'codex',
      name: 'DGX',
      root: fixture,
    })
    database.getDatabase().close()
    if (previousData === undefined) delete process.env.DEVTAX_RADAR_DATA_DIR
    else process.env.DEVTAX_RADAR_DATA_DIR = previousData
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousProfile

    const port = await reservePort()
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(port),
        HOME: join(root, 'home'),
        USERPROFILE: join(root, 'home'),
        DEVTAX_RADAR_DATA_DIR: dataDirectory,
        DEVTAX_RADAR_CLAUDE_SETTINGS: join(root, 'claude-settings.json'),
      },
    })
    children.push(child)

    await waitForJson<{ sources: Array<{ id: string; lastScan: { status: string } }> }>(
      port,
      '/api/sources',
      (value) =>
        value.sources.some(
          (source) => source.id === configured.id && source.lastScan.status === 'complete',
        ),
    )
    const dashboard = await waitForJson<{ meta: { sessionCount: number } }>(port, '/api/dashboard')
    expect(dashboard.meta.sessionCount).toBe(1)
  }, 20_000)
})
