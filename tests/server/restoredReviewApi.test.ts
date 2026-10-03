import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import { savePlanningFixture } from './helpers/workspace-fixture.js'

type Runtime = { csrfToken: string; datasetId: string; restoreRequiresReconnect: boolean }
type Running = { port: number; origin: string; child: ChildProcess; runtime: Runtime }
type SavedReview = {
  review: {
    id: string
    year: number
    materials: { planning: PlanningSnapshot; observations: unknown[] }
  }
}

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

function isolatedEnvironment(data: string, home: string, automatic: boolean) {
  return {
    ...process.env,
    DEVTAX_RADAR_DATA_DIR: data,
    HOME: home,
    USERPROFILE: home,
    DEVTAX_RADAR_CLAUDE_SETTINGS: join(home, 'claude-settings.json'),
    DEVTAX_RADAR_AUTO_SCAN: automatic ? '1' : '0',
  }
}

async function start(data: string, home: string, automatic: boolean): Promise<Running> {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
    cwd: resolve('.'),
    env: { ...isolatedEnvironment(data, home, automatic), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  child.on('error', (error) => {
    diagnostics = error.message
  })
  child.stdout?.on('data', (bytes) => {
    diagnostics = (diagnostics + String(bytes)).slice(-16000)
  })
  child.stderr?.on('data', (bytes) => {
    diagnostics = (diagnostics + String(bytes)).slice(-16000)
  })
  const deadline = Date.now() + 15000
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    try {
      const response = await fetch(origin + '/api/runtime', { signal: AbortSignal.timeout(1000) })
      if (response.ok) return { port, origin, child, runtime: (await response.json()) as Runtime }
    } catch {
      // Poll only the isolated process, never a user's existing runtime.
    }
    await new Promise((done) => setTimeout(done, 50))
  }
  await stop(child)
  throw new Error('Restored-review API fixture failed to start: ' + diagnostics)
}

