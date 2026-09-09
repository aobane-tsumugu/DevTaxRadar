import type { AnnualCostProjection } from '../../src/accounting/costs.js'

const children: ChildProcess[] = []

// __UNTOUCHED_FILE_CONTENT__
describe('planning HTTP API', () => {
  it('persists multiple home allocations and rejects missing or excessive targets atomically', async () => {

// __UNTOUCHED_FILE_CONTENT__
    ]
    expect((await put('/api/planning', planning, config)).status).toBe(200)
    const saved = (await getJson('/api/planning', config)) as PlanningSnapshot
    expect(saved.homeCosts).toEqual(planning.homeCosts)

// __UNTOUCHED_FILE_CONTENT__
      planning.homeCosts[0]!.targets = targets
      expect((await put('/api/planning', planning, config)).status).toBe(400)
      expect(await getJson('/api/workspace', config)).toEqual(before)

// __UNTOUCHED_FILE_CONTENT__
    ]
    expect((await put('/api/planning', planning, server)).status).toBe(200)
    const costs = (await getJson('/api/projections?year=2026', server)) as AnnualCostProjection

// __UNTOUCHED_FILE_CONTENT__
    planning.directCosts[0]!.amountJpy = 1000
    expect((await put('/api/planning', planning, server)).status).toBe(200)
    const changed = (await getJson('/api/balances/preview?year=2026', server)) as BalancePreview

// __UNTOUCHED_FILE_CONTENT__
    }
    const annualSaved = await put('/api/planning', annualPlanning, server)
    expect(annualSaved.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    excessive.equipmentMethods![0]!.allocation!.targets![0]!.shareBps = 6000
    expect((await put('/api/planning', excessive, server)).status).toBe(400)
    const missingTarget = structuredClone(annualPlanning)
    missingTarget.equipmentMethods![0]!.allocation!.targets![0]!.taxUnitId = 'missing'
    expect((await put('/api/planning', missingTarget, server)).status).toBe(400)
    expect(((await getJson('/api/workspace', server)) as WorkspaceView).revision).toBe(

// __UNTOUCHED_FILE_CONTENT__
    badDate.equipment[0]!.acquiredOn = '2026-02-30'
    expect((await put('/api/planning', badDate, server)).status).toBe(400)
    expect(

// __UNTOUCHED_FILE_CONTENT__
  it('backs up an existing product database before adding balance tables and retains planning records', async () => {
    let server = await startServer()
    expect((await put('/api/planning', snapshot(), server)).status).toBe(200)
    const running = children.at(-1)!

// __UNTOUCHED_FILE_CONTENT__
  it('exposes restored-data hold and rejects manual scans without changing saved planning', async () => {
    const server = await startServer()
    expect((await put('/api/planning', snapshot(), server)).status).toBe(200)
    writeFileSync(

// __UNTOUCHED_FILE_CONTENT__
    ]
    expect((await put('/api/planning', initial, server)).status).toBe(200)
    const running = children.at(-1)!

// __UNTOUCHED_FILE_CONTENT__
  it('saves chosen record merges against the latest revision and rejects a merged dangling reference atomically', async () => {
    const config = await startServer()
    expect((await put('/api/planning', snapshot(), config)).status).toBe(200)
    const base = (await getJson('/api/workspace', config)) as WorkspaceView

// __UNTOUCHED_FILE_CONTENT__
    expect(await getJson('/api/workspace', config)).toEqual(saved)
    // The legacy route also advances the shared revision, including an ABA edit.
    expect((await put('/api/planning', before.planning, config)).status).toBe(200)
    expect((await put('/api/planning', saved.planning, config)).status).toBe(200)
    expect((await put('/api/workspace', request, config)).status).toBe(409)

// __UNTOUCHED_FILE_CONTENT__
    ]
    expect((await put('/api/planning', planning, config)).status).toBe(200)
    const saved = await fetch(`http://127.0.0.1:${config.port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${config.port}`,
        'x-devtax-csrf': config.csrfToken,
      },
      body: JSON.stringify({
        charges: { claude: 0, codex: 0 },
        monthlyCharges: [],
        contracts: { claude: {}, codex: {} },
        unobservedRatio: null,
        chargePeriods: [
          {
            id: 'annual-ai',
            provider: 'claude',
            planName: '合成契約',
            serviceStartedOn: '2025-12-01',
            serviceEndedOn: '2026-01-31',
            amountJpy: 6200,
          },
        ],
      }),
    })
    expect(saved.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
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

// __UNTOUCHED_FILE_CONTENT__
  it('ルールだけを置き換えられる', async () => {
    const config = await startServer()
    await put(
      '/api/planning',
      {
        ...emptyPlanningSnapshot(2026),

// __UNTOUCHED_FILE_CONTENT__
    )

    const response = await put(
      '/api/planning/rules',
      {
        rules: [
          {
            id: 'rule-api-1',

// __UNTOUCHED_FILE_CONTENT__
    const config = await startServer()
    const response = await put(
      '/api/planning/rules',
      {
        rules: [
          {
            id: 'rule-api-orphan',

// __UNTOUCHED_FILE_CONTENT__
    const config = await startServer()
    const response = await put(
      '/api/planning/rules',
      {
        rules: [
          {
            id: 'rule-api-dup',

// __UNTOUCHED_FILE_CONTENT__
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
