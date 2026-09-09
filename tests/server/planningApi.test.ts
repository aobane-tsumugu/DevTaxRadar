import { adoptBalanceReview, previewBalanceReview } from '../../src/server/balanceRepository.js'
import { readReviewMaterials } from '../../src/server/reviewMaterials.js'
import type { ReviewComparison } from '../../src/core/reviewComparison.js'
import type { BalanceDraft, BalancePreview } from '../../src/server/balanceRepository.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  WorkspaceView,
  WorkspaceImpact,
  WorkspacePreviewInput,
} from '../../src/planning/workspace.js'
import { mergeWorkspaceDrafts } from '../../src/core/workspaceMerge.js'
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import type { AnnualCostProjection } from '../../src/accounting/costs.js'

const children: ChildProcess[] = []
const directories: string[] = []

function equipmentFixture(amount: number | null): PlanningSnapshot['equipment'][number] {
  return {
    id: 'equipment-roundtrip',
    name: '合成PC',
    equipmentType: 'pc',
    acquisitionCostJpy: amount,
    ...(amount === null ? { unknownAmountReason: '領収書の確認待ち' } : {}),
    acquiredOn: '2026-01-01',
    businessUseStartedOn: '2026-02-01',
    convertedFromPrivate: true,
    openingUnamortizedBalanceJpy: 120000,
    businessUseRatio: 0.8,
    usefulLifeYears: 4,
    role: '開発環境',
    taxUnitId: 'unit-api-test',
    projectAllocationRatio: 0.6,
    evidenceIds: [],
  }
}

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

async function startServer(existingData?: string): Promise<{
  port: number
  csrfToken: string
  data: string
}> {
  const testPort = await port()
  const data = existingData ?? mkdtempSync(join(tmpdir(), 'devtax-planning-api-'))
  if (!existingData) directories.push(data)
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
    cwd: resolve('.'),
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(testPort),
      DEVTAX_RADAR_DATA_DIR: data,
      USERPROFILE: data,
      HOME: data,
      DEVTAX_RADAR_CLAUDE_SETTINGS: join(data, 'claude-settings.json'),
    },
  })
  children.push(child)
  const { csrfToken } = await runtime(testPort)
  return { port: testPort, csrfToken, data }
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

