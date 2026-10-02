import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { WorkspaceImpact, WorkspaceSave, WorkspaceView } from '../../src/planning/workspace.js'
import { WORKSPACE_BODY_LIMIT } from '../../src/server/workspaceHttp.js'

// Exercise the actual server/parser, not a second implementation of the size check.
let child: ChildProcess | undefined
let directory: string
let origin: string
let csrfToken: string

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('No test port'))
        return
      }
      server.close(() => resolvePort(address.port))
    })
  })
}

async function readWorkspace(): Promise<WorkspaceView> {
  const response = await fetch(`${origin}/api/workspace`)
  expect(response.status).toBe(200)
  return response.json() as Promise<WorkspaceView>
}

function send(path: string, method: 'POST' | 'PUT', body: string, withCsrf = true) {
  return fetch(origin + path, {
    method,
    headers: {
      'content-type': 'application/json',
      origin,
      ...(withCsrf ? { 'x-devtax-csrf': csrfToken } : {}),
    },
    body,
  })
}

/**
 * The parser can send 413 and close the connection before a large upload has
 * finished. Node's fetch can then reject on the write side (EPIPE), discarding
 * the already-sent response. Collect the real HTTP response independently.
 * An upload error alone is NEVER success: a complete response is mandatory.
 */
function sendOversized(path: string, method: 'POST' | 'PUT', body: string): Promise<Response> {
  return new Promise((resolveResponse, reject) => {
    let responseStarted = false
    let uploadError: Error | undefined
    const request = httpRequest(
      origin + path,
      {
        method,
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body, 'utf8'),
          origin,
          'x-devtax-csrf': csrfToken,
        },
      },
      (response) => {
        responseStarted = true
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('error', reject)
        response.once('aborted', () => reject(new Error('Oversized request response was aborted')))
        response.once('end', () => {
          if (!response.complete || response.statusCode === undefined) {
            reject(new Error('Oversized request did not receive a complete HTTP response'))
            return
          }
          resolveResponse(
            new Response(Buffer.concat(chunks).toString('utf8'), {
              status: response.statusCode,
            }),
          )
        })
      },
    )
    request.once('error', (error) => {
      uploadError = error
      // A response, when started, has its own completion/error handlers above.
    })
    request.once('close', () => {
      if (!responseStarted)
        reject(uploadError ?? new Error('No HTTP response to oversized request'))
    })
    request.setTimeout(4_000, () => request.destroy(new Error('Oversized request timed out')))
    request.end(body)
  })
}

function padToBytes(value: unknown, size: number): string {
  const json = JSON.stringify(value)
  const padding = size - Buffer.byteLength(json, 'utf8')
  if (padding < 0) throw new Error('Fixture already exceeds the requested byte length')
  // Legal JSON whitespace exercises the HTTP byte boundary without bypassing
  // field-length validation or adding an unrelated million-character memo.
  const body = json + ' '.repeat(padding)
  expect(Buffer.byteLength(body, 'utf8')).toBe(size)
  return body
}

function requestFor(workspace: WorkspaceView): WorkspaceSave {
  return {
    expectedRevision: workspace.revision,
    requestId: randomUUID(),
    configuration: structuredClone(workspace.configuration),
    planning: structuredClone(workspace.planning),
  }
}

