import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { emptyPlanningSnapshot, type PlanningSnapshot } from '../../src/planning/types.js'

const children: ChildProcess[] = []
const temporaryDirectories: string[] = []

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
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  }
})

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a local test port'))
        return
      }
      const { port } = address
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForRuntime(port: number): Promise<Response> {
  const deadline = Date.now() + 10_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/runtime`)
      if (response.ok) {
        return response
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error(`Local server did not start: ${String(lastError)}`)
}

describe('local server boundary', () => {
  it('starts on loopback and protects the scan mutation', async () => {
    const port = await reservePort()
    const isolatedHome = mkdtempSync(join(tmpdir(), 'devtax-server-home-'))
    const isolatedData = mkdtempSync(join(tmpdir(), 'devtax-server-data-'))
    temporaryDirectories.push(isolatedHome, isolatedData)
    const claudeHistory = join(isolatedHome, '.claude', 'projects')
    mkdirSync(claudeHistory, { recursive: true })
    copyFileSync(
      resolve('fixtures/claude/synthetic-history.jsonl'),
      join(claudeHistory, 'synthetic-history.jsonl'),
    )
    const codexHistory = join(isolatedHome, '.codex', 'sessions', '2026', '04')
    mkdirSync(codexHistory, { recursive: true })
    copyFileSync(
      resolve('fixtures/codex/2026/04/synthetic-session.jsonl'),
      join(codexHistory, 'synthetic-session.jsonl'),
    )

    // Task 2: point retention reads at a throwaway settings file instead of
    // the real ~/.claude/settings.json. Must exist before the server starts.
    const claudeSettingsPath = join(isolatedData, 'claude-settings.json')
    writeFileSync(claudeSettingsPath, JSON.stringify({ cleanupPeriodDays: 400 }), 'utf8')

    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(port),
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        DEVTAX_RADAR_DATA_DIR: isolatedData,
        DEVTAX_RADAR_CLAUDE_SETTINGS: claudeSettingsPath,
      },
    })
    children.push(child)

    const runtimeResponse = await waitForRuntime(port)
    const runtime = (await runtimeResponse.json()) as {
      csrfToken: string
      privacy: {
        localOnly: boolean
        promptBodiesExtracted: boolean
        telemetry: boolean
      }
      retention: {
        claude: {
          detected: boolean
          fileCount: number
          oldestModifiedOn?: string
          autoDelete: { kind: string; days?: number; source?: string; reason?: string }
          nextLossOn?: string
          daysUntilNextLoss?: number
          alreadyLosing: boolean
        }
        codex: {
          detected: boolean
          fileCount: number
          oldestModifiedOn?: string
          autoDelete: { kind: string }
          alreadyLosing: boolean
        }
      }
    }
    expect(runtime.privacy).toEqual({
      localOnly: true,
      promptBodiesExtracted: false,
      telemetry: false,
    })
    expect(runtime.retention.claude.autoDelete).toEqual({
      kind: 'configured',
      days: 400,
      source: 'explicit',
    })
    expect(runtime.retention.claude.detected).toBe(true)
    expect(runtime.retention.claude.fileCount).toBe(1)
    expect(runtime.retention.codex.autoDelete).toEqual({ kind: 'none' })
    expect(runtime.retention.codex.detected).toBe(true)
    expect(runtime.retention.codex.fileCount).toBe(1)
    // The response must never carry a filesystem path.
    const serializedRuntime = JSON.stringify(runtime)
    expect(serializedRuntime).not.toContain('.claude')
    expect(serializedRuntime).not.toContain('.codex')

    const idleProgress = (await fetch(`http://127.0.0.1:${port}/api/scan/progress`).then(
      async (response) => await response.json(),
    )) as { running: boolean; provider: string | null; filesScanned: number }
    expect(idleProgress).toEqual({ running: false, provider: null, filesScanned: 0 })

    const nonLoopbackAddress = Object.values(networkInterfaces())
      .flat()
      .find(
        (address) =>
          address?.family === 'IPv4' && !address.internal && address.address !== '0.0.0.0',
      )?.address
    if (nonLoopbackAddress) {
      await expect(
        fetch(`http://${nonLoopbackAddress}:${port}/api/health`, {
          signal: AbortSignal.timeout(750),
        }),
      ).rejects.toThrow()
    }

    const missingToken = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ providers: [] }),
    })
    expect(missingToken.status).toBe(403)

    const foreignOrigin = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({ providers: [] }),
    })
    expect(foreignOrigin.status).toBe(403)

    const invalidButAuthorized = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({ providers: [] }),
    })
    expect(invalidButAuthorized.status).toBe(400)

    const scanResponse = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({ providers: ['claude', 'codex'] }),
    })
    expect(scanResponse.status).toBe(200)

    const unconfiguredDashboard = (await fetch(`http://127.0.0.1:${port}/api/dashboard`).then(
      async (response) => await response.json(),
    )) as {
      products: Array<{ projectKey: string; folder: string }>
    }
    const productA = unconfiguredDashboard.products.find(
      (product) => product.folder === 'Product-A',
    )
    const productB = unconfiguredDashboard.products.find(
      (product) => product.folder === 'Product-B',
    )
    const projectKey = productA?.projectKey
    expect(projectKey).toMatch(/^project_[0-9a-f]{24}$/)
    expect(productB?.projectKey).toMatch(/^project_[0-9a-f]{24}$/)

    const configuration = {
      charges: { claude: 30_001, codex: 20_003 },
      monthlyCharges: [
        {
          provider: 'claude',
          month: '2025-04',
          amountJpy: 12_345,
        },
        {
          provider: 'claude',
          month: '2026-04',
          amountJpy: 120_000,
        },
      ],
      contracts: {
        // Task 2 note: chosen to predate both configured months (2025-04 and
        // 2026-04) so contract enforcement (added in Task 2) does not exclude
        // either from the dashboard assertions below -- this block exercises
        // config round-tripping, not contract-period filtering. That behavior
        // is covered separately further down with a contract set after both
        // sessions' dates.
        claude: { startedOn: '2025-01-01' },
        codex: {},
      },
      unobservedRatio: 0.1,
    }
    const saveResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(configuration),
    })
    expect(saveResponse.status).toBe(200)
    expect(await saveResponse.json()).toEqual({ saved: true })

    const storedConfiguration = (await fetch(`http://127.0.0.1:${port}/api/config`).then(
      async (response) => await response.json(),
    )) as typeof configuration
    expect(storedConfiguration).toEqual({
      charges: configuration.charges,
      monthlyCharges: configuration.monthlyCharges,
      contracts: configuration.contracts,
      unobservedRatio: configuration.unobservedRatio,
    })

    // Task 8 removed configuration.mappings entirely: classification and
    // product naming come only from planning project rules now. Register
    // rules covering the same two synthetic sessions so the dashboard groups
    // them the way this test expects.
    const planningSnapshot: PlanningSnapshot = {
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
          id: 'tax-unit-product-a',
          name: 'Product A',
          unitType: 'new-software',
          usageMode: 'external',
          revenueModel: 'sales',
          lifecycleStatus: 'developing',
        },
      ],
      projectRules: [
        {
          id: 'rule-product-a',
          projectKey: projectKey!,
          effectiveFrom: '2025-01-01',
          taxUnitId: 'tax-unit-product-a',
          classification: 'new-development',
        },
        {
          id: 'rule-product-b',
          projectKey: productB!.projectKey,
          effectiveFrom: '2025-01-01',
          taxUnitId: 'tax-unit-product-a',
          classification: 'feature-addition',
        },
      ],
      lifecycleEvents: [],
      equipment: [],
      homeCosts: [],
      directCosts: [],
      evidence: [],
      decisions: [],
    }
    const planningResponse = await fetch(`http://127.0.0.1:${port}/api/planning`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(planningSnapshot),
    })
    expect(planningResponse.status).toBe(200)

    const dashboard = (await fetch(`http://127.0.0.1:${port}/api/dashboard`).then(
      async (response) => await response.json(),
    )) as {
      meta: {
        source: string
        sessionCount: number
        mappedRate: number
        classifiedRate: number
      }
      months: Array<{
        label: string
        current: number
        future: number
        review: number
      }>
      allocations: Array<{
        provider: string
        amount: number
        session: { folder: string }
      }>
      assets: Array<{ product: string; name: string; total: number }>
      boundaries: Array<{
        amount: number
        threshold: number
        thresholdLabel: string
        status: string
        tone: string
      }>
      guidance: unknown[]
      products: Array<{
        name: string
        folder: string
        sessions: number
        projectKey: string
      }>
    }

    expect(dashboard.meta).toMatchObject({
      source: 'local',
      sessionCount: 2,
      mappedRate: 100,
      classifiedRate: 100,
    })
    expect(dashboard.months).toHaveLength(2)
    expect(dashboard.months.map((month) => month.label)).toEqual(['2025年4月', '2026年4月'])
    expect(dashboard.allocations.length).toBeGreaterThanOrEqual(2)
    expect(dashboard.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ product: 'Product A', name: 'Product A' }),
        expect.objectContaining({
          product: 'Product A',
          name: 'Product A（改良計画）',
        }),
      ]),
    )
    expect(dashboard.boundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 108_000,
          threshold: 100_000,
          thresholdLabel: '10万円境界',
          status: expect.stringContaining('通常償却または3年一括の候補'),
          tone: 'review',
        }),
        expect.objectContaining({
          asset: 'Product A（改良計画）',
          threshold: 200_000,
          thresholdLabel: expect.stringContaining('修繕・改良'),
          tone: 'review',
        }),
      ]),
    )
    expect(Array.isArray(dashboard.guidance)).toBe(true)
    expect(dashboard.products[0]).toEqual(
      expect.objectContaining({
        name: 'Product A',
        folder: 'Product-A',
        sessions: 1,
        projectKey,
      }),
    )

    const claudeTotal = dashboard.allocations
      .filter((allocation) => allocation.provider === 'Claude Code')
      .reduce((sum, allocation) => sum + allocation.amount, 0)
    expect(claudeTotal).toBe(
      configuration.monthlyCharges.reduce((sum, charge) => sum + charge.amountJpy, 0),
    )
    expect(
      dashboard.months[0]!.current + dashboard.months[0]!.future + dashboard.months[0]!.review,
    ).toBe(configuration.monthlyCharges[0].amountJpy)
    expect(
      dashboard.months[1]!.current + dashboard.months[1]!.future + dashboard.months[1]!.review,
    ).toBe(configuration.monthlyCharges[1].amountJpy + configuration.charges.codex)

    const serializedDashboard = JSON.stringify(dashboard)
    expect(serializedDashboard).not.toContain('C:\\Synthetic')
    expect(serializedDashboard).not.toContain('C:/Synthetic')
    expect(serializedDashboard).not.toContain('SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_ESCAPE')
    expect(serializedDashboard).not.toContain('synthetic-claude-session-1')

    const laterContractResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({
        ...configuration,
        contracts: { claude: { startedOn: '2030-01-01' }, codex: { startedOn: '2030-01-01' } },
      }),
    })
    expect(laterContractResponse.status).toBe(200)

    const contractDashboard = (await fetch(`http://127.0.0.1:${port}/api/dashboard`).then(
      async (response) => await response.json(),
    )) as { allocations: Array<{ amount: number; taxCandidate: string }> }
    // Every synthetic session predates the contract, so no money is allocated
    // and every session still shows up as an explained zero-yen line.
    expect(contractDashboard.allocations.every((row) => row.amount === 0)).toBe(true)
    expect(contractDashboard.allocations.some((row) => row.taxCandidate === '契約期間外')).toBe(
      true,
    )

    const restoreConfigurationResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(configuration),
    })
    expect(restoreConfigurationResponse.status).toBe(200)

    const duplicateChargeResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({
        ...configuration,
        monthlyCharges: [configuration.monthlyCharges[0], configuration.monthlyCharges[0]],
      }),
    })
    expect(duplicateChargeResponse.status).toBe(400)

    const invalidContractResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({
        ...configuration,
        contracts: { claude: { startedOn: '2026-07-01', endedOn: '2026-06-30' }, codex: {} },
      }),
    })
    expect(invalidContractResponse.status).toBe(400)

    if (existsSync(resolve('dist/index.html'))) {
      const staticResponse = await fetch(`http://127.0.0.1:${port}/`)
      expect(staticResponse.status).toBe(200)
      expect(await staticResponse.text()).toContain('<div id="root"></div>')
    }

    const clearedConfiguration = {
      ...configuration,
      monthlyCharges: [],
    }
    const clearResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(clearedConfiguration),
    })
    expect(clearResponse.status).toBe(200)
    const configurationAfterClear = await fetch(`http://127.0.0.1:${port}/api/config`).then(
      async (response) => await response.json(),
    )
    expect(configurationAfterClear).toEqual(clearedConfiguration)
  }, 20_000)
})

