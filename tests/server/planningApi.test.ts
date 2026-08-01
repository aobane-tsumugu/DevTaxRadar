import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'

const children: ChildProcess[] = []
const directories: string[] = []

async function port(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('No test port'))
      server.close(() => resolvePort(address.port))
    })
  })
}

async function runtime(testPort: number): Promise<{ csrfToken: string }> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${testPort}/api/runtime`)
      if (response.ok) return (await response.json()) as { csrfToken: string }
    } catch {
      // Retry until the test server has bound the loopback socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error('Planning API test server did not start')
}

function snapshot(): PlanningSnapshot {
  return {
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
        id: 'unit-api-test',
        name: '公開予定アプリ',
        unitType: 'new-software',
        usageMode: 'external',
        revenueModel: 'sales',
        lifecycleStatus: 'developing',
        journeyMode: 'retrospective',
        monetizationStatus: 'planned',
      },
    ],
    projectRules: [
      {
        id: 'rule-api-test',
        projectKey: 'project_abcdef0123456789abcdef01',
        effectiveFrom: '2026-07-01',
        taxUnitId: 'unit-api-test',
        classification: 'new-development',
      },
    ],
    lifecycleEvents: [],
    equipment: [],
    homeCosts: [],
    directCosts: [
      {
        id: 'direct-api-test',
        taxUnitId: 'unit-api-test',
        incurredOn: '2026-07-01',
        costType: 'domain',
        amountJpy: 2_000,
        directlyAttributable: true,
        treatment: 'direct',
        evidenceIds: [],
      },
    ],
    evidence: [],
    decisions: [],
  }
}

async function startServer(): Promise<{
  port: number
  csrfToken: string
}> {
  const testPort = await port()
  const data = mkdtempSync(join(tmpdir(), 'devtax-planning-api-'))
  directories.push(data)
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
    cwd: resolve('.'),
    stdio: 'ignore',
    env: { ...process.env, PORT: String(testPort), DEVTAX_RADAR_DATA_DIR: data },
  })
  children.push(child)
  const { csrfToken } = await runtime(testPort)
  return { port: testPort, csrfToken }
}

async function put(
  url: string,
  body: unknown,
  config: { port: number; csrfToken: string },
): Promise<Response> {
  return fetch(`http://127.0.0.1:${config.port}${url}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${config.port}`,
      'x-devtax-csrf': config.csrfToken,
    },
    body: JSON.stringify(body),
  })
}

async function getJson(url: string, config: { port: number }): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${config.port}${url}`)
  return response.json()
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill()
      await new Promise<void>((resolveExit) => {
        const timeout = setTimeout(resolveExit, 2_000)
        child.once('exit', () => {
          clearTimeout(timeout)
          resolveExit()
        })
      })
    }
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('planning HTTP API', () => {
  it('persists validated planning, derives guidance, and exports markdown', async () => {
    const testPort = await port()
    const data = mkdtempSync(join(tmpdir(), 'devtax-planning-api-'))
    directories.push(data)
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: 'ignore',
      env: { ...process.env, PORT: String(testPort), DEVTAX_RADAR_DATA_DIR: data },
    })
    children.push(child)
    const { csrfToken } = await runtime(testPort)
    const planning = snapshot()

    const missingCsrf = await fetch(`http://127.0.0.1:${testPort}/api/planning`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(planning),
    })
    expect(missingCsrf.status).toBe(403)

    const invalid = await fetch(`http://127.0.0.1:${testPort}/api/planning`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${testPort}`,
        'x-devtax-csrf': csrfToken,
      },
      body: JSON.stringify({ ...planning, version: 2 }),
    })
    expect(invalid.status).toBe(400)

    const saved = await fetch(`http://127.0.0.1:${testPort}/api/planning`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${testPort}`,
        'x-devtax-csrf': csrfToken,
      },
      body: JSON.stringify(planning),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ saved: true })

    const restored = await fetch(`http://127.0.0.1:${testPort}/api/planning`).then(
      async (response) => await response.json(),
    )
    expect(restored).toEqual(planning)

    const diagnosis = await fetch(`http://127.0.0.1:${testPort}/api/diagnosis`)
    expect(diagnosis.status).toBe(200)
    expect(await diagnosis.json()).toEqual(
      expect.objectContaining({
        currentPosition: expect.any(Array),
        immediateActions: expect.any(Array),
        missingFacts: expect.any(Array),
      }),
    )

    const ledger = await fetch(`http://127.0.0.1:${testPort}/api/ledger`)
    expect(ledger.status).toBe(200)
    expect(await ledger.json()).toEqual(
      expect.objectContaining({
        year: 2026,
        contributions: expect.any(Array),
        totals: expect.objectContaining({ grossAmountJpy: 2_000 }),
      }),
    )

    const exported = await fetch(`http://127.0.0.1:${testPort}/api/export?format=markdown`)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('text/markdown')
    expect(await exported.text()).toContain('公開予定アプリ')

    const badExport = await fetch(`http://127.0.0.1:${testPort}/api/export?format=csv`)
    expect(badExport.status).toBe(400)
  }, 20_000)

  it('ルールだけを置き換えられる', async () => {
    const config = await startServer()
    await put(
      '/api/planning',
      {
        ...emptyPlanningSnapshot(2026),
        taxUnits: [
          {
            id: 'unit-rules-api',
            name: 'ルールAPI用',
            unitType: 'new-software',
            usageMode: 'external',
            revenueModel: 'sales',
            lifecycleStatus: 'developing',
          },
        ],
      },
      config,
    )

    const response = await put(
      '/api/planning/rules',
      {
        rules: [
          {
            id: 'rule-api-1',
            projectKey: 'project_rules_api_0001',
            effectiveFrom: '2026-01-01',
            taxUnitId: 'unit-rules-api',
            classification: 'new-development',
          },
        ],
      },
      config,
    )
    expect(response.status).toBe(200)

    const snapshot = await getJson('/api/planning', config)
    expect((snapshot as PlanningSnapshot).projectRules).toHaveLength(1)
    expect((snapshot as PlanningSnapshot).taxUnits).toHaveLength(1)
  }, 20_000)

  it('存在しない制作物を指すルールを拒否する', async () => {
    const config = await startServer()
    const response = await put(
      '/api/planning/rules',
      {
        rules: [
          {
            id: 'rule-api-orphan',
            projectKey: 'project_rules_api_0002',
            effectiveFrom: '2026-01-01',
            taxUnitId: 'unit-does-not-exist',
            classification: 'new-development',
          },
        ],
      },
      config,
    )
    expect(response.status).toBe(400)
  }, 20_000)

  it('設定APIはmappingsを受け付けない', async () => {
    const testPort = await port()
    const data = mkdtempSync(join(tmpdir(), 'devtax-planning-api-'))
    directories.push(data)
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: 'ignore',
      env: { ...process.env, PORT: String(testPort), DEVTAX_RADAR_DATA_DIR: data },
    })
    children.push(child)
    const { csrfToken } = await runtime(testPort)

    const response = await fetch(`http://127.0.0.1:${testPort}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${testPort}`,
        'x-devtax-csrf': csrfToken,
      },
      body: JSON.stringify({
        charges: { claude: 30000, codex: 20000 },
        monthlyCharges: [],
        unobservedRatio: 0.1,
        mappings: [
          {
            projectKey: 'project_should_be_rejected',
            productName: 'x',
            assetName: 'y',
            classification: 'private',
          },
        ],
      }),
    })
    expect(response.status).toBe(400)
  }, 20_000)
})