beforeAll(async () => {
  const port = await availablePort()
  origin = `http://127.0.0.1:${port}`
  directory = mkdtempSync(join(tmpdir(), 'devtax-workspace-capacity-'))
  child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
    cwd: resolve('.'),
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      DEVTAX_RADAR_DATA_DIR: directory,
      DEVTAX_RADAR_AUTO_SCAN: '0',
      USERPROFILE: directory,
      HOME: directory,
      DEVTAX_RADAR_CLAUDE_SETTINGS: join(directory, 'claude-settings.json'),
    },
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Workspace capacity test server exited')
    try {
      const response = await fetch(`${origin}/api/runtime`)
      if (response.ok) {
        csrfToken = ((await response.json()) as { csrfToken: string }).csrfToken
        return
      }
    } catch {
      // The subprocess has not bound the loopback socket yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error('Workspace capacity test server did not start')
}, 15_000)

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>((resolveExit) => child!.once('exit', () => resolveExit()))
    child.kill()
    await stopped
  }
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('workspace request capacity', () => {
  it('previews, saves and rereads Japanese evidence exceeding the former 64 KiB limit', async () => {
    const before = await readWorkspace()
    const input = requestFor(before)
    input.planning.evidence = Array.from({ length: 12 }, (_, index) => ({
      id: `capacity-memo-${index}`,
      evidenceType: 'memo' as const,
      strength: 'self-recorded' as const,
      recordedAt: '2026-09-09T00:00:00.000Z',
      note: 'あ'.repeat(2000),
    }))
    const { requestId: _requestId, ...previewInput } = input
    expect(Buffer.byteLength(JSON.stringify(previewInput), 'utf8')).toBeGreaterThan(64 * 1024)
    const preview = await send('/api/workspace/preview', 'POST', JSON.stringify(previewInput))
    expect(preview.status).toBe(200)
    const report = (await preview.json()) as WorkspaceImpact
    expect((await readWorkspace()).revision).toBe(before.revision)

    const saveInput = { ...input, previewHash: report.previewHash }
    const saved = await send('/api/workspace', 'PUT', JSON.stringify(saveInput))
    expect(saved.status).toBe(200)
    const result = (await saved.json()) as WorkspaceView
    expect((await readWorkspace()).planning.evidence).toEqual(input.planning.evidence)

    const replay = await send('/api/workspace', 'PUT', JSON.stringify(saveInput))
    expect(replay.status).toBe(200)
    expect(((await replay.json()) as WorkspaceView).revision).toBe(result.revision)

    const stale = await send(
      '/api/workspace',
      'PUT',
      JSON.stringify({ ...input, requestId: randomUUID() }),
    )
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { error: string }).error).toBe('workspace_conflict')
    expect((await readWorkspace()).revision).toBe(result.revision)
  })

  it.each([WORKSPACE_BODY_LIMIT - 1, WORKSPACE_BODY_LIMIT])(
    'accepts both preview and save at %i UTF-8 bytes',
    async (size) => {
      const before = await readWorkspace()
      const input = requestFor(before)
      const { requestId: _requestId, ...previewInput } = input
      const preview = await send('/api/workspace/preview', 'POST', padToBytes(previewInput, size))
      expect(preview.status).toBe(200)
      const report = (await preview.json()) as WorkspaceImpact
      expect((await readWorkspace()).revision).toBe(before.revision)
      const saved = await send(
        '/api/workspace',
        'PUT',
        padToBytes({ ...input, previewHash: report.previewHash }, size),
      )
      expect(saved.status).toBe(200)
      expect((await readWorkspace()).planning).toEqual(input.planning)
    },
  )

  it.each([
    ['/api/workspace/preview', 'POST'],
    ['/api/workspace', 'PUT'],
  ] as const)('rejects %s at limit + 1 without changing stored input', async (path, method) => {
    const before = await readWorkspace()
    const input = requestFor(before)
    const { requestId: _requestId, ...previewInput } = input
    const body = padToBytes(method === 'POST' ? previewInput : input, WORKSPACE_BODY_LIMIT + 1)
    const response = await sendOversized(path, method, body)
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: 'workspace_too_large',
      limitBytes: WORKSPACE_BODY_LIMIT,
    })
    const after = await readWorkspace()
    expect(after.revision).toBe(before.revision)
    expect(after.planning).toEqual(before.planning)
    expect(after.configuration).toEqual(before.configuration)
  })

  it('keeps malformed JSON handling and CSRF protection', async () => {
    const before = await readWorkspace()
    const malformed = await send('/api/workspace', 'PUT', '{')
    expect(malformed.status).toBe(400)
    const noCsrf = await send('/api/workspace', 'PUT', JSON.stringify(requestFor(before)), false)
    expect(noCsrf.status).toBe(403)
    expect((await readWorkspace()).revision).toBe(before.revision)
  })
})
