import type { AnnualCostProjection } from '../../src/accounting/costs.js'
import { saveWorkspaceFixture, savePlanningFixture, saveRulesFixture } from './helpers/workspace-fixture.js'

const children: ChildProcess[] = []

// __UNTOUCHED_FILE_CONTENT__
describe('planning HTTP API', () => {
  it('rejects all retired unversioned writers without changing the saved workspace', async () => {
    const config = await startServer()
    expect((await savePlanningFixture(snapshot(), config)).status).toBe(200)
    const before = (await getJson('/api/workspace', config)) as WorkspaceView
    for (const [url, method, body] of [
      ['/api/planning', 'PUT', before.planning],
      ['/api/planning/rules', 'PUT', { rules: [] }],
      ['/api/config', 'POST', before.configuration],
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${config.port}${url}`, {
        method,
        headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${config.port}`, 'x-devtax-csrf': config.csrfToken },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(404)
      expect(await getJson('/api/workspace', config)).toEqual(before)
    }
  })

  it('persists multiple home allocations and rejects missing or excessive targets atomically', async () => {

// __UNTOUCHED_FILE_CONTENT__
    ]
    expect((await savePlanningFixture(planning, config)).status).toBe(200)
    const saved = (await getJson('/api/planning', config)) as PlanningSnapshot
    expect(saved.homeCosts).toEqual(planning.homeCosts)

// __UNTOUCHED_FILE_CONTENT__
      planning.homeCosts[0]!.targets = targets
      expect((await savePlanningFixture(planning, config)).status).toBe(400)
      expect(await getJson('/api/workspace', config)).toEqual(before)

// __UNTOUCHED_FILE_CONTENT__
    ]
    expect((await savePlanningFixture(planning, server)).status).toBe(200)
    const costs = (await getJson('/api/projections?year=2026', server)) as AnnualCostProjection

// __UNTOUCHED_FILE_CONTENT__
    planning.directCosts[0]!.amountJpy = 1000
    expect((await savePlanningFixture(planning, server)).status).toBe(200)
    const changed = (await getJson('/api/balances/preview?year=2026', server)) as BalancePreview

// __UNTOUCHED_FILE_CONTENT__
    }
    const annualSaved = await savePlanningFixture(annualPlanning, server)
    expect(annualSaved.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    excessive.equipmentMethods![0]!.allocation!.targets![0]!.shareBps = 6000
    expect((await savePlanningFixture(excessive, server)).status).toBe(400)
    const missingTarget = structuredClone(annualPlanning)
    missingTarget.equipmentMethods![0]!.allocation!.targets![0]!.taxUnitId = 'missing'
    expect((await savePlanningFixture(missingTarget, server)).status).toBe(400)
    expect(((await getJson('/api/workspace', server)) as WorkspaceView).revision).toBe(

// __UNTOUCHED_FILE_CONTENT__
    badDate.equipment[0]!.acquiredOn = '2026-02-30'
    expect((await savePlanningFixture(badDate, server)).status).toBe(400)
    expect(

// __UNTOUCHED_FILE_CONTENT__
  it('backs up an existing product database before adding balance tables and retains planning records', async () => {
    let server = await startServer()
    expect((await savePlanningFixture(snapshot(), server)).status).toBe(200)
    const running = children.at(-1)!

// __UNTOUCHED_FILE_CONTENT__
  it('exposes restored-data hold and rejects manual scans without changing saved planning', async () => {
    const server = await startServer()
    expect((await savePlanningFixture(snapshot(), server)).status).toBe(200)
    writeFileSync(

// __UNTOUCHED_FILE_CONTENT__
    ]
    expect((await savePlanningFixture(initial, server)).status).toBe(200)
    const running = children.at(-1)!

// __UNTOUCHED_FILE_CONTENT__
  it('saves chosen record merges against the latest revision and rejects a merged dangling reference atomically', async () => {
    const config = await startServer()
    expect((await savePlanningFixture(snapshot(), config)).status).toBe(200)
    const base = (await getJson('/api/workspace', config)) as WorkspaceView

// __UNTOUCHED_FILE_CONTENT__
    expect(await getJson('/api/workspace', config)).toEqual(saved)
    // Two ordinary versioned saves must still invalidate an earlier ABA request.
    expect((await savePlanningFixture(before.planning, config)).status).toBe(200)
    expect((await savePlanningFixture(saved.planning, config)).status).toBe(200)
    expect((await put('/api/workspace', request, config)).status).toBe(409)

// __UNTOUCHED_FILE_CONTENT__
    ]
    expect((await savePlanningFixture(planning, config)).status).toBe(200)
    const saved = await saveWorkspaceFixture(config, {
      configuration: {
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
      },
    })
    expect(saved.status).toBe(200)

// __UNTOUCHED_FILE_CONTENT__
    const planning = snapshot()

    const missingCsrf = await saveWorkspaceFixture({ port: testPort }, { planning })
    expect(missingCsrf.status).toBe(403)

    const invalid = await saveWorkspaceFixture(
      { port: testPort, csrfToken },
      { planning: { ...planning, version: 2 } },
    )
    expect(invalid.status).toBe(400)

    const saved = await saveWorkspaceFixture({ port: testPort, csrfToken }, { planning })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ planning })

    const restored = await fetch(`http://127.0.0.1:${testPort}/api/planning`).then(

// __UNTOUCHED_FILE_CONTENT__
  it('ルールだけを置き換えられる', async () => {
    const config = await startServer()
    await savePlanningFixture(
      {
        ...emptyPlanningSnapshot(2026),

// __UNTOUCHED_FILE_CONTENT__
    const response = await saveRulesFixture(
      {
        rules: [
          {
            id: 'rule-api-1',

// __UNTOUCHED_FILE_CONTENT__
    const response = await saveRulesFixture(
      {
        rules: [
          {
            id: 'rule-api-orphan',

// __UNTOUCHED_FILE_CONTENT__
    const response = await saveRulesFixture(
      {
        rules: [
          {
            id: 'rule-api-dup',

// __UNTOUCHED_FILE_CONTENT__
    const { csrfToken } = await runtime(testPort)

    const response = await saveWorkspaceFixture({ port: testPort, csrfToken }, {
      configuration: {
        charges: { claude: 30000, codex: 20000 },
        monthlyCharges: [],
        contracts: { claude: {}, codex: {} },
        chargePeriods: [],
        unobservedRatio: 0.1,
        mappings: [
          {
            projectKey: 'project_should_be_rejected',
            productName: 'x',
            assetName: 'y',
            classification: 'private',
          },
        ],
      },
    })
    expect(response.status).toBe(400)