function post(server: Running, route: string, body: unknown): Promise<Response> {
  return fetch(server.origin + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: server.origin,
      'X-DevTax-CSRF': server.runtime.csrfToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
}

async function json<T>(response: Response): Promise<T> {
  const text = await response.text()
  assert.ok(response.ok, `${response.status}: ${text}`)
  return JSON.parse(text) as T
}

async function read(server: Running, route: string): Promise<string> {
  const response = await fetch(server.origin + route, { signal: AbortSignal.timeout(15000) })
  const body = await response.text()
  assert.ok(response.ok, `${response.status}: ${body}`)
  return body
}

async function readAccountantCsv(server: Running, reviewPath: string): Promise<Uint8Array> {
  const response = await fetch(server.origin + reviewPath + '/export?format=accountant-csv', {
    signal: AbortSignal.timeout(15000),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/zip')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('content-disposition') ?? '', /-accountant-csv\.zip"$/)
  return new Uint8Array(await response.arrayBuffer())
}

function records(data: string) {
  const db = new DatabaseSync(join(data, 'devtax-radar.db'), { readOnly: true })
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
    return Object.fromEntries(
      tables.map(({ name }) => {
        const quoted = '"' + name.replaceAll('"', '""') + '"'
        return [
          name,
          db
            .prepare('SELECT * FROM ' + quoted)
            .all()
            .map((row) => JSON.stringify(row))
            .sort(),
        ]
      }),
    )
  } finally {
    db.close()
  }
}

describe('full product restore with originals unavailable', () => {
  it('preserves tables and reads adopted exports without originals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devtax-originals-unavailable-'))
    const originalHome = join(root, 'original home')
    const originalData = join(root, 'original data')
    const newHome = join(root, '別PC home')
    const restored = join(root, '復元 data')
    const bundle = join(root, 'backup bundle')
    const running: ChildProcess[] = []
    const backup = (...args: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ['--import', 'tsx', resolve('scripts/data-backup.ts'), ...args],
          {
            cwd: resolve('.'),
            encoding: 'utf8',
            timeout: 30000,
            env: isolatedEnvironment(join(root, 'unused-data'), newHome, false),
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      ) as Record<string, unknown>
    try {
      mkdirSync(newHome)
      cpSync(resolve('fixtures/claude'), join(originalHome, '.claude', 'projects'), {
        recursive: true,
      })
      const original = await start(originalData, originalHome, false)
      running.push(original.child)
      await json(await post(original, '/api/scan', { providers: ['claude'], mode: 'full' }))
      const planning: PlanningSnapshot = {
        version: 1,
        profile: {
          taxYear: 2026,
          journeyMode: 'retrospective',
          incomeCategory: 'undecided',
          filingType: 'undecided',
          monetizationStatus: 'planned',
          hasBookkeeping: false,
        },
        taxUnits: [
          {
            id: 'restore-review-unit',
            name: '合成復元検証',
            unitType: 'new-software',
            usageMode: 'external',
            revenueModel: 'sales',
            lifecycleStatus: 'developing',
            journeyMode: 'retrospective',
            monetizationStatus: 'planned',
          },
        ],
        projectRules: [],
        lifecycleEvents: [],
        equipment: [],
        homeCosts: [],
        directCosts: [
          {
            id: 'restore-review-cost',
            taxUnitId: 'restore-review-unit',
            incurredOn: '2026-07-01',
            costType: 'domain',
            amountJpy: 2000,
            directlyAttributable: true,
            treatment: 'direct',
            evidenceIds: [],
          },
        ],
        evidence: [],
        decisions: [],
      }
      await json(
        await savePlanningFixture(planning, {
          port: original.port,
          csrfToken: original.runtime.csrfToken,
        }),
      )
      const preview = JSON.parse(await read(original, '/api/balances/preview?year=2026')) as {
        draftRevision: number
        projectionHash: string
      }
      const saved = await json<SavedReview>(
        await post(original, '/api/balances/reviews', {
          year: 2026,
          expectedDraftRevision: preview.draftRevision,
          projectionHash: preview.projectionHash,
          expectedDatasetId: original.runtime.datasetId,
          idempotencyKey: randomUUID(),
          reason: '合成データの原本なし復元検証',
        }),
      )
      assert.equal(saved.review.year, 2026)
      assert.ok(
        saved.review.materials.observations.length > 0,
        'fixture must contain actual parsed usage',
      )
      assert.equal(saved.review.materials.planning.directCosts[0]?.amountJpy, 2000)
      const reviewPath = '/api/balances/reviews/' + saved.review.id
      const paths = [
        reviewPath,
        reviewPath + '/export?format=json',
        reviewPath + '/export?format=markdown',
      ]
      const expected = await Promise.all(paths.map((path) => read(original, path)))
      const expectedCsv = await readAccountantCsv(original, reviewPath)
      const expectedRecords = records(originalData)
      const salt = readFileSync(join(originalData, 'identifier-salt'))
      const manifest = backup('create', originalData, bundle)
      await stop(original.child)
      rmSync(originalHome, { recursive: true, force: true })
      rmSync(originalData, { recursive: true, force: true })
      assert.equal(existsSync(originalHome), false)
      assert.equal(existsSync(originalData), false)

      const restoredResult = backup('restore', bundle, restored)
      assert.equal(restoredResult.requiresSourceReconnect, true)
      assert.equal(restoredResult.schemaHash, manifest.schemaHash)
      assert.deepEqual(
        records(restored),
        expectedRecords,
        'all product tables must survive full restore',
      )
      assert.deepEqual(readFileSync(join(restored, 'identifier-salt')), salt)

      const held = await start(restored, newHome, true)
      running.push(held.child)
      assert.equal(held.runtime.datasetId, original.runtime.datasetId)
      assert.equal(held.runtime.restoreRequiresReconnect, true)
      const blocked = await post(held, '/api/scan', { providers: ['claude'], mode: 'full' })
      assert.equal(blocked.status, 409)
      const blockedBody = (await blocked.json()) as { error: string }
      assert.equal(blockedBody.error, 'restore_requires_reconnect')
      assert.deepEqual(await Promise.all(paths.map((path) => read(held, path))), expected)
      assert.deepEqual(await readAccountantCsv(held, reviewPath), expectedCsv)

      const reconnect = JSON.parse(await read(held, '/api/restore/sources')) as {
        plan: { sources: { sourceId: string; root: string; enabled: boolean }[] }
      }
      // Do not invent reachable originals or rewrite their old roots.
      // Disabled sources must retain the saved records.
      for (const source of reconnect.plan.sources) source.enabled = false
      await json(await post(held, '/api/restore/sources', reconnect.plan))
      await stop(held.child)

      const restarted = await start(restored, newHome, true)
      running.push(restarted.child)
      assert.equal(restarted.runtime.datasetId, original.runtime.datasetId)
      assert.equal(restarted.runtime.restoreRequiresReconnect, false)
      assert.deepEqual(await Promise.all(paths.map((path) => read(restarted, path))), expected)
      assert.deepEqual(await readAccountantCsv(restarted, reviewPath), expectedCsv)
      const sources = JSON.parse(await read(restarted, '/api/sources')) as {
        sources: { id: string; root: string; enabled: boolean }[]
      }
      assert.ok(sources.sources.length > 0)
      assert.ok(sources.sources.every((source) => !source.enabled))
      assert.deepEqual(
        backup('verify', bundle).files,
        manifest.files,
        'reading must not mutate the backup',
      )
    } finally {
      await Promise.all(running.map(stop))
      rmSync(root, { recursive: true, force: true })
    }
  }, 90000)
})
