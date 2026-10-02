import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AnnualCostProjection } from '../../src/accounting/costs.js'
import type { DashboardData, LocalConfiguration } from '../../src/client/types.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import type { WorkspaceView } from '../../src/planning/workspace.js'
import { saveConfigurationFixture, savePlanningFixture } from './helpers/workspace-fixture.js'

async function portNumber() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  )
  return address.port
}

/** Each case owns its server, home, data and fixtures; no cross-test state chain. */
describe('local API integration through the versioned workspace', () => {
  let root: string, port: number, child: ChildProcess | undefined, csrfToken: string
  const rawSession = 'PRIVATE_NATIVE_SESSION_CANARY'
  const prompt = 'PRIVATE_PROMPT_CANARY'
  const defaults = (): LocalConfiguration => ({
    charges: { claude: 0, codex: 0 },
    monthlyCharges: [],
    contracts: { claude: {}, codex: {} },
    chargePeriods: [],
    unobservedRatio: 0,
  })
  const origin = () => `http://127.0.0.1:${port}`
  const connection = () => ({ port, csrfToken })
  async function json<T>(path: string): Promise<T> {
    const response = await fetch(origin() + path)
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
    return response.json() as Promise<T>
  }
  function post(path: string, body: unknown, token = csrfToken, requestOrigin = origin()) {
    return fetch(origin() + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: requestOrigin,
        ...(token ? { 'X-DevTax-CSRF': token } : {}),
      },
      body: JSON.stringify(body),
    })
  }
  async function setCosts(configuration: LocalConfiguration) {
    expect((await saveConfigurationFixture(configuration, connection())).status).toBe(200)
  }
  async function assign() {
    const dashboard = await json<DashboardData>('/api/dashboard')
    const planning = emptyPlanningSnapshot(2026)
    planning.taxUnits = [
      {
        id: 'app',
        name: '合成アプリ',
        unitType: 'new-software',
        usageMode: 'external',
        revenueModel: 'sales',
        lifecycleStatus: 'developing',
      },
    ]
    planning.projectRules = dashboard.products.map((product, index) => ({
      id: `rule-${index}`,
      projectKey: product.projectKey!,
      effectiveFrom: '2025-01-01',
      taxUnitId: 'app',
      classification: 'new-development' as const,
    }))
    expect((await savePlanningFixture(planning, connection())).status).toBe(200)
    return planning
  }
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'devtax-api-'))
    // The server reads the default history roots under the isolated home.
    const claude = join(root, '.claude', 'projects'),
      codex = join(root, '.codex', 'sessions')
    mkdirSync(claude, { recursive: true })
    mkdirSync(codex, { recursive: true })
    const rows = ['2025-04-15T10:00:00Z', '2026-04-03T10:00:00Z', '2026-04-25T10:00:00Z'].flatMap(
      (timestamp, index) => [
        {
          type: 'user',
          sessionId: index === 0 ? rawSession + '-old' : rawSession,
          timestamp,
          cwd: join(root, 'Product-A'),
          message: { role: 'user', content: prompt },
        },
        {
          type: 'assistant',
          sessionId: index === 0 ? rawSession + '-old' : rawSession,
          timestamp,
          cwd: join(root, 'Product-A'),
          message: {
            id: `message-${index}`,
            model: 'synthetic',
            usage: {
              input_tokens: 1000,
              output_tokens: 100,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        },
      ],
    )
    writeFileSync(
      join(claude, 'synthetic.jsonl'),
      rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    )
    writeFileSync(
      join(codex, 'synthetic.jsonl'),
      [
        {
          type: 'session_meta',
          timestamp: '2026-04-15T10:00:00Z',
          payload: { id: rawSession + '-codex', cwd: join(root, 'Product-B') },
        },
        {
          type: 'turn_context',
          timestamp: '2026-04-15T10:00:01Z',
          payload: { model: 'synthetic' },
        },
        {
          type: 'event_msg',
          timestamp: '2026-04-15T10:00:02Z',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 2000,
                cached_input_tokens: 500,
                output_tokens: 200,
                reasoning_output_tokens: 100,
                total_tokens: 2200,
              },
            },
          },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n',
    )
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({ cleanupPeriodDays: 30, unrelated: true }),
    )
    port = await portNumber()
    let output = ''
    child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        TZ: 'UTC',
        HOME: root,
        USERPROFILE: root,
        DEVTAX_RADAR_DATA_DIR: join(root, 'data'),
        DEVTAX_RADAR_CLAUDE_SETTINGS: join(root, 'settings.json'),
        DEVTAX_RADAR_AUTO_SCAN: '0',
      },
    })
    const collect = (buffer: Buffer) => {
      output = (output + buffer.toString()).slice(-8000)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    csrfToken = ''
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline && !csrfToken) {
      if (child.exitCode !== null) throw new Error(output)
      try {
        csrfToken = (await json<{ csrfToken: string }>('/api/runtime')).csrfToken
      } catch {
        await new Promise((done) => setTimeout(done, 75))
      }
    }
    if (!csrfToken) throw new Error('API startup failed: ' + output)
    const scan = await post('/api/scan', { providers: ['claude', 'codex'] })
    expect(scan.status).toBe(200)
    expect(
      ((await scan.json()) as { sources: Array<{ status: string }> }).sources
        .map((row) => row.status)
        .sort(),
    ).toEqual(['complete', 'complete'])
    await setCosts(defaults())
    expect((await savePlanningFixture(emptyPlanningSnapshot(2026), connection())).status).toBe(200)
  }, 20_000)
  afterEach(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit'),
        timeout = setTimeout(() => child?.kill('SIGKILL'), 3000)
      child.kill()
      try {
        await exited
      } finally {
        clearTimeout(timeout)
      }
    }
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('keeps CSRF/origin checks and rejects old writers without changing saved records', async () => {
    expect(await json('/api/health')).toMatchObject({ ok: true, service: 'devtax-radar' })
    expect((await post('/api/scan', {}, '')).status).toBe(403)
    expect((await post('/api/scan', {}, csrfToken, 'https://example.invalid')).status).toBe(403)
    const before = await json<WorkspaceView>('/api/workspace')
    for (const [path, method, body] of [
      ['/api/config', 'POST', defaults()],
      ['/api/planning', 'PUT', before.planning],
      ['/api/planning/rules', 'PUT', { rules: [] }],
    ] as const) {
      const response = await fetch(origin() + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          origin: origin(),
          'X-DevTax-CSRF': csrfToken,
        },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(404)
      expect(await json('/api/workspace')).toEqual(before)
    }
  })
  it('round-trips monthly charges and conserves provider/year money without synthetic assets', async () => {
    const config: LocalConfiguration = {
      ...defaults(),
      charges: { claude: 30000, codex: 20000 },
      monthlyCharges: [
        { provider: 'claude', month: '2025-04', amountJpy: 120000 },
        { provider: 'claude', month: '2026-04', amountJpy: 30001 },
      ],
      unobservedRatio: 0.1,
    }
    await setCosts(config)
    expect(await json('/api/config')).toEqual(config)
    await assign()
    const data = await json<DashboardData>('/api/dashboard')
    expect(data.meta).toMatchObject({ mappedRate: 100, classifiedRate: 100 })
    expect(
      data.allocations
        .filter((row) => row.provider === 'Claude Code')
        .reduce((sum, row) => sum + row.amount, 0),
    ).toBe(150001)
    expect(
      data.allocations
        .filter((row) => row.provider === 'Codex')
        .reduce((sum, row) => sum + row.amount, 0),
    ).toBe(20000)
    expect(data).not.toHaveProperty('assets')
    expect(data).not.toHaveProperty('boundaries')
    const costs = await json<AnnualCostProjection>('/api/projections?year=2026')
    expect(costs.totals.knownBasisJpy).toBe(50001)
    expect(costs.invariantSatisfied).toBe(true)
    expect((await json<WorkspaceView>('/api/workspace')).diagnosis).not.toHaveProperty('readiness')
  })
  it('uses dated usage to split a single session across a mid-month purpose change', async () => {
    const planning = await assign()
    const key = (await json<DashboardData>('/api/dashboard')).products.find(
      (row) => row.folder === 'Product-A',
    )!.projectKey!
    planning.projectRules = [
      {
        id: 'before',
        projectKey: key,
        effectiveFrom: '2026-04-01',
        effectiveTo: '2026-04-14',
        taxUnitId: 'app',
        classification: 'new-development',
      },
      {
        id: 'after',
        projectKey: key,
        effectiveFrom: '2026-04-15',
        taxUnitId: 'app',
        classification: 'maintenance',
      },
    ]
    expect((await savePlanningFixture(planning, connection())).status).toBe(200)
    await setCosts({
      ...defaults(),
      monthlyCharges: [{ provider: 'claude', month: '2026-04', amountJpy: 100000 }],
      unobservedRatio: 0.1,
    })
    const data = await json<DashboardData>('/api/dashboard')
    const rows = data.allocations.filter(
      (row) =>
        row.provider === 'Claude Code' &&
        row.monthKey === '2026-04' &&
        row.product === '合成アプリ',
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.stage === '新規開発')?.amount).toBe(45000)
    expect(rows.find((row) => row.stage === '保守')?.amount).toBe(45000)
    for (const row of rows) expect(row.taxUnitId).toBe('app')
  })
  it('selects the correct service-period denominator during a plan change', async () => {
    await assign()
    await setCosts({
      ...defaults(),
      chargePeriods: [
        {
          id: 'before',
          provider: 'claude',
          planName: 'Before',
          serviceStartedOn: '2026-04-01',
          serviceEndedOn: '2026-04-14',
          amountJpy: 1400,
        },
        {
          id: 'after',
          provider: 'claude',
          planName: 'After',
          serviceStartedOn: '2026-04-15',
          serviceEndedOn: '2026-05-14',
          amountJpy: 3000,
        },
      ],
    })
    const data = await json<DashboardData>('/api/dashboard')
    const total = (month: string) =>
      data.allocations
        .filter((row) => row.provider === 'Claude Code' && row.monthKey === month)
        .reduce((sum, row) => sum + row.amount, 0)
    expect(total('2026-04')).toBe(3000)
    expect(total('2026-05')).toBe(1400)
  })
  it('retains unknown capture and invoice amounts rather than substituting zero', async () => {
    await setCosts({ ...defaults(), charges: { claude: 1000, codex: 0 }, unobservedRatio: null })
    const data = await json<DashboardData>('/api/dashboard')
    const positive = data.allocations.filter((row) => row.amount > 0)
    expect(positive.length).toBeGreaterThan(0)
    for (const row of positive)
      expect(row).toMatchObject({ product: '配分未算定', usageRate: null })
    const config: LocalConfiguration = {
      ...defaults(),
      monthlyCharges: [
        { provider: 'claude', month: '2026-04', amountJpy: null, unknownAmountReason: '請求待ち' },
      ],
    }
    await setCosts(config)
    const costs = await json<AnnualCostProjection>('/api/projections?year=2026')
    expect(costs.sources.find((row) => row.id === 'ai:monthly:claude:2026-04')).toMatchObject({
      originalAmountJpy: null,
      unknownOriginalAmountReasons: ['請求待ち'],
    })
    expect(costs.totals.unknownBasisIds.length).toBeGreaterThan(0)
    const before = await json<WorkspaceView>('/api/workspace')
    expect(
      (
        await saveConfigurationFixture(
          {
            ...config,
            monthlyCharges: [{ provider: 'claude', month: '2026-04', amountJpy: null }],
          },
          connection(),
        )
      ).status,
    ).toBe(400)
    expect(await json('/api/workspace')).toEqual(before)
  })
  it('keeps unknown defaults separate from an explicit month and rejects duplicate or reversed inputs atomically', async () => {
    const config: LocalConfiguration = {
      ...defaults(),
      charges: { claude: null, codex: 0 },
      unknownChargeReasons: { claude: '確認中' },
    }
    await setCosts(config)
    expect(
      (await saveConfigurationFixture({ ...config, unknownChargeReasons: {} }, connection()))
        .status,
    ).toBe(400)
    await setCosts({
      ...config,
      monthlyCharges: [{ provider: 'claude', month: '2026-04', amountJpy: 1234 }],
    })
    expect(
      (await json<AnnualCostProjection>('/api/projections?year=2026')).sources.find(
        (row) => row.id === 'ai:monthly:claude:2026-04',
      )?.originalAmountJpy,
    ).toBe(1234)
    const before = await json<WorkspaceView>('/api/workspace')
    for (const invalid of [
      {
        ...config,
        monthlyCharges: [
          { provider: 'claude', month: '2026-04', amountJpy: 1 },
          { provider: 'claude', month: '2026-04', amountJpy: 1 },
        ],
      },
      {
        ...config,
        contracts: { claude: { startedOn: '2026-07-01', endedOn: '2026-06-30' }, codex: {} },
      },
    ]) {
      expect((await saveConfigurationFixture(invalid, connection())).status).toBe(400)
      expect(await json('/api/workspace')).toEqual(before)
    }
  })
  it('retains evidence references and explains unavailable source documents', async () => {
    await setCosts({
      ...defaults(),
      chargePeriods: [
        {
          id: 'invoice',
          provider: 'claude',
          planName: '合成契約',
          serviceStartedOn: '2026-04-01',
          serviceEndedOn: '2026-04-30',
          amountJpy: 30001,
          evidenceIds: ['missing-receipt'],
        },
      ],
    })
    const costs = await json<AnnualCostProjection>('/api/projections?year=2026')
    expect(costs.sources.find((row) => row.id === 'ai:charge:invoice')?.evidenceIds).toEqual([
      'missing-receipt',
    ])
    expect(costs.bases.find((row) => row.sourceId === 'ai:charge:invoice')?.warnings).toContain(
      '請求の証拠参照が現在の記録にありません：missing-receipt',
    )
  })
  it('explains excluded sessions as zero allocation instead of charging a different contract', async () => {
    await setCosts({
      ...defaults(),
      charges: { claude: 1000, codex: 1000 },
      contracts: { claude: { startedOn: '2030-01-01' }, codex: { startedOn: '2030-01-01' } },
    })
    const rows = (await json<DashboardData>('/api/dashboard')).allocations
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.amount === 0)).toBe(true)
    expect(rows.some((row) => row.taxCandidate === '契約期間外')).toBe(true)
  })
  it('exports the same saved revision and excludes real paths, native IDs and prompt text', async () => {
    await assign()
    const view = await json<WorkspaceView>('/api/workspace')
    const exported = await json<{ workspaceRevision: number; costs: AnnualCostProjection }>(
      '/api/export?format=json',
    )
    expect(exported.workspaceRevision).toBe(view.revision)
    expect(exported.costs).toEqual(view.dashboard.costProjection)
    const bodies = [
      JSON.stringify(view.dashboard),
      JSON.stringify(exported),
      JSON.stringify(await json('/api/folders')),
      JSON.stringify(await json('/api/diagnosis')),
    ]
    const markdown = await fetch(origin() + '/api/export?format=markdown')
    expect(markdown.status).toBe(200)
    bodies.push(await markdown.text())
    let found = 0
    for (const product of view.dashboard.products) {
      const result = await json<{ sessions: Array<{ sessionKey: string; provider: string }> }>(
        '/api/sessions?projectKey=' + encodeURIComponent(product.projectKey!),
      )
      found += result.sessions.length
      bodies.push(JSON.stringify(result))
      for (const session of result.sessions) {
        expect(
          await json(
            `/api/sessions/detail?provider=${session.provider}&sessionKey=${session.sessionKey}`,
          ),
        ).toMatchObject({ available: true, transcriptExists: true })
      }
    }
    expect(found).toBeGreaterThan(0)
    for (const body of bodies)
      for (const marker of [root, root.replaceAll('\\', '/'), rawSession, prompt])
        expect(body).not.toContain(marker)
    expect(readFileSync(join(root, 'data', 'devtax-radar.db'), 'utf8')).not.toContain(prompt)
  })
  it('keeps deleted Codex numerical usage but never offers a missing transcript resume command', async () => {
    const dashboard = await json<DashboardData>('/api/dashboard')
    const project = dashboard.products.find((row) => row.providers?.includes('Codex'))!
    const before = await json<{ sessions: Array<{ sessionKey: string; provider: string }> }>(
      '/api/sessions?projectKey=' + encodeURIComponent(project.projectKey!),
    )
    const session = before.sessions[0]!
    const detailUrl = `/api/sessions/detail?provider=codex&sessionKey=${session.sessionKey}`
    expect(await json(detailUrl)).toMatchObject({ available: true, transcriptExists: true })
    rmSync(join(root, '.codex', 'sessions', 'synthetic.jsonl'))
    expect((await post('/api/scan', { providers: ['codex'] })).status).toBe(200)
    expect(
      await json('/api/sessions?projectKey=' + encodeURIComponent(project.projectKey!)),
    ).toEqual(before)
    const detail = await json<Record<string, unknown>>(detailUrl)
    expect(detail).toMatchObject({ available: true, transcriptExists: false })
    expect(detail).not.toHaveProperty('preview')
    expect(detail).not.toHaveProperty('resume')
  })
  it('backs up retention settings only after an explicit request', async () => {
    const response = await post('/api/retention', { days: 365 })
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      backupFileName: string
      days: number
      previousDays: number
    }
    expect(result).toMatchObject({ days: 365, previousDays: 30 })
    expect(result.backupFileName).not.toMatch(/[\\/]/)
    expect(JSON.parse(readFileSync(join(root, result.backupFileName), 'utf8'))).toEqual({
      cleanupPeriodDays: 30,
      unrelated: true,
    })
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toEqual({
      cleanupPeriodDays: 365,
      unrelated: true,
    })
    expect((await post('/api/retention', { days: 0 })).status).toBe(400)
  })
  it('serves the built application when a build exists', async () => {
    if (!existsSync(resolve('dist/index.html'))) return
    const response = await fetch(origin() + '/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<div id="root">')
  })
})