describe('セッション単位のダッシュボード集計', () => {
  // This describe block's server and database directory are shared across
  // both `it` blocks below (the second test relies on a session the first
  // test wrote), so they are set up once in `beforeAll` and torn down once
  // in `afterAll` here -- deliberately not registered with the module-level
  // `children`/`temporaryDirectories` arrays, since the top-level `afterEach`
  // would tear them down after the first test and break the second.
  let testPort: number
  let dataDirectory: string
  let dashboardChild: ChildProcess | undefined
  let databaseModule: typeof import('../../src/server/database.ts')
  let replaceProviderSessions: (typeof import('../../src/server/database.ts'))['replaceProviderSessions']
  let savePlanningSnapshot: (typeof import('../../src/server/planningRepository.ts'))['savePlanningSnapshot']

  beforeAll(async () => {
    testPort = await reservePort()
    dataDirectory = mkdtempSync(join(tmpdir(), 'devtax-dashboard-agg-'))

    // The two tests below seed the database directly, in this process, so
    // they don't need real Claude/Codex history fixtures.
    process.env.DEVTAX_RADAR_DATA_DIR = dataDirectory
    vi.resetModules()
    databaseModule = await import('../../src/server/database.ts')
    ;({ replaceProviderSessions } = databaseModule)
    ;({ savePlanningSnapshot } = await import('../../src/server/planningRepository.ts'))

    dashboardChild = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(testPort),
        // /api/runtime now walks the whole transcript tree to date the oldest
        // file. Without an isolated home this test would walk the developer's
        // real history -- gigabytes on some machines -- making its runtime
        // depend on whose machine it runs on.
        HOME: dataDirectory,
        USERPROFILE: dataDirectory,
        DEVTAX_RADAR_DATA_DIR: dataDirectory,
        // This block doesn't assert on retention, but /api/runtime always
        // reads it -- without this override it would fall through to the
        // real ~/.claude/settings.json. A missing file is handled as the
        // default cleanup period, so it does not need to be created here.
        DEVTAX_RADAR_CLAUDE_SETTINGS: join(dataDirectory, 'claude-settings.json'),
      },
    })
    await waitForRuntime(testPort)
  })

  afterAll(async () => {
    if (dashboardChild && dashboardChild.exitCode === null) {
      dashboardChild.kill()
      await new Promise<void>((resolveExit) => {
        const timeout = setTimeout(resolveExit, 2_000)
        dashboardChild!.once('exit', () => {
          clearTimeout(timeout)
          resolveExit()
        })
      })
    }
    databaseModule?.getDatabase().close()
    delete process.env.DEVTAX_RADAR_DATA_DIR
    rmSync(dataDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  })

  async function getJson(path: string): Promise<any> {
    const response = await fetch(`http://127.0.0.1:${testPort}${path}`)
    return await response.json()
  }

  it('ルールがなければ分類済みは0%、対応付け済みも0%になる', async () => {
    replaceProviderSessions(
      'claude',
      [
        {
          provider: 'claude',
          sessionKey: 'session_integration_a',
          projectKey: 'project_integration_a',
          month: '2026-07',
          startedAt: '2026-07-15T10:00:00.000Z',
          endedAt: '2026-07-15T11:00:00.000Z',
          messageCount: 3,
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          schemaVersion: 'test-v1',
          confidence: 'medium',
        },
      ],
      { filesSeen: 1, malformedLines: 0 },
    )

    const dashboard = await getJson('/api/dashboard')
    expect(dashboard.meta.classifiedRate).toBe(0)
    expect(dashboard.meta.mappedRate).toBe(0)
  })

  it('ルールを登録すると分類済みが上がる', async () => {
    savePlanningSnapshot({
      ...emptyPlanningSnapshot(2026),
      taxUnits: [
        {
          id: 'tax-unit-integration',
          name: '統合テスト用アプリ',
          unitType: 'new-software',
          usageMode: 'external',
          revenueModel: 'sales',
          lifecycleStatus: 'developing',
        },
      ],
      projectRules: [
        {
          id: 'rule-integration',
          projectKey: 'project_integration_a',
          effectiveFrom: '2026-07-01',
          taxUnitId: 'tax-unit-integration',
          classification: 'new-development',
        },
      ],
    })

    const dashboard = await getJson('/api/dashboard')
    expect(dashboard.meta.classifiedRate).toBe(100)
    expect(
      dashboard.allocations.some(
        (row: { product: string }) => row.product === '統合テスト用アプリ',
      ),
    ).toBe(true)
  })

  it('配賦明細の行が元のフォルダと月を持つ', async () => {
    const dashboard = await getJson('/api/dashboard')
    const row = dashboard.allocations.find(
      (item: { stage: string }) => item.stage !== '未取得' && item.stage !== '1円未満調整',
    )
    expect(row.projectKey).toBeTruthy()
    expect(row.monthKey).toMatch(/^\d{4}-\d{2}$/)
  })

  it('配賦明細の行は割り当てられた制作物のtaxUnitIdを持つ', async () => {
    // Guards the server half of the reclassify-from-evidence contract: the
    // client only knows which product currently governs an allocation row
    // because dashboard.ts puts taxUnitId on the row. If a future change to
    // dashboard.ts drops this field, reclassifying a folder from the
    // allocation table would silently fall back to detaching its product
    // (see App.tsx's reclassifyAllocation).
    const dashboard = await getJson('/api/dashboard')
    const row = dashboard.allocations.find(
      (item: { product: string }) => item.product === '統合テスト用アプリ',
    )
    expect(row).toBeTruthy()
    expect(row.taxUnitId).toBe('tax-unit-integration')
  })

  it('月の途中でルールが切り替わるフォルダは、その月に分類の異なる2行を生む', async () => {
    // One folder, two sessions in the same month: one comfortably in the
    // first half, one comfortably in the second half. Times are chosen far
    // from both the day boundary and the rule-effective-date boundary so the
    // assertion holds regardless of the host's local time zone (resolveSessionAssignment
    // judges rules by the session's *local* date).
    replaceProviderSessions(
      'claude',
      [
        {
          provider: 'claude',
          sessionKey: 'session_midmonth_first_half',
          projectKey: 'project_integration_midmonth',
          month: '2026-08',
          startedAt: '2026-08-03T10:00:00.000Z',
          endedAt: '2026-08-03T11:00:00.000Z',
          messageCount: 2,
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          schemaVersion: 'test-v1',
          confidence: 'medium',
        },
        {
          provider: 'claude',
          sessionKey: 'session_midmonth_second_half',
          projectKey: 'project_integration_midmonth',
          month: '2026-08',
          startedAt: '2026-08-25T10:00:00.000Z',
          endedAt: '2026-08-25T11:00:00.000Z',
          messageCount: 2,
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          schemaVersion: 'test-v1',
          confidence: 'medium',
        },
      ],
      { filesSeen: 1, malformedLines: 0 },
    )

    databaseModule.saveConfiguration({
      charges: { claude: 0, codex: 0 },
      monthlyCharges: [{ provider: 'claude', month: '2026-08', amountJpy: 100_000 }],
      contracts: { claude: {}, codex: {} },
      unobservedRatio: 0.1,
    })

    savePlanningSnapshot({
      ...emptyPlanningSnapshot(2026),
      taxUnits: [
        {
          id: 'tax-unit-midmonth',
          name: '月またぎ検証用アプリ',
          unitType: 'new-software',
          usageMode: 'external',
          revenueModel: 'sales',
          lifecycleStatus: 'developing',
        },
      ],
      projectRules: [
        {
          id: 'rule-midmonth-first-half',
          projectKey: 'project_integration_midmonth',
          effectiveFrom: '2026-08-01',
          effectiveTo: '2026-08-14',
          taxUnitId: 'tax-unit-midmonth',
          classification: 'new-development',
        },
        {
          id: 'rule-midmonth-second-half',
          projectKey: 'project_integration_midmonth',
          effectiveFrom: '2026-08-15',
          taxUnitId: 'tax-unit-midmonth',
          classification: 'maintenance',
        },
      ],
    })

    const dashboard = (await getJson('/api/dashboard')) as {
      allocations: Array<{
        provider: string
        month: string
        product: string
        stage: string
        taxCandidate: string
        amount: number
      }>
    }

    const augustClaudeRows = dashboard.allocations.filter(
      (row) => row.provider === 'Claude Code' && row.month === '2026年8月',
    )
    const midMonthRows = augustClaudeRows.filter((row) => row.product === '月またぎ検証用アプリ')

    // The same folder, split across the rule boundary, must appear as two
    // distinct rows for the month -- not collapse into one (un)classified row.
    const stages = midMonthRows.map((row) => row.stage)
    const taxCandidates = midMonthRows.map((row) => row.taxCandidate)
    expect(midMonthRows).toHaveLength(2)
    expect(stages).toContain('新規開発')
    expect(stages).toContain('保守')
    expect(taxCandidates).toContain('取得価額')
    expect(taxCandidates).toContain('通常経費')

    // The allocation invariant must hold across the split: everything billed
    // for claude in 2026-08 (the two classified rows plus any unobserved/
    // rounding rows) sums to exactly the configured monthly fee.
    const augustClaudeTotal = augustClaudeRows.reduce((sum, row) => sum + row.amount, 0)
    expect(augustClaudeTotal).toBe(100_000)
  })

  it('生のセッションID・絶対パス・作業ディレクトリはどのAPIレスポンスにも現れない', async () => {
    const rawNativeSessionId = 'RAW-SESSION-ID-SHOULD-NOT-LEAK'
    const rawSourcePath = 'C:/RAW-PATH-SHOULD-NOT-LEAK/transcript.jsonl'
    const rawWorkingDirectory = 'C:/RAW-CWD-SHOULD-NOT-LEAK'

    replaceProviderSessions(
      'claude',
      [
        {
          provider: 'claude',
          sessionKey: 'session_privacy_guard',
          projectKey: 'project_privacy_guard',
          month: '2026-09',
          startedAt: '2026-09-05T10:00:00.000Z',
          endedAt: '2026-09-05T11:00:00.000Z',
          messageCount: 1,
          inputTokens: 500,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          schemaVersion: 'test-v1',
          confidence: 'medium',
          localReference: {
            nativeSessionId: rawNativeSessionId,
            sourcePath: rawSourcePath,
            workingDirectory: rawWorkingDirectory,
          },
        },
      ],
      { filesSeen: 1, malformedLines: 0 },
    )

    // Prove the seeded reference actually reached session_references --
    // otherwise the "does not leak" assertions below would pass vacuously.
    const stored = databaseModule.getSessionReference('claude', 'session_privacy_guard')
    expect(stored).toMatchObject({
      nativeSessionId: rawNativeSessionId,
      sourcePath: rawSourcePath,
      workingDirectory: rawWorkingDirectory,
    })

    const dashboardBody = JSON.stringify(await getJson('/api/dashboard'))
    const ledgerBody = JSON.stringify(await getJson('/api/ledger'))
    const diagnosisBody = JSON.stringify(await getJson('/api/diagnosis'))
    const foldersBody = JSON.stringify(await getJson('/api/folders'))
    const exportBody = JSON.stringify(
      await fetch(`http://127.0.0.1:${testPort}/api/export?format=markdown`).then((response) =>
        response.text(),
      ),
    )

    for (const raw of [rawNativeSessionId, rawSourcePath, rawWorkingDirectory]) {
      expect(dashboardBody).not.toContain(raw)
      expect(ledgerBody).not.toContain(raw)
      expect(diagnosisBody).not.toContain(raw)
      expect(foldersBody).not.toContain(raw)
      expect(exportBody).not.toContain(raw)
    }
  })

  it('セッション一覧に生の識別子が出ない', async () => {
    // Query the project seeded by the privacy-guard test just above, which is
    // the one with a live session_references row containing the raw markers
    // (project_integration_a's session was already wiped by later
    // replaceProviderSessions('claude', ...) calls, which replace every
    // claude row on each call -- querying it here would pass vacuously on an
    // empty list and prove nothing).
    const response = await getJson(
      `/api/sessions?projectKey=${encodeURIComponent('project_privacy_guard')}`,
    )
    expect(response.sessions).toHaveLength(1)
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('RAW-SESSION-ID-SHOULD-NOT-LEAK')
    expect(serialized).not.toContain('RAW-PATH-SHOULD-NOT-LEAK')
    expect(serialized).not.toContain('RAW-CWD-SHOULD-NOT-LEAK')
  })

  it('GET /api/folders はフォルダ一覧の形で返す', async () => {
    const response = await getJson('/api/folders')
    expect(Array.isArray(response.folders)).toBe(true)
    expect(response.folders[0]).toEqual(
      expect.objectContaining({
        projectKey: expect.any(String),
        label: expect.any(String),
        sessionCount: expect.any(Number),
      }),
    )
  })

  it('GET /api/sessions はセッション一覧の形で返す', async () => {
    // replaceProviderSessions replaces all claude rows on every call, so by
    // this point only the session seeded by the privacy-guard test above
    // (the most recent replaceProviderSessions('claude', ...) call) survives.
    const response = await getJson(
      `/api/sessions?projectKey=${encodeURIComponent('project_privacy_guard')}`,
    )
    expect(Array.isArray(response.sessions)).toBe(true)
    expect(response.sessions[0]).toEqual(
      expect.objectContaining({
        provider: 'claude',
        sessionKey: 'session_privacy_guard',
      }),
    )
  })

  it('GET /api/sessions/detail はセッション詳細の形で返す', async () => {
    const response = await getJson(
      `/api/sessions/detail?provider=claude&sessionKey=${encodeURIComponent('session_privacy_guard')}`,
    )
    expect(response).toEqual(
      expect.objectContaining({
        available: true,
        transcriptExists: false,
      }),
    )
  })
})