async function preview(input: WorkspacePreviewInput, config: { port: number; csrfToken: string }) {
  return fetch(`http://127.0.0.1:${config.port}/api/workspace/preview`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${config.port}`,
      'x-devtax-csrf': config.csrfToken,
    },
    body: JSON.stringify(input),
  })
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
  it('persists multiple home allocations and rejects missing or excessive targets atomically', async () => {
    const config = await startServer()
    const planning = emptyPlanningSnapshot(2026)
    planning.taxUnits = ['u', 'v'].map((id) => ({
      id,
      name: id,
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'efficiency',
      lifecycleStatus: 'developing',
    }))
    planning.homeCosts = [
      {
        id: 'h',
        month: '2026-07',
        category: 'rent',
        amountJpy: 4000,
        method: 'area',
        businessUseRatio: 0.5,
        basis: '面積',
        rationale: '使用実態',
        projectAllocationRatio: 0,
        treatment: 'shared',
        evidenceIds: [],
        targets: [
          { taxUnitId: 'u', shareBps: 2500 },
          { taxUnitId: 'v', shareBps: null },
        ],
      },
    ]
    expect((await put('/api/planning', planning, config)).status).toBe(200)
    const saved = (await getJson('/api/planning', config)) as PlanningSnapshot
    expect(saved.homeCosts).toEqual(planning.homeCosts)
    const before = await getJson('/api/workspace', config)
    for (const targets of [
      [{ taxUnitId: 'missing', shareBps: 100 }],
      [
        { taxUnitId: 'u', shareBps: 6000 },
        { taxUnitId: 'v', shareBps: 5000 },
      ],
    ]) {
      planning.homeCosts[0]!.targets = targets
      expect((await put('/api/planning', planning, config)).status).toBe(400)
      expect(await getJson('/api/workspace', config)).toEqual(before)
    }
  })

  it('adopts and corrects source-bound year records through CSRF-protected preview confirmation and idempotent retries', async () => {
    const server = await startServer()
    const endpoint = 'http://127.0.0.1:' + server.port + '/api/balances/reviews'
    const preview = (await getJson('/api/balances/preview?year=2026', server)) as BalancePreview
    const input = {
      year: 2026,
      expectedDraftRevision: preview.draftRevision,
      projectionHash: preview.projectionHash,
      idempotencyKey: randomUUID(),
      reason: '未登録・未算定を含む確認時点の記録',
    }
    const send = (body: unknown, csrf = true) =>
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-DevTax-CSRF': server.csrfToken } : {}),
        },
        body: JSON.stringify(body),
      })
    expect((await send(input, false)).status).toBe(403)
    expect((await send({ ...input, reason: ' ' })).status).toBe(400)
    expect((await send({ ...input, materials: preview.materials })).status).toBe(400)
    expect((await send({ ...input, expectedDatasetId: randomUUID() })).status).toBe(409)
    const runtime = (await getJson('/api/runtime', server)) as { datasetId: string }
    const response = await send(input)
    expect(response.status).toBe(200)
    const first = (await response.json()) as {
      review: { id: string; correctsReviewId: string | null; materials: unknown }
    }
    expect(first.review.materials).toEqual(preview.materials)
    expect(first.review.correctsReviewId).toBeNull()
    expect(await (await send(input)).json()).toEqual(first)
    expect(await (await send({ ...input, expectedDatasetId: runtime.datasetId })).json()).toEqual(
      first,
    )
    expect((await send({ ...input, reason: '同じキーで異なる理由' })).status).toBe(409)
    expect((await send({ ...input, idempotencyKey: randomUUID() })).status).toBe(409)
    const nextPreview = (await getJson('/api/balances/preview?year=2026', server)) as BalancePreview
    const correctedResponse = await send({
      ...input,
      projectionHash: nextPreview.projectionHash,
      idempotencyKey: randomUUID(),
      reason: '訂正として確認し直した理由',
    })
    expect(correctedResponse.status).toBe(200)
    const corrected = (await correctedResponse.json()) as {
      review: { id: string; correctsReviewId: string }
    }
    expect(corrected.review.correctsReviewId).toBe(first.review.id)
    expect(corrected.review.id).not.toBe(first.review.id)
    expect(await (await send(input)).json()).toEqual(first)
    expect(await getJson('/api/balances/reviews/' + first.review.id, server)).toMatchObject(first)
    const listed = (await getJson('/api/balances/reviews', server)) as {
      reviews: Array<{ id: string; active: boolean }>
    }
    expect(listed.reviews.find((row) => row.id === first.review.id)!.active).toBe(false)
    expect(listed.reviews.find((row) => row.id === corrected.review.id)!.active).toBe(true)
  })
  it('persists explicit cost links, rejects cross-record overuse at adoption, and freezes the checked allocation', async () => {
    const server = await startServer()
    const planning = snapshot()
    planning.decisions = [
      {
        id: 'cost-decision',
        taxUnitId: 'unit-api-test',
        taxYear: 2026,
        engineVersion: 'manual-decision/1',
        candidate: '合成',
        selectedCandidate: '合成',
        status: 'confirmed',
        createdAt: '2026-01-01T00:00:00Z',
        confirmedAt: '2026-01-02T00:00:00Z',
        reason: '合成根拠',
      },
    ]
    expect((await put('/api/planning', planning, server)).status).toBe(200)
    const costs = (await getJson('/api/projections?year=2026', server)) as AnnualCostProjection
    const contribution = costs.contributions.find(
      (row) => row.sourceIds.includes('direct:direct-api-test') && row.target.kind === 'tax-unit',
    )!
    expect(contribution.amountJpy).toBe(2000)
    const balanceInput: BalanceDraft['snapshot'] = {
      version: 1,
      accounts: [
        {
          id: 'cost-account',
          taxUnitId: 'unit-api-test',
          name: '合成残高',
          kind: 'construction',
          openingYear: 2026,
          opening: { status: 'known', amountJpy: 0 },
        },
      ],
      pendingDecisions: [],
      movements: [
        {
          id: 'claim',
          kind: 'addition',
          accountId: 'cost-account',
          occurredOn: '2026-07-01',
          amountJpy: 1500,
          sourceIds: ['direct:direct-api-test'],
          decisionId: 'cost-decision',
          reason: '合成',
          costAllocations: [{ costYear: 2026, contributionId: contribution.id, amountJpy: 1500 }],
        },
      ],
    }
    expect(
      (await put('/api/balances/draft', { expectedRevision: 0, snapshot: balanceInput }, server))
        .status,
    ).toBe(200)
    expect(
      ((await getJson('/api/balances/draft', server)) as BalanceDraft).snapshot.movements,
    ).toEqual(balanceInput.movements)
    balanceInput.movements.push({ ...balanceInput.movements[0]!, id: 'duplicate' })
    expect(
      (await put('/api/balances/draft', { expectedRevision: 1, snapshot: balanceInput }, server))
        .status,
    ).toBe(200)
    const preview = (await getJson('/api/balances/preview?year=2026', server)) as BalancePreview
    expect(preview.materials!.costLinks!.check.status).toBe('invalid')
    const adopt = (p: BalancePreview) =>
      fetch('http://127.0.0.1:' + server.port + '/api/balances/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DevTax-CSRF': server.csrfToken },
        body: JSON.stringify({
          year: 2026,
          expectedDraftRevision: p.draftRevision,
          projectionHash: p.projectionHash,
          idempotencyKey: randomUUID(),
          reason: '合成確認',
        }),
      })
    expect((await adopt(preview)).status).toBe(400)
    balanceInput.movements.pop()
    expect(
      (await put('/api/balances/draft', { expectedRevision: 2, snapshot: balanceInput }, server))
        .status,
    ).toBe(200)
    const corrected = (await getJson('/api/balances/preview?year=2026', server)) as BalancePreview
    expect(corrected.materials!.costLinks!.check).toMatchObject({
      status: 'consistent',
      contributions: [{ claimedJpy: 1500, remainingJpy: 500 }],
    })
    const response = await adopt(corrected)
    expect(response.status).toBe(200)
    const adopted = (await response.json()) as { review: { id: string } }
    planning.directCosts[0]!.amountJpy = 1000
    expect((await put('/api/planning', planning, server)).status).toBe(200)
    const changed = (await getJson('/api/balances/preview?year=2026', server)) as BalancePreview
    expect(changed.materials!.costLinks!.check.status).toBe('invalid')
    const fixed = (await getJson('/api/balances/reviews/' + adopted.review.id, server)) as {
      review: { materials: unknown }
    }
    expect(fixed.review.materials).toEqual(corrected.materials)
    const markdown = await fetch(
      'http://127.0.0.1:' +
        server.port +
        '/api/balances/reviews/' +
        adopted.review.id +
        '/export?format=markdown',
    )
    expect(await markdown.text()).toContain(
      '費用配分との対応: 2026年 / ' + contribution.id + ' / 1500円',
    )
  })
  it('saves equipment methods together with equipment and projects the annual basis through HTTP', async () => {
    const server = await startServer()
    const initial = (await getJson('/api/workspace', server)) as WorkspaceView
    const planning = snapshot()
    planning.equipment = [
      {
        id: 'pc',
        name: 'PC',
        equipmentType: 'pc',
        acquisitionCostJpy: 240000,
        acquiredOn: '2026-01-01',
        businessUseStartedOn: '2026-07-31',
        convertedFromPrivate: false,
        businessUseRatio: 0.5,
        projectAllocationRatio: 0.6,
        taxUnitId: 'unit-api-test',
        evidenceIds: [],
        role: '制作',
      },
    ]
    planning.equipmentMethods = [
      {
        id: 'method',
        equipmentId: 'pc',
        taxYear: 2026,
        taxpayer: 'individual',
        assetKind: 'tangible-equipment',
        method: 'straight-line',
        methodReason: '設備区分と方法の確認',
        usefulLifeYears: 4,
        useThroughYearEnd: 'confirmed',
        ordinaryTreatment: 'confirmed',
        priorClosing: null,
        recordedAt: '2026-09-08T00:00:00Z',
      },
    ]
    const response = await put(
      '/api/workspace',
      {
        configuration: initial.configuration,
        planning,
        expectedRevision: initial.revision,
        requestId: randomUUID(),
      },
      server,
    )
    expect(response.status).toBe(200)
    const saved = (await response.json()) as WorkspaceView
    expect(saved.planning.equipmentMethods).toEqual(planning.equipmentMethods)
    expect(
      ((await getJson('/api/workspace', server)) as WorkspaceView).planning.equipmentMethods,
    ).toEqual(planning.equipmentMethods)
    const projection = await getJson('/api/projections?year=2026', server)
    expect(JSON.stringify(projection)).toContain('普通償却額 30000円')
    const annualPlanning = structuredClone(planning)
    annualPlanning.taxUnits.push({
      ...annualPlanning.taxUnits[0]!,
      id: 'second-target',
      name: '別制作物',
    })
    annualPlanning.equipmentMethods![0]!.allocation = {
      taxUnitId: 'unit-api-test',
      businessUseRatio: 0.8,
      projectAllocationRatio: 0.25,
      reason: '年度別の利用資料',
      targets: [
        { taxUnitId: 'unit-api-test', shareBps: 2500 },
        { taxUnitId: 'second-target', shareBps: 5000 },
      ],
    }
    const annualSaved = await put('/api/planning', annualPlanning, server)
    expect(annualSaved.status).toBe(200)
    const annualRead = (await getJson('/api/workspace', server)) as WorkspaceView
    expect(annualRead.planning.equipmentMethods![0]!.allocation).toEqual(
      annualPlanning.equipmentMethods![0]!.allocation,
    )
    // Continue the rejection checks from the latest accepted revision.
    saved.revision = annualRead.revision
    const excessive = structuredClone(annualPlanning)
    excessive.equipmentMethods![0]!.allocation!.targets![0]!.shareBps = 6000
    expect((await put('/api/planning', excessive, server)).status).toBe(400)
    const missingTarget = structuredClone(annualPlanning)
    missingTarget.equipmentMethods![0]!.allocation!.targets![0]!.taxUnitId = 'missing'
    expect((await put('/api/planning', missingTarget, server)).status).toBe(400)
    expect(((await getJson('/api/workspace', server)) as WorkspaceView).revision).toBe(
      saved.revision,
    )
    const badDate = structuredClone(planning)
    badDate.equipment[0]!.acquiredOn = '2026-02-30'
    expect((await put('/api/planning', badDate, server)).status).toBe(400)
    expect(
      (
        await put(
          '/api/workspace',
          {
            configuration: initial.configuration,
            planning: badDate,
            expectedRevision: saved.revision,
            requestId: randomUUID(),
          },
          server,
        )
      ).status,
    ).toBe(400)
    const afterBadDate = (await getJson('/api/workspace', server)) as WorkspaceView
    expect(afterBadDate.revision).toBe(saved.revision)
    expect(afterBadDate.planning.equipment).toEqual(saved.planning.equipment)
    const invalid = structuredClone(planning)
    invalid.equipment = []
    const rejected = await put(
      '/api/workspace',
      {
        configuration: initial.configuration,
        planning: invalid,
        expectedRevision: saved.revision,
        requestId: randomUUID(),
      },
      server,
    )
    expect(rejected.status).toBe(400)
    expect(((await getJson('/api/workspace', server)) as WorkspaceView).revision).toBe(
      saved.revision,
    )
  })

  it('round-trips annual presence declarations with workspace revisions and rejects conflicting declarations without saving', async () => {
    const server = await startServer()
    const initial = (await getJson('/api/workspace', server)) as WorkspaceView
    const planning = snapshot()
    planning.costPresence = [
      {
        id: 'api-presence',
        taxYear: 2026,
        category: 'home',
        status: 'deferred',
        reason: '請求を照合中',
        recordedAt: '2026-09-08T00:00:00Z',
      },
    ]
    const response = await put(
      '/api/workspace',
      {
        configuration: initial.configuration,
        planning,
        expectedRevision: initial.revision,
        requestId: randomUUID(),
      },
      server,
    )
    expect(response.status).toBe(200)
    const saved = (await response.json()) as WorkspaceView
    expect(saved.revision).toBeGreaterThan(initial.revision)
    expect(saved.planning.costPresence).toEqual(planning.costPresence)
    expect(
      ((await getJson('/api/workspace', server)) as WorkspaceView).planning.costPresence,
    ).toEqual(planning.costPresence)
    planning.costPresence.push({ ...planning.costPresence[0]!, id: 'duplicate' })
    const rejected = await put(
      '/api/workspace',
      {
        configuration: initial.configuration,
        planning,
        expectedRevision: saved.revision,
        requestId: randomUUID(),
      },
      server,
    )
    expect(rejected.status).toBe(400)
    expect(((await getJson('/api/workspace', server)) as WorkspaceView).revision).toBe(
      saved.revision,
    )
  })

  it('saves manually confirmed decisions with their reason and rejects incomplete confirmation without changing the workspace', async () => {
    const server = await startServer()
    const initial = (await getJson('/api/workspace', server)) as WorkspaceView
    const planning = snapshot()
    planning.decisions = [
      {
        id: 'manual',
        taxUnitId: 'unit-api-test',
        taxYear: 2026,
        engineVersion: 'manual-decision/1',
        candidate: '合成の候補',
        selectedCandidate: '合成の扱い',
        status: 'confirmed',
        createdAt: '2026-01-01T00:00:00Z',
        confirmedAt: '2026-01-02T00:00:00Z',
        reason: '合成の確認先と根拠',
      },
    ]
    const response = await put(
      '/api/workspace',
      {
        configuration: initial.configuration,
        planning,
        expectedRevision: initial.revision,
        requestId: randomUUID(),
      },
      server,
    )
    expect(response.status).toBe(200)
    const saved = (await response.json()) as WorkspaceView
    expect(saved.planning.decisions).toEqual(planning.decisions)
    const balanceResponse = await put(
      '/api/balances/draft',
      {
        expectedRevision: 0,
        snapshot: {
          version: 1,
          accounts: [
            {
              id: 'a',
              name: '合成の制作中原価',
              taxUnitId: 'unit-api-test',
              kind: 'construction',
              openingYear: 2026,
              opening: { status: 'known', amountJpy: 0 },
            },
          ],
          movements: [
            {
              id: 'm',
              kind: 'addition',
              accountId: 'a',
              occurredOn: '2026-07-01',
              amountJpy: 2000,
              sourceIds: ['direct:direct-api-test'],
              decisionId: 'manual',
              reason: '合成の原価記録',
            },
          ],
          pendingDecisions: [],
        },
      },
      server,
    )
    expect(balanceResponse.status).toBe(200)
    const confirmedBalance = (await getJson('/api/balances/draft', server)) as BalanceDraft
    expect(confirmedBalance.referenceCheck).toMatchObject({
      status: 'consistent',
      workspaceRevision: saved.revision,
      issues: [],
    })
    const confirmedPreview = (await getJson(
      '/api/balances/preview?year=2026',
      server,
    )) as BalancePreview
    expect(confirmedPreview.materials).toMatchObject({
      year: 2026,
      workspaceRevision: saved.revision,
      taxTreatmentVerified: false,
      planning: { decisions: planning.decisions },
      costs: { totals: { taxUnitJpy: 2000 } },
    })
    const materialDb = new DatabaseSync(join(server.data, 'devtax-radar.db'))
    let materialReviewId: string
    try {
      const review = adoptBalanceReview(
        materialDb,
        {
          year: 2026,
          expectedDraftRevision: confirmedBalance.revision,
          projectionHash: confirmedPreview.projectionHash,
          idempotencyKey: randomUUID(),
          reason: '合成の同版保存試験',
        },
        readReviewMaterials,
      )
      materialReviewId = review.id
      expect(review.materials).toEqual(confirmedPreview.materials)
    } finally {
      materialDb.close()
    }
    const invalid = structuredClone(planning)
    delete invalid.decisions[0]!.reason
    expect(
      (
        await put(
          '/api/workspace',
          {
            configuration: initial.configuration,
            planning: invalid,
            expectedRevision: saved.revision,
            requestId: randomUUID(),
          },
          server,
        )
      ).status,
    ).toBe(400)
    expect(((await getJson('/api/workspace', server)) as WorkspaceView).revision).toBe(
      saved.revision,
    )
    invalid.decisions[0]!.status = 'pending'
    delete invalid.decisions[0]!.confirmedAt
    expect(
      (
        await put(
          '/api/workspace',
          {
            configuration: initial.configuration,
            planning: invalid,
            expectedRevision: saved.revision,
            requestId: randomUUID(),
          },
          server,
        )
      ).status,
    ).toBe(200)
    const reopenedBalance = (await getJson('/api/balances/draft', server)) as BalanceDraft
    expect(reopenedBalance.revision).toBe(confirmedBalance.revision)
    expect(reopenedBalance.snapshot).toEqual(confirmedBalance.snapshot)
    const reopenedWorkspace = (await getJson('/api/workspace', server)) as WorkspaceView
    expect(reopenedWorkspace.revision).toBeGreaterThan(saved.revision)
    expect(reopenedBalance.referenceCheck).toMatchObject({
      status: 'needs-review',
      workspaceRevision: reopenedWorkspace.revision,
    })
    expect(reopenedBalance.referenceCheck!.issues.map((issue) => issue.code)).toEqual([
      'unconfirmed-decision',
    ])
    const reopenedPreview = (await getJson(
      '/api/balances/preview?year=2026',
      server,
    )) as BalancePreview
    expect(reopenedPreview.projectionHash).not.toBe(confirmedPreview.projectionHash)
    const compared = (await getJson(
      '/api/balances/reviews/' + materialReviewId + '/compare',
      server,
    )) as ReviewComparison
    expect(compared).toMatchObject({
      materialCoverage: 'both',
      currentPreviewHash: reopenedPreview.projectionHash,
      currentDraftRevision: reopenedBalance.revision,
      currentWorkspaceRevision: reopenedWorkspace.revision,
    })
    expect(compared.changes).toContainEqual({
      path: ['materials', 'planning', 'decisions', 'manual', 'status'],
      operation: 'changed',
      before: 'confirmed',
      after: 'pending',
    })
    expect(compared.changes.some((change) => change.path[0] === 'balanceResults')).toBe(false)
    expect(((await getJson('/api/balances/draft', server)) as BalanceDraft).revision).toBe(
      reopenedBalance.revision,
    )
    const fixedReview = await getJson('/api/balances/reviews/' + materialReviewId, server)
    expect(fixedReview).toMatchObject({ review: { materials: confirmedPreview.materials } })
    const exportUrl =
      'http://127.0.0.1:' + server.port + '/api/balances/reviews/' + materialReviewId + '/export'
    const jsonResponse = await fetch(exportUrl + '?format=json')
    expect(jsonResponse.status).toBe(200)
    expect(jsonResponse.headers.get('content-type')).toContain('application/json')
    expect(jsonResponse.headers.get('content-disposition')).toContain(materialReviewId + '.json')
    expect(jsonResponse.headers.get('cache-control')).toBe('no-store')
    const exported = (await jsonResponse.json()) as { review: unknown }
    expect(exported.review).toEqual((fixedReview as { review: unknown }).review)
    const markdownResponse = await fetch(exportUrl + '?format=markdown')
    expect(markdownResponse.headers.get('content-type')).toContain('text/markdown')
    const markdown = await markdownResponse.text()
    expect(markdown).toContain('2,000円')
    expect(markdown).toContain('合成の確認先と根拠')
    expect(markdown).toContain('この年度資料に固定した費用基礎と配分')
    expect(markdown).not.toContain('作業中の費用資料です')
    expect((await fetch(exportUrl + '?format=html')).status).toBe(400)
    expect((await fetch(exportUrl + '?format=json&extra=1')).status).toBe(400)
    expect(
      (
        await fetch(
          'http://127.0.0.1:' + server.port + '/api/balances/reviews/' + randomUUID() + '/export',
        )
      ).status,
    ).toBe(404)
  })

  it('persists balance drafts with independent revisions and reads year projections and immutable reviews through guarded HTTP routes', async () => {
    let server = await startServer()
    const base = 'http://127.0.0.1:' + server.port
    const initial = (await getJson('/api/balances/draft', server)) as BalanceDraft
    expect(initial).toMatchObject({
      revision: 0,
      snapshot: { accounts: [], movements: [], pendingDecisions: [] },
      scope: {
        kind: 'recorded-balances',
        costAndDecisionReferencesVerified: false,
        adoptionAvailable: true,
      },
    })
    const workspace = (await getJson('/api/workspace', server)) as WorkspaceView
    const input = {
      expectedRevision: 0,
      snapshot: {
        version: 1,
        accounts: [
          {
            id: 'asset',
            taxUnitId: 'synthetic-unit',
            name: '合成残高',
            kind: 'asset',
            openingYear: 2025,
            opening: { status: 'known', amountJpy: 100 },
          },
          {
            id: 'unknown',
            taxUnitId: 'synthetic-unit',
            name: '確認待ち残高',
            kind: 'construction',
            openingYear: 2025,
            opening: { status: 'unknown', amountJpy: null, reasons: ['前年の記録確認待ち'] },
          },
        ],
        movements: [
          {
            id: 'expense',
            kind: 'expense',
            accountId: 'asset',
            occurredOn: '2025-12-31',
            amountJpy: 10,
            sourceIds: ['synthetic-source'],
            decisionId: 'synthetic-decision',
            reason: '合成の入力',
          },
        ],
        pendingDecisions: [],
      },
    }
    expect(
      (
        await fetch(base + '/api/balances/draft', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403)
    const savedResponse = await put('/api/balances/draft', input, server)
    expect(savedResponse.status).toBe(200)
    const saved = (await savedResponse.json()) as BalanceDraft
    expect(saved.revision).toBe(1)
    const checked = (await getJson('/api/balances/draft', server)) as BalanceDraft
    expect(checked.referenceCheck).toMatchObject({
      workspaceRevision: workspace.revision,
      status: 'needs-review',
    })
    expect(checked.referenceCheck!.issues.map((issue) => issue.code)).toEqual([
      'missing-unit',
      'missing-unit',
      'missing-source',
      'missing-decision',
    ])
    const checkedPreview = (await getJson(
      '/api/balances/preview?year=2025',
      server,
    )) as BalancePreview
    expect(checkedPreview.referenceCheck).toEqual(checked.referenceCheck)
    expect((await put('/api/balances/draft', input, server)).status).toBe(409)
    expect(((await getJson('/api/workspace', server)) as WorkspaceView).revision).toBe(
      workspace.revision,
    )
    const invalid = structuredClone(input)
    invalid.expectedRevision = 1
    invalid.snapshot.movements[0]!.amountJpy = 101
    expect((await put('/api/balances/draft', invalid, server)).status).toBe(400)
    expect(
      (
        await put(
          '/api/balances/draft',
          {
            ...input,
            expectedRevision: 1,
            snapshot: { ...input.snapshot, transcript: 'must reject' },
          },
          server,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await put(
          '/api/balances/draft',
          {
            expectedRevision: 1,
            snapshot: { version: 1, accounts: null, movements: [], pendingDecisions: [] },
          },
          server,
        )
      ).status,
    ).toBe(400)
    const preview = (await getJson('/api/balances/preview?year=2025', server)) as BalancePreview
    expect(preview).toMatchObject({
      draftRevision: 1,
      projection: {
        year: 2025,
        totals: {
          knownOpeningJpy: 100,
          knownClosingJpy: 90,
          expensesJpy: 10,
          unknownAccountIds: ['unknown'],
        },
      },
    })
    const next = (await getJson('/api/balances/preview?year=2026', server)) as BalancePreview
    expect(next.projection.totals).toMatchObject({
      knownOpeningJpy: 90,
      knownClosingJpy: 90,
      expensesJpy: 0,
    })
    expect(((await getJson('/api/balances/draft', server)) as BalanceDraft).revision).toBe(1)
    expect((await fetch(base + '/api/balances/preview?year=1800')).status).toBe(400)
    expect((await fetch(base + '/api/balances/reviews/' + randomUUID())).status).toBe(404)
    // Seed an adopted synthetic record using the existing repository, not a public adoption endpoint.
    const db = new DatabaseSync(join(server.data, 'devtax-radar.db'))
    let reviewId: string
    try {
      const candidate = previewBalanceReview(db, 2025)
      const adopted = adoptBalanceReview(db, {
        year: 2025,
        expectedDraftRevision: 1,
        projectionHash: candidate.projectionHash,
        idempotencyKey: randomUUID(),
        reason: '合成試験の採用版',
      })
      reviewId = adopted.id
      expect(() => db.exec('DELETE FROM balance_reviews')).toThrow()
    } finally {
      db.close()
    }
    const running = children.at(-1)!
    await new Promise<void>((resolveExit) => {
      running.once('exit', () => resolveExit())
      running.kill()
    })
    server = await startServer(server.data)
    expect(await getJson('/api/balances/draft', server)).toMatchObject(saved)
    expect(await getJson('/api/balances/reviews', server)).toMatchObject({
      reviews: [{ id: reviewId, year: 2025, active: true, previousYearChanged: false }],
    })
    expect(await getJson('/api/balances/reviews/' + reviewId, server)).toMatchObject({
      review: { id: reviewId, reason: '合成試験の採用版', projection: preview.projection },
    })
    const nextDb = new DatabaseSync(join(server.data, 'devtax-radar.db'))
    try {
      const candidate = previewBalanceReview(nextDb, 2026)
      adoptBalanceReview(nextDb, {
        year: 2026,
        expectedDraftRevision: 1,
        projectionHash: candidate.projectionHash,
        idempotencyKey: randomUUID(),
        reason: '旧形式の翌年資料',
      })
    } finally {
      nextDb.close()
    }
    const changed = structuredClone(input)
    changed.expectedRevision = 1
    changed.snapshot.movements[0]!.amountJpy = 20
    expect((await put('/api/balances/draft', changed, server)).status).toBe(200)
    const correctionDb = new DatabaseSync(join(server.data, 'devtax-radar.db'))
    try {
      const candidate = previewBalanceReview(correctionDb, 2025)
      adoptBalanceReview(correctionDb, {
        year: 2025,
        expectedDraftRevision: 2,
        projectionHash: candidate.projectionHash,
        idempotencyKey: randomUUID(),
        reason: '旧形式の前年訂正',
      })
    } finally {
      correctionDb.close()
    }
    const impact = (await getJson('/api/balances/impact', server)) as {
      years: Array<ReviewComparison & { priorChainChanged: boolean }>
    }
    expect(impact.years.map((row) => row.year)).toEqual([2025, 2026])
    const later = impact.years[1]!
    expect(later.priorChainChanged).toBe(true)
    expect(later.balanceImpact.find((row) => row.accountId === 'asset')).toMatchObject({
      opening: { deltaJpy: -10 },
      closing: { deltaJpy: -10 },
    })
    expect(
      later.balanceImpact.find((row) => row.accountId === 'unknown')!.closing.deltaJpy,
    ).toBeNull()
    expect(((await getJson('/api/balances/draft', server)) as BalanceDraft).revision).toBe(2)
    expect(await getJson('/api/balances/reviews/' + reviewId, server)).toMatchObject({
      review: { projection: preview.projection },
    })
  })

  it('backs up an existing product database before adding balance tables and retains planning records', async () => {
    let server = await startServer()
    expect((await put('/api/planning', snapshot(), server)).status).toBe(200)
    const running = children.at(-1)!
    await new Promise<void>((resolveExit) => {
      running.once('exit', () => resolveExit())
      running.kill()
    })
    const db = new DatabaseSync(join(server.data, 'devtax-radar.db'))
    try {
      db.exec(
        'DROP TABLE balance_review_heads; DROP TABLE balance_reviews; DROP TABLE balance_draft',
      )
    } finally {
      db.close()
    }
    const before = new Set(readdirSync(server.data))
    server = await startServer(server.data)
    const backups = readdirSync(server.data).filter(
      (name) => !before.has(name) && name.includes('balance-records'),
    )
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(server.data, backups[0]!), { readOnly: true })
    try {
      expect(
        backup.prepare("SELECT name FROM sqlite_master WHERE name='balance_draft'").get(),
      ).toBeUndefined()
      expect(
        backup
          .prepare("SELECT amount_jpy FROM planning_direct_costs WHERE id='direct-api-test'")
          .get(),
      ).toEqual({ amount_jpy: 2000 })
      expect(backup.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    } finally {
      backup.close()
    }
    expect(await getJson('/api/planning', server)).toMatchObject(snapshot())
    expect(await getJson('/api/balances/draft', server)).toMatchObject({ revision: 0 })
  })
  it('exposes restored-data hold and rejects manual scans without changing saved planning', async () => {
    const server = await startServer()
    expect((await put('/api/planning', snapshot(), server)).status).toBe(200)
    writeFileSync(
      join(server.data, 'restore-reconnect-required.json'),
      JSON.stringify({ version: 1 }),
    )
    expect(await getJson('/api/runtime', server)).toMatchObject({ restoreRequiresReconnect: true })
    const base = 'http://127.0.0.1:' + server.port
    const response = await fetch(base + '/api/scan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        'x-devtax-csrf': server.csrfToken,
      },
      body: JSON.stringify({ providers: ['claude'] }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'restore_requires_reconnect' })
    expect(await getJson('/api/planning', server)).toMatchObject(snapshot())
    writeFileSync(join(server.data, 'identifier-salt'), 'a'.repeat(43))
    const view = (await getJson('/api/restore/sources', server)) as {
      plan: { sources: { enabled: boolean }[]; baseHash: string }
    }
    for (const row of view.plan.sources) row.enabled = false
    const reconnect = (body: unknown, token = server.csrfToken) =>
      fetch(base + '/api/restore/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base, 'x-devtax-csrf': token },
        body: JSON.stringify(body),
      })
    expect((await reconnect(view.plan, '')).status).toBe(403)
    expect((await reconnect({ ...view.plan, baseHash: '0'.repeat(64) })).status).toBe(409)
    expect((await reconnect({ ...view.plan, extra: true })).status).toBe(400)
    expect((await reconnect(view.plan)).status).toBe(200)
    expect((await reconnect(view.plan)).status).toBe(200)
    expect(await getJson('/api/runtime', server)).toMatchObject({ restoreRequiresReconnect: false })
    expect(await getJson('/api/planning', server)).toMatchObject(snapshot())
  })
  it('migrates draft receipts with a verified backup and recognizes HTTP retries across restart', async () => {
    let server = await startServer()
    const input = {
      expectedRevision: 0,
      requestId: randomUUID(),
      snapshot: { version: 1, accounts: [], movements: [], pendingDecisions: [] },
    }
    const stop = async () => {
      const running = children.at(-1)!
      await new Promise<void>((resolveExit) => {
        running.once('exit', () => resolveExit())
        running.kill()
      })
    }
    await stop()
    const db = new DatabaseSync(join(server.data, 'devtax-radar.db'))
    db.exec('DROP TABLE balance_draft_receipts')
    db.close()
    server = await startServer(server.data)
    const backups = readdirSync(server.data).filter((name) =>
      name.includes('balance-draft-receipts'),
    )
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(server.data, backups[0]!), { readOnly: true })
    expect(backup.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    expect(
      backup.prepare("SELECT name FROM sqlite_master WHERE name='balance_draft_receipts'").get(),
    ).toBeUndefined()
    backup.close()
    const saved = await put('/api/balances/draft', input, server)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ revision: 1 })
    await stop()
    server = await startServer(server.data)
    const retry = await put('/api/balances/draft', input, server)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ revision: 1 })
    expect(
      (await put('/api/balances/draft', { ...input, expectedRevision: 1 }, server)).status,
    ).toBe(400)
    expect(
      (
        await put(
          '/api/balances/draft',
          { ...input, requestId: randomUUID(), expectedRevision: 1 },
          server,
        )
      ).status,
    ).toBe(200)
    const stale = await put('/api/balances/draft', input, server)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ message: expect.stringContaining('成功済み') })
    expect((await getJson('/api/balances/draft', server)) as BalanceDraft).toMatchObject({
      revision: 2,
    })
  })
  it('preserves unknown dated AI bills across restart, previews every affected year and confirms zero without substituting defaults', async () => {
    let server = await startServer()
    const initial = (await getJson('/api/workspace', server)) as WorkspaceView
    const planning = snapshot()
    planning.directCosts = []
    const charge = {
      id: 'known-ai',
      provider: 'claude' as const,
      planName: '合成契約',
      serviceStartedOn: '2025-12-01',
      serviceEndedOn: '2026-01-31',
      amountJpy: 6200,
    }
    const configuration = {
      ...initial.configuration,
      charges: { claude: 8000, codex: 0 },
      unknownChargeReasons: undefined,
      monthlyCharges: [],
      chargePeriods: [
        charge,
        { ...charge, id: 'unknown-ai', amountJpy: null, unknownAmountReason: '請求書確認待ち' },
      ],
    }
    const response = await put(
      '/api/workspace',
      {
        expectedRevision: initial.revision,
        requestId: randomUUID(),
        configuration,
        planning,
      },
      server,
    )
    expect(response.status).toBe(200)
    let saved = (await response.json()) as WorkspaceView
    expect(saved.dashboard.unknownCharges).toEqual([
      {
        id: 'unknown-ai',
        provider: 'claude',
        serviceStartedOn: '2025-12-01',
        serviceEndedOn: '2026-01-31',
        reason: '請求書確認待ち',
      },
    ])
    expect(saved.dashboard.boundaries).toEqual([])
    for (const year of [2025, 2026]) {
      const projection = (await getJson(
        '/api/projections?year=' + year,
        server,
      )) as AnnualCostProjection
      expect(projection.totals.knownBasisJpy).toBe(3100)
      expect(projection.totals.unknownBasisIds).toHaveLength(1)
      expect(
        projection.sources.find((source) => source.id === 'ai:charge:unknown-ai'),
      ).toMatchObject({
        originalAmountJpy: null,
        unknownOriginalAmountReasons: ['請求書確認待ち'],
      })
    }
    expect(
      saved.dashboard.months.filter((month) => month.unknownChargeIds?.includes('unknown-ai')),
    ).toHaveLength(2)
    const running = children.at(-1)!
    await new Promise<void>((resolveExit) => {
      running.once('exit', () => resolveExit())
      running.kill()
    })
    server = await startServer(server.data)
    saved = (await getJson('/api/workspace', server)) as WorkspaceView
    expect(
      saved.configuration.chargePeriods.find((item) => item.id === 'unknown-ai'),
    ).toMatchObject({
      amountJpy: null,
      unknownAmountReason: '請求書確認待ち',
    })
    const exportResponse = await fetch(
      'http://127.0.0.1:' + server.port + '/api/export?format=markdown',
    )
    expect(exportResponse.ok).toBe(true)
    expect(await exportResponse.text()).toContain('請求書確認待ち')
    const proposal: WorkspacePreviewInput = {
      expectedRevision: saved.revision,
      planning: saved.planning,
      configuration: {
        ...saved.configuration,
        chargePeriods: [charge, { ...charge, id: 'unknown-ai', amountJpy: 0 }],
      },
    }
    const previewResponse = await preview(proposal, server)
    expect(previewResponse.status).toBe(200)
    const impact = (await previewResponse.json()) as WorkspaceImpact
    expect(
      impact.years.map((row) => [
        row.year,
        row.before.totals.knownBasisJpy,
        row.after.totals.knownBasisJpy,
        row.before.totals.unknownBasisIds.length,
        row.after.totals.unknownBasisIds.length,
      ]),
    ).toEqual([
      [2025, 3100, 3100, 1, 0],
      [2026, 3100, 3100, 1, 0],
    ])
    const confirmed = await put(
      '/api/workspace',
      { ...proposal, requestId: randomUUID(), previewHash: impact.previewHash },
      server,
    )
    expect(confirmed.status).toBe(200)
    const zero = (await confirmed.json()) as WorkspaceView
    expect(zero.dashboard.unknownCharges ?? []).toEqual([])
    expect(zero.configuration.chargePeriods.find((item) => item.id === 'unknown-ai')).toMatchObject(
      { amountJpy: 0 },
    )
    const invalid = await put(
      '/api/workspace',
      {
        ...proposal,
        expectedRevision: zero.revision,
        requestId: randomUUID(),
        configuration: { ...zero.configuration, chargePeriods: [{ ...charge, amountJpy: null }] },
      },
      server,
    )
    expect(invalid.status).toBe(400)
  })

  it('backs up and migrates legacy direct and home costs together on real server startup without changing saved facts', async () => {
    let server = await startServer()
    const initial = snapshot()
    initial.equipment = [equipmentFixture(240000)]
    initial.homeCosts = [
      {
        id: 'old-rent',
        month: '2026-07',
        category: 'rent',
        amountJpy: 4000,
        method: 'area-time',
        businessUseRatio: 0.5,
        basis: '面積・時間',
        rationale: '毎月継続',
        taxUnitId: 'unit-api-test',
        projectAllocationRatio: 0.6,
        treatment: 'shared',
        evidenceIds: [],
      },
    ]
    expect((await put('/api/planning', initial, server)).status).toBe(200)
    const running = children.at(-1)!
    await new Promise<void>((resolveExit) => {
      running.once('exit', () => resolveExit())
      running.kill()
    })
    const db = new DatabaseSync(join(server.data, 'devtax-radar.db'))
    try {
      db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE planning_direct_costs RENAME TO direct_before_fixture;
        CREATE TABLE planning_direct_costs(id TEXT PRIMARY KEY,tax_unit_id TEXT REFERENCES planning_tax_units(id),
          incurred_on TEXT NOT NULL,cost_type TEXT NOT NULL,amount_jpy INTEGER NOT NULL,
          directly_attributable INTEGER NOT NULL,treatment TEXT NOT NULL,note TEXT,evidence_ids_json TEXT NOT NULL) STRICT;
        INSERT INTO planning_direct_costs SELECT id,tax_unit_id,incurred_on,cost_type,amount_jpy,
          directly_attributable,treatment,note,evidence_ids_json FROM direct_before_fixture;
        DROP TABLE direct_before_fixture;
        ALTER TABLE planning_home_costs RENAME TO home_before_fixture;
        CREATE TABLE planning_home_costs(id TEXT PRIMARY KEY,month TEXT NOT NULL,category TEXT NOT NULL,
          amount_jpy INTEGER NOT NULL,method TEXT NOT NULL,business_use_ratio REAL NOT NULL,basis TEXT NOT NULL,
          rationale TEXT NOT NULL,tax_unit_id TEXT REFERENCES planning_tax_units(id),project_allocation_ratio REAL NOT NULL,
          treatment TEXT NOT NULL,evidence_ids_json TEXT NOT NULL) STRICT;
        INSERT INTO planning_home_costs SELECT id,month,category,amount_jpy,method,business_use_ratio,basis,rationale,
          tax_unit_id,project_allocation_ratio,treatment,evidence_ids_json FROM home_before_fixture;
        DROP TABLE home_before_fixture;
        ALTER TABLE planning_equipment RENAME TO equipment_before_fixture;
        CREATE TABLE planning_equipment(id TEXT PRIMARY KEY,name TEXT NOT NULL,equipment_type TEXT NOT NULL,
          acquisition_cost_jpy INTEGER NOT NULL,ordered_on TEXT,delivered_on TEXT,acquired_on TEXT NOT NULL,
          business_use_started_on TEXT,converted_from_private INTEGER NOT NULL,opening_unamortized_balance_jpy INTEGER,
          business_use_ratio REAL NOT NULL,useful_life_years INTEGER,role TEXT NOT NULL,
          tax_unit_id TEXT REFERENCES planning_tax_units(id),project_allocation_ratio REAL NOT NULL,evidence_ids_json TEXT NOT NULL) STRICT;
        INSERT INTO planning_equipment SELECT id,name,equipment_type,acquisition_cost_jpy,ordered_on,delivered_on,
          acquired_on,business_use_started_on,converted_from_private,opening_unamortized_balance_jpy,
          business_use_ratio,useful_life_years,role,tax_unit_id,project_allocation_ratio,evidence_ids_json FROM equipment_before_fixture;
        DROP TABLE equipment_before_fixture; COMMIT;`)
    } finally {
      db.close()
    }
    server = await startServer(server.data)
    const view = (await getJson('/api/workspace', server)) as WorkspaceView
    expect(view.planning.directCosts).toEqual(snapshot().directCosts)
    expect(view.planning.homeCosts).toEqual(initial.homeCosts)
    expect(view.planning.equipment).toEqual(initial.equipment)
    const backups = readdirSync(server.data).filter((name) =>
      name.startsWith('devtax-radar.before-direct-cost-unknown-'),
    )
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(server.data, backups[0]!), { readOnly: true })
    try {
      expect(backup.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(backup.prepare('SELECT acquisition_cost_jpy FROM planning_equipment').all()).toEqual([
        { acquisition_cost_jpy: 240000 },
      ])
      expect(backup.prepare('SELECT amount_jpy FROM planning_direct_costs').all()).toEqual([
        { amount_jpy: 2000 },
      ])
      expect(
        backup.prepare('SELECT amount_jpy,business_use_ratio,basis FROM planning_home_costs').all(),
      ).toEqual([{ amount_jpy: 4000, business_use_ratio: 0.5, basis: '面積・時間' }])
    } finally {
      backup.close()
    }
  })
  it('saves unknown direct costs as null with their reason, previews and exports them, and distinguishes a later confirmed zero', async () => {
    let server = await startServer()
    let base = `http://127.0.0.1:${server.port}`
    const view = (await (await fetch(base + '/api/workspace')).json()) as WorkspaceView
    const planning = snapshot()
    planning.equipment = [equipmentFixture(null)]
    planning.homeCosts = (['rent', 'electricity', 'internet'] as const).map((category) => ({
      id: `unknown-${category}`,
      month: '2026-07',
      category,
      amountJpy: null,
      unknownAmountReason: `${category}の請求額を確認中`,
      method: 'fixed-ratio',
      businessUseRatio: 0.5,
      basis: '使用状況の記録',
      rationale: '毎月同じ方法で確認',
      taxUnitId: 'unit-api-test',
      projectAllocationRatio: 0.6,
      treatment: 'shared',
      evidenceIds: [],
    }))
    planning.directCosts.push({
      ...planning.directCosts[0]!,
      id: 'unknown-charge',
      amountJpy: null,
      unknownAmountReason: '請求書の再発行待ち',
    })
    const input = { expectedRevision: view.revision, configuration: view.configuration, planning }
    const previewResponse = await fetch(base + '/api/workspace/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        'x-devtax-csrf': server.csrfToken,
      },
      body: JSON.stringify(input),
    })
    expect(previewResponse.status).toBe(200)
    const preview = (await previewResponse.json()) as WorkspaceImpact
    const year = preview.years.find((item) => item.year === 2026)!
    expect(year.after.sources.find((item) => item.id === 'direct:unknown-charge')).toMatchObject({
      originalAmountJpy: null,
      unknownOriginalAmountReasons: ['請求書の再発行待ち'],
    })
    const response = await put(
      '/api/workspace',
      { ...input, requestId: randomUUID(), previewHash: preview.previewHash },
      server,
    )
    expect(response.status).toBe(200)
    const saved = (await response.json()) as WorkspaceView
    expect(saved.planning.directCosts.find((item) => item.id === 'unknown-charge')).toMatchObject({
      amountJpy: null,
      unknownAmountReason: '請求書の再発行待ち',
    })
    expect(saved.dashboard.costProjection).toEqual(year.after)
    expect(
      saved.dashboard.costProjection!.sources.find((source) => source.kind === 'equipment'),
    ).toMatchObject({ originalAmountJpy: null, unknownOriginalAmountReasons: ['領収書の確認待ち'] })
    for (const home of planning.homeCosts) {
      expect(
        saved.dashboard.costProjection!.sources.find((source) => source.id === `home:${home.id}`),
      ).toMatchObject({
        originalAmountJpy: null,
        unknownOriginalAmountReasons: [home.unknownAmountReason],
      })
      expect(
        saved.dashboard.costProjection!.contributions.some((row) =>
          row.sourceIds.includes(`home:${home.id}`),
        ),
      ).toBe(false)
    }
    const persisted = new DatabaseSync(join(server.data, 'devtax-radar.db'), { readOnly: true })
    try {
      expect(
        persisted
          .prepare(
            "SELECT amount_jpy,unknown_amount_reason FROM planning_direct_costs WHERE id='unknown-charge'",
          )
          .get(),
      ).toEqual({ amount_jpy: null, unknown_amount_reason: '請求書の再発行待ち' })
    } finally {
      persisted.close()
    }
    const running = children.at(-1)!
    await new Promise<void>((resolveExit) => {
      running.once('exit', () => resolveExit())
      running.kill()
    })
    server = await startServer(server.data)
    base = 'http://127.0.0.1:' + server.port
    const exportResponse = await fetch(base + '/api/export?format=markdown')
    expect(exportResponse.status).toBe(200)
    expect(await exportResponse.text()).toContain('原額 不明')
    const reread = (await (await fetch(base + '/api/workspace')).json()) as WorkspaceView
    expect(reread.planning.directCosts).toEqual(saved.planning.directCosts)
    expect(reread.planning.homeCosts).toEqual(planning.homeCosts)
    expect(reread.planning.equipment).toEqual(planning.equipment)
    reread.planning.equipment[0]!.acquisitionCostJpy = 0
    delete reread.planning.equipment[0]!.unknownAmountReason
    for (const home of reread.planning.homeCosts) {
      home.amountJpy = 0
      delete home.unknownAmountReason
    }
    const cost = reread.planning.directCosts.find((item) => item.id === 'unknown-charge')!
    cost.amountJpy = 0
    delete cost.unknownAmountReason
    const zero = await put(
      '/api/workspace',
      {
        expectedRevision: reread.revision,
        requestId: randomUUID(),
        configuration: reread.configuration,
        planning: reread.planning,
      },
      server,
    )
    expect(zero.status).toBe(200)
    const zeroView = (await zero.json()) as WorkspaceView
    expect(
      zeroView.dashboard.costProjection!.sources.find((source) => source.kind === 'equipment')
        ?.originalAmountJpy,
    ).toBe(0)
    expect(
      zeroView.dashboard.costProjection!.totals.unknownBasisIds.some((id) =>
        id.startsWith('equipment:'),
      ),
    ).toBe(true)
    expect(
      zeroView.planning.homeCosts.every(
        (home) => home.amountJpy === 0 && home.unknownAmountReason === undefined,
      ),
    ).toBe(true)
    expect(
      zeroView.dashboard.costProjection!.sources.find((item) => item.id === 'direct:unknown-charge')
        ?.originalAmountJpy,
    ).toBe(0)
    reread.planning.equipment[0]!.acquisitionCostJpy = null
    const invalidEquipment = await put(
      '/api/workspace',
      {
        expectedRevision: zeroView.revision,
        requestId: randomUUID(),
        configuration: reread.configuration,
        planning: reread.planning,
      },
      server,
    )
    expect(invalidEquipment.status).toBe(400)
    reread.planning.equipment[0]!.acquisitionCostJpy = 0
    reread.planning.homeCosts[0]!.amountJpy = null
    const invalidHome = await put(
      '/api/workspace',
      {
        expectedRevision: zeroView.revision,
        requestId: randomUUID(),
        configuration: reread.configuration,
        planning: reread.planning,
      },
      server,
    )
    expect(invalidHome.status).toBe(400)
    reread.planning.homeCosts[0]!.amountJpy = 0
    cost.amountJpy = null
    const invalid = await put(
      '/api/workspace',
      {
        expectedRevision: zeroView.revision,
        requestId: randomUUID(),
        configuration: reread.configuration,
        planning: reread.planning,
      },
      server,
    )
    expect(invalid.status).toBe(400)
  })
  it('previews every registered year without writes and binds confirmation to the exact input and observation', async () => {
    const config = await startServer()
    const initial = (await getJson('/api/workspace', config)) as WorkspaceView
    const planning = snapshot()
    planning.projectRules[0]!.effectiveFrom = '2025-12-01'
    planning.equipment = [
      {
        id: 'pc',
        name: '合成PC',
        equipmentType: 'pc',
        acquiredOn: '2026-01-01',
        acquisitionCostJpy: 240000,
        convertedFromPrivate: false,
        businessUseRatio: 1,
        role: '開発',
        taxUnitId: 'unit-api-test',
        projectAllocationRatio: 1,
        evidenceIds: [],
      },
    ]
    const charge = {
      id: 'preview-ai',
      provider: 'claude' as const,
      planName: '合成AI',
      serviceStartedOn: '2025-12-01',
      serviceEndedOn: '2026-01-31',
      amountJpy: 6300,
    }
    const seeded = await put(
      '/api/workspace',
      {
        expectedRevision: initial.revision,
        requestId: randomUUID(),
        configuration: { ...initial.configuration, chargePeriods: [charge], unobservedRatio: 0 },
        planning,
      },
      config,
    )
    expect(seeded.status).toBe(200)
    const db = new DatabaseSync(join(config.data, 'devtax-radar.db'))
    try {
      db.prepare(
        `INSERT INTO usage_events(source_id,provider,session_key,project_key,month,started_at,ended_at,message_count,input_tokens,schema_version,confidence)
        VALUES ('local-claude','claude','synthetic-preview','project_abcdef0123456789abcdef01','2026-01','2026-01-15T00:00:00.000Z','2026-01-15T00:01:00.000Z',1,100,'test','high')`,
      ).run()
      const before = (await getJson('/api/workspace', config)) as WorkspaceView
      const proposal: WorkspacePreviewInput = {
        expectedRevision: before.revision,
        configuration: structuredClone(before.configuration),
        planning: structuredClone(before.planning),
      }
      proposal.configuration.chargePeriods = [
        {
          ...charge,
          serviceStartedOn: '2026-01-01',
          serviceEndedOn: '2026-02-28',
          amountJpy: 5900,
        },
      ]
      proposal.planning.profile.taxYear = 2027
      proposal.planning.directCosts[0]!.amountJpy = 2500
      proposal.planning.projectRules[0]!.classification = 'maintenance'
      db.exec(
        "CREATE TRIGGER forbid_preview_config BEFORE UPDATE ON provider_settings BEGIN SELECT RAISE(ABORT,'preview must not write'); END; CREATE TRIGGER forbid_preview_plan BEFORE DELETE ON planning_profiles BEGIN SELECT RAISE(ABORT,'preview must not write'); END",
      )
      const response = await preview(proposal, config)
      expect(response.status).toBe(200)
      const report = (await response.json()) as WorkspaceImpact
      expect(report.scope).toMatchObject({ fromYear: 2025, toYear: 2027 })
      expect(
        report.years.map((row) => [
          row.year,
          row.before.totals.knownBasisJpy,
          row.after.totals.knownBasisJpy,
        ]),
      ).toEqual([
        [2025, 3150, 0],
        [2026, 5150, 8400],
        [2027, 0, 0],
      ])
      expect(report.years[1]!.before.totals.unknownBasisIds).toHaveLength(1)
      expect(report.years[2]!.after.totals.unknownBasisIds).toHaveLength(1)
      expect(report.years[1]!.aiBefore).toEqual({ current: 0, future: 3150, review: 0 })
      expect(report.years[1]!.aiAfter).toEqual({ current: 3100, future: 0, review: 2800 })
      expect(report.assignmentChanges).toEqual([
        expect.objectContaining({
          month: '2026-01',
          provider: 'claude',
          count: 1,
          before: expect.objectContaining({ classification: 'new-development' }),
          after: expect.objectContaining({ classification: 'maintenance' }),
        }),
      ])
      expect(await getJson('/api/workspace', config)).toEqual(before)
      expect(
        ((await (await preview(proposal, config)).json()) as WorkspaceImpact).previewHash,
      ).toBe(report.previewHash)
      db.exec('DROP TRIGGER forbid_preview_config; DROP TRIGGER forbid_preview_plan')
      const altered = structuredClone(proposal)
      altered.planning.directCosts[0]!.amountJpy = altered.planning.directCosts[0]!.amountJpy! + 1
      const tampered = await put(
        '/api/workspace',
        { ...altered, requestId: randomUUID(), previewHash: report.previewHash },
        config,
      )
      expect(tampered.status).toBe(409)
      expect(await tampered.json()).toMatchObject({ error: 'preview_changed' })
      expect(await getJson('/api/workspace', config)).toEqual(before)
      db.exec("UPDATE usage_events SET input_tokens = 200 WHERE session_key = 'synthetic-preview'")
      const stale = await put(
        '/api/workspace',
        { ...proposal, requestId: randomUUID(), previewHash: report.previewHash },
        config,
      )
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({ error: 'preview_changed' })
      const fresh = (await (await preview(proposal, config)).json()) as WorkspaceImpact
      expect(fresh.previewHash).not.toBe(report.previewHash)
      expect(fresh.years[1]!.after.totals).toEqual(report.years[1]!.after.totals)
      const request = { ...proposal, requestId: randomUUID(), previewHash: fresh.previewHash }
      const savedResponse = await put('/api/workspace', request, config)
      expect(savedResponse.status).toBe(200)
      const saved = (await savedResponse.json()) as WorkspaceView
      expect(saved.dashboard.costProjection).toEqual(fresh.years[2]!.after)
      expect(await getJson('/api/projections?year=2026', config)).toEqual(fresh.years[1]!.after)
      const replay = await put('/api/workspace', request, config)
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual(saved)
      expect((await preview(proposal, config)).status).toBe(409)
    } finally {
      db.close()
    }
  })

  it('saves chosen record merges against the latest revision and rejects a merged dangling reference atomically', async () => {
    const config = await startServer()
    expect((await put('/api/planning', snapshot(), config)).status).toBe(200)
    const base = (await getJson('/api/workspace', config)) as WorkspaceView
    const local = structuredClone(base)
    local.configuration.unobservedRatio = 0.1
    local.planning.directCosts[0]!.amountJpy = 6000
    const remote = structuredClone(base)
    remote.configuration.unobservedRatio = 0.2
    remote.planning.directCosts[0]!.note = '現在の保存側の根拠'
    remote.planning.profile.notes = '別の画面の変更'
    const request = (value: typeof local, expectedRevision: number) => ({
      expectedRevision,
      requestId: randomUUID(),
      configuration: value.configuration,
      planning: value.planning,
    })
    const remoteSave = await put('/api/workspace', request(remote, base.revision), config)
    expect(remoteSave.status).toBe(200)
    const latest = (await remoteSave.json()) as WorkspaceView
    const choices = {
      unobservedRatio: 'local' as const,
      [JSON.stringify(['directCosts', 'direct-api-test'])]: 'latest' as const,
    }
    const merge = mergeWorkspaceDrafts(base, local, latest, choices)
    expect(merge.contents).not.toBeNull()
    const response = await put(
      '/api/workspace',
      { expectedRevision: latest.revision, requestId: randomUUID(), ...merge.contents },
      config,
    )
    expect(response.status).toBe(200)
    const saved = (await response.json()) as WorkspaceView
    expect(saved.configuration.unobservedRatio).toBe(0.1)
    expect(saved.planning.directCosts[0]).toMatchObject({
      amountJpy: 2000,
      note: '現在の保存側の根拠',
    })
    expect(saved.planning.profile.notes).toBe('別の画面の変更')
    expect(saved.dashboard.costProjection?.totals.knownBasisJpy).toBe(2000)

    const adding = structuredClone(saved)
    adding.configuration.unobservedRatio = 0.3
    adding.planning.directCosts.push({ ...saved.planning.directCosts[0]!, id: 'new-domain' })
    const deleting = structuredClone(saved)
    deleting.planning.taxUnits = []
    deleting.planning.directCosts = []
    deleting.planning.projectRules = []
    const deletedResponse = await put('/api/workspace', request(deleting, saved.revision), config)
    expect(deletedResponse.status).toBe(200)
    const deleted = (await deletedResponse.json()) as WorkspaceView
    const invalidMerge = mergeWorkspaceDrafts(saved, adding, deleted)
    expect(invalidMerge.contents).not.toBeNull()
    const rejected = await put(
      '/api/workspace',
      { expectedRevision: deleted.revision, requestId: randomUUID(), ...invalidMerge.contents },
      config,
    )
    expect(rejected.status).toBe(400)
    expect(await getJson('/api/workspace', config)).toEqual(deleted)
  })

  it('saves and rereads a single workspace, rejects stale tabs and replays a lost response without another write', async () => {
    const config = await startServer()
    const before = (await getJson('/api/workspace', config)) as WorkspaceView
    const request = {
      expectedRevision: before.revision,
      requestId: randomUUID(),
      planning: snapshot(),
      configuration: {
        ...before.configuration,
        unobservedRatio: null,
        chargePeriods: [
          {
            id: 'atomic-ai',
            provider: 'claude',
            planName: '合成契約',
            serviceStartedOn: '2026-07-01',
            serviceEndedOn: '2026-07-31',
            amountJpy: 3100,
          },
        ],
      },
    }
    const response = await put('/api/workspace', request, config)
    expect(response.status).toBe(200)
    const saved = (await response.json()) as WorkspaceView
    expect(saved.revision).toBeGreaterThan(before.revision)
    expect(saved.planning.taxUnits[0]?.name).toBe('公開予定アプリ')
    expect(saved.configuration.chargePeriods[0]?.amountJpy).toBe(3100)
    expect(saved.dashboard.costProjection?.totals.knownBasisJpy).toBe(5100)
    expect(await getJson('/api/workspace', config)).toEqual(saved)
    const replay = await put('/api/workspace', request, config)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(saved)
    const stale = await put('/api/workspace', { ...request, requestId: randomUUID() }, config)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ currentRevision: saved.revision })
    expect(
      (await put('/api/workspace', { ...request, planning: before.planning }, config)).status,
    ).toBe(400)
    const invalid = {
      ...request,
      expectedRevision: saved.revision,
      requestId: randomUUID(),
      planning: { ...snapshot(), taxUnits: [] },
    }
    expect((await put('/api/workspace', invalid, config)).status).toBe(400)
    expect(await getJson('/api/workspace', config)).toEqual(saved)
    // The legacy route also advances the shared revision, including an ABA edit.
    expect((await put('/api/planning', before.planning, config)).status).toBe(200)
    expect((await put('/api/planning', saved.planning, config)).status).toBe(200)
    expect((await put('/api/workspace', request, config)).status).toBe(409)
    expect(((await getJson('/api/workspace', config)) as WorkspaceView).revision).toBeGreaterThan(
      saved.revision,
    )
  })

  it('rolls back configuration, planning and revision when the second write fails, then allows the same request to retry', async () => {
    const config = await startServer()
    const before = (await getJson('/api/workspace', config)) as WorkspaceView
    const request = {
      expectedRevision: before.revision,
      requestId: randomUUID(),
      planning: snapshot(),
      configuration: {
        ...before.configuration,
        charges: { claude: 12345, codex: 6789 },
        unknownChargeReasons: undefined,
      },
    }
    const db = new DatabaseSync(join(config.data, 'devtax-radar.db'))
    try {
      db.exec(
        "CREATE TRIGGER fail_workspace_plan BEFORE INSERT ON planning_tax_units BEGIN SELECT RAISE(ABORT, 'injected planning write failure'); END",
      )
      expect((await put('/api/workspace', request, config)).status).toBe(500)
      expect(await getJson('/api/workspace', config)).toEqual(before)
      db.exec('DROP TRIGGER fail_workspace_plan')
      expect((await put('/api/workspace', request, config)).status).toBe(200)
      const saved = (await getJson('/api/workspace', config)) as WorkspaceView
      expect(saved.configuration.charges).toEqual({ claude: 12345, codex: 6789 })
      expect(saved.planning.taxUnits[0]?.id).toBe('unit-api-test')
    } finally {
      db.close()
    }
  })

  it('returns all cost sources in the requested year, preserves unknown bases, and omits private references', async () => {
    const config = await startServer()
    const planning = snapshot()
    planning.equipment = [
      {
        id: 'pc',
        name: 'PC',
        equipmentType: 'pc',
        acquisitionCostJpy: 240000,
        acquiredOn: '2026-01-01',
        convertedFromPrivate: false,
        businessUseRatio: 1,
        role: '開発',
        taxUnitId: 'unit-api-test',
        projectAllocationRatio: 1,
        evidenceIds: ['receipt'],
      },
    ]
    planning.evidence = [
      {
        id: 'receipt',
        evidenceType: 'receipt',
        strength: 'external',
        recordedAt: '2026-07-01T00:00:00Z',
        note: '合成の購入記録',
        localReference: 'C:\\private-fixture\\receipt.pdf',
      },
    ]
    planning.homeCosts = [
      {
        id: 'rent',
        month: '2026-07',
        category: 'rent',
        amountJpy: 4000,
        method: 'area',
        businessUseRatio: 0.5,
        basis: '面積50%',
        rationale: '作業場所',
        taxUnitId: 'unit-api-test',
        projectAllocationRatio: 0.6,
        treatment: 'shared',
        evidenceIds: [],
      },
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
    const projected = (await getJson('/api/projections?year=2026', config)) as AnnualCostProjection
    expect(projected.sources).toHaveLength(4)
    expect(projected.totals).toMatchObject({
      knownBasisJpy: 9100,
      taxUnitJpy: 3200,
      privateJpy: 2000,
      unallocatedJpy: 3900,
    })
    expect(projected.totals.unknownBasisIds).toHaveLength(1)
    expect(
      projected.sources.find((source) => source.kind === 'subscription')?.originalAmountJpy,
    ).toBe(6200)
    expect(projected.byTaxUnit[0].unknownBasisIds).toHaveLength(1)
    expect(JSON.stringify(projected)).not.toContain('private-fixture')
    expect(JSON.stringify(projected)).not.toContain('localReference')
    const earlier = (await getJson('/api/projections?year=2025', config)) as AnnualCostProjection
    expect(earlier.totals.knownBasisJpy).toBe(3100)
    expect(earlier.sources).toHaveLength(1)
    expect(((await getJson('/api/planning', config)) as PlanningSnapshot).profile.taxYear).toBe(
      2026,
    )
    const dashboard = (await getJson('/api/dashboard', config)) as {
      costProjection: AnnualCostProjection
    }
    expect(dashboard.costProjection).toEqual(projected)
    expect(await getJson('/api/ledger', config)).toEqual(projected)
    const exported = await fetch(`http://127.0.0.1:${config.port}/api/export?format=markdown`).then(
      (response) => response.text(),
    )
    expect(exported).toContain('算定済みの費用基礎: 9,100円')
    expect(exported).toContain('原額 240,000円')
    expect(exported).toContain('未算定の理由')
    expect(exported).toContain('作業中の費用資料')
    expect(exported).not.toContain('private-fixture')
    expect((await fetch(`http://127.0.0.1:${config.port}/api/projections?year=NaN`)).status).toBe(
      400,
    )
  }, 20000)
  it('persists validated planning, derives guidance, and exports markdown', async () => {
    const testPort = await port()
    const data = mkdtempSync(join(tmpdir(), 'devtax-planning-api-'))
    directories.push(data)
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(testPort),
        DEVTAX_RADAR_DATA_DIR: data,
        USERPROFILE: data,
        HOME: data,
        DEVTAX_RADAR_CLAUDE_SETTINGS: join(data, 'claude-settings.json'),
      },
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
        totals: expect.objectContaining({ knownBasisJpy: 2_000 }),
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

  it('重複するルールIDを拒否する', async () => {
    const config = await startServer()
    const response = await put(
      '/api/planning/rules',
      {
        rules: [
          {
            id: 'rule-api-dup',
            projectKey: 'project_rules_api_0003',
            effectiveFrom: '2026-01-01',
            classification: 'new-development',
          },
          {
            id: 'rule-api-dup',
            projectKey: 'project_rules_api_0004',
            effectiveFrom: '2026-02-01',
            classification: 'maintenance',
          },
        ],
      },
      config,
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { message?: string }
    expect(body.message).toContain('同じIDのルールが重複しています')
  }, 20_000)

  it('設定APIはmappingsを受け付けない', async () => {
    const testPort = await port()
    const data = mkdtempSync(join(tmpdir(), 'devtax-planning-api-'))
    directories.push(data)
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server/index.ts')], {
      cwd: resolve('.'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(testPort),
        DEVTAX_RADAR_DATA_DIR: data,
        USERPROFILE: data,
        HOME: data,
        DEVTAX_RADAR_CLAUDE_SETTINGS: join(data, 'claude-settings.json'),
      },
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
