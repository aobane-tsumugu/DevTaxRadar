import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import type { WorkspaceDraft } from '../src/planning/workspace.js'
import type { AnnualCostProjection } from '../src/accounting/costs.js'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:net'
import { chargeContractBasis } from '../src/core/chargePeriods.js'

/** Exercises the bundled entries without tsx, source imports, or a user's database. */
export async function verifyReleaseLifecycle(releaseRoot: string): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'devtax-release-check-'))
  const source = join(temporary, 'original data')
  const restored = join(temporary, 'restored data')
  const bundle = join(temporary, 'backup data')
  const home = join(temporary, 'isolated home')
  mkdirSync(home)
  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: home,
    XDG_DATA_HOME: home,
    DEVTAX_RADAR_AUTO_SCAN: '0',
    DEVTAX_RADAR_DATA_DIR: source,
    DEVTAX_RADAR_CLAUDE_SETTINGS: join(home, 'settings.json'),
    PORT: '0',
  }
  const cli = (tool: string, ...args: string[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [join(releaseRoot, 'runtime', 'tools', tool + '.mjs'), ...args],
        {
          cwd: releaseRoot,
          env: environment,
          encoding: 'utf8',
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    )
  async function withServer(dataDirectory: string, check: (url: string) => Promise<void>) {
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const address = reservation.address()
    assert.ok(address && typeof address === 'object')
    const port = address.port
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    )
    const child = spawn(process.execPath, [join(releaseRoot, 'runtime', 'server', 'index.mjs')], {
      cwd: releaseRoot,
      env: { ...environment, DEVTAX_RADAR_DATA_DIR: dataDirectory, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    child.stderr.on('data', (chunk) => {
      output = (output + chunk).slice(-16_384)
    })
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Release server startup timed out: ' + output)),
          20_000,
        )
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`Release server exited ${code}: ${output}`))
        })
        child.stdout.on('data', (chunk) => {
          output = (output + chunk).slice(-16_384)
          const address = output.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
          if (address) {
            clearTimeout(timer)
            resolve(address)
          }
        })
      })
      await check(url)
    } finally {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill()
        await exited
      }
    }
  }
  const get = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body))
    return body as Record<string, unknown>
  }
  async function verifySavedInvoice(url: string) {
    const workspace = (await get(url + '/api/workspace')) as unknown as WorkspaceDraft
    assert.equal(workspace.configuration.charges.claude, null)
    assert.equal(workspace.configuration.charges.codex, 0)
    assert.equal(
      workspace.configuration.unknownChargeReasons?.claude,
      '配布検査：既定月額の確認待ち',
    )
    assert.deepEqual(workspace.configuration.chargePeriods?.[0]?.evidenceIds, [
      'release-invoice-proof',
    ])
    assert.equal(
      workspace.configuration.chargePeriods?.find((period) => period.id === 'release-invoice')
        ?.contractConfirmation?.reference,
      '配布検査の本契約',
    )
    assert.equal(
      workspace.planning.evidence.find((row) => row.id === 'release-invoice-proof')?.note,
      '配布検査：合成請求の確認記録',
    )
    const projection = (await get(
      url + '/api/projections?year=2026',
    )) as unknown as AnnualCostProjection
    const invoice = projection.sources.find((row) => row.id === 'ai:charge:release-invoice')
    assert.ok(invoice)
    assert.equal(invoice.originalAmountJpy, null)
    assert.deepEqual(invoice.unknownOriginalAmountReasons, ['配布検査：原額確認待ち'])
    assert.deepEqual(invoice.evidenceIds, ['release-invoice-proof'])
    assert.ok(projection.totals.unknownBasisIds.length > 0)
    for (const [month, amount] of [
      ['2026-02', 1200],
      ['2026-03', 0],
      ['2026-04', null],
    ] as const) {
      const monthly = projection.sources.find((row) => row.id === `ai:monthly:claude:${month}`)
      assert.ok(monthly, `An unrelated invoice must not remove ${month}`)
      assert.equal(monthly.originalAmountJpy, amount)
      if (amount === null)
        assert.deepEqual(monthly.unknownOriginalAmountReasons, ['配布検査：過年度明細を確認中'])
    }
    const overlapping = projection.bases.filter(
      (row) => row.sourceId === 'ai:charge:release-invoice',
    )
    assert.ok(
      overlapping.some((row) =>
        row.warnings.some((warning) => warning.includes('別契約として確認済み')),
      ),
    )
  }
  let savedReviewId = ''
  const savedExports: Record<string, string> = {}
  try {
    await withServer(source, async (url) => {
      const html = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      assert.equal(html.status, 200)
      const page = await html.text()
      assert.match(page, /<html/)
      assert.match(page, /DevTaxを読み込んでいます/)
      assert.equal(html.headers.get('cache-control'), 'no-store')
      const scriptPath = page.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1]
      assert.ok(scriptPath, 'Packaged HTML must reference its built JavaScript')
      const script = await fetch(url + scriptPath, { signal: AbortSignal.timeout(10_000) })
      assert.equal(script.status, 200)
      assert.match(script.headers.get('content-type') ?? '', /javascript/)
      const missingScript = await fetch(url + '/assets/missing-release-check.js', {
        signal: AbortSignal.timeout(10_000),
      })
      assert.equal(missingScript.status, 404)
      assert.doesNotMatch(missingScript.headers.get('content-type') ?? '', /text\/html/)
      const runtime = await get(url + '/api/runtime')
      assert.equal(runtime.restoreRequiresReconnect, false)
      const workspace = (await get(url + '/api/workspace')) as unknown as WorkspaceDraft
      assert.deepEqual({ ...workspace.configuration.charges }, { claude: null, codex: null })
      assert.equal(workspace.configuration.unknownChargeReasons?.codex, '既定月額が未入力です。')
      workspace.configuration.charges.codex = 0
      workspace.configuration.charges.claude = null
      workspace.configuration.monthlyCharges = [
        { provider: 'claude', month: '2026-02', amountJpy: 1200 },
        { provider: 'claude', month: '2026-03', amountJpy: 0 },
        {
          provider: 'claude',
          month: '2026-04',
          amountJpy: null,
          unknownAmountReason: '配布検査：過年度明細を確認中',
        },
      ]
      workspace.configuration.unknownChargeReasons = { claude: '配布検査：既定月額の確認待ち' }
      workspace.configuration.chargePeriods = [
        {
          id: 'release-invoice',
          provider: 'claude',
          planName: '合成請求',
          serviceStartedOn: '2026-01-01',
          serviceEndedOn: '2026-01-31',
          amountJpy: null,
          unknownAmountReason: '配布検査：原額確認待ち',
          evidenceIds: ['release-invoice-proof'],
        },
      ]
      workspace.configuration.chargePeriods.push(
        {
          id: 'release-overlap',
          provider: 'claude',
          planName: '合成の重複確認',
          serviceStartedOn: '2026-01-15',
          serviceEndedOn: '2026-01-31',
          amountJpy: 500,
        },
        {
          id: 'release-future',
          provider: 'claude',
          planName: '合成の翌年請求',
          serviceStartedOn: '2027-01-01',
          serviceEndedOn: '2027-01-31',
          amountJpy: 4000,
        },
      )
      for (const [id, reference] of [
        ['release-invoice', '配布検査の本契約'],
        ['release-overlap', '配布検査の追加契約'],
      ] as const) {
        const period = workspace.configuration.chargePeriods.find((row) => row.id === id)!
        period.contractConfirmation = {
          reference,
          reason: '配布検査で請求と契約の明細を照合',
          confirmedAt: '2026-09-09T00:00:00Z',
          basis: chargeContractBasis(period),
        }
      }
      workspace.planning.evidence = [
        {
          id: 'release-invoice-proof',
          evidenceType: 'memo',
          strength: 'self-recorded',
          recordedAt: '2026-01-01T00:00:00Z',
          note: '配布検査：合成請求の確認記録',
        },
      ]
      const saved = await fetch(url + '/api/workspace', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          origin: url,
          'x-devtax-csrf': String(runtime.csrfToken),
        },
        body: JSON.stringify({
          expectedRevision: workspace.revision,
          requestId: randomUUID(),
          configuration: workspace.configuration,
          planning: workspace.planning,
        }),
        signal: AbortSignal.timeout(10000),
      })
      assert.equal(saved.status, 200, await saved.text())
      await verifySavedInvoice(url)
      // Bind a real adopted record, then compare the standalone reader with its API output.
      const preview = await get(url + '/api/balances/preview?year=2026')
      const adoption = await fetch(url + '/api/balances/reviews', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: url,
          'x-devtax-csrf': String(runtime.csrfToken),
        },
        body: JSON.stringify({
          year: 2026,
          expectedDraftRevision: preview.draftRevision,
          projectionHash: preview.projectionHash,
          expectedDatasetId: runtime.datasetId,
          idempotencyKey: randomUUID(),
          reason: '配布検査：原本なしで読み取る採用資料',
        }),
        signal: AbortSignal.timeout(10_000),
      })
      const adoptedBody = await adoption.text()
      assert.equal(adoption.status, 200, adoptedBody)
      savedReviewId = (JSON.parse(adoptedBody) as { review: { id: string } }).review.id
      assert.ok(savedReviewId)
      for (const format of ['json', 'markdown']) {
        const exported = await fetch(
          url + '/api/balances/reviews/' + savedReviewId + '/export?format=' + format,
          { signal: AbortSignal.timeout(10_000) },
        )
        assert.equal(exported.status, 200)
        savedExports[format] = await exported.text()
      }
    })
    // No history scan is needed for this isolated fixture; supply its own identity.
    writeFileSync(join(source, 'identifier-salt'), randomBytes(32).toString('base64url') + '\n')
    const seed = new DatabaseSync(join(source, 'devtax-radar.db'))
    try {
      seed
        .prepare(
          'INSERT INTO planning_cost_presence(id,tax_year,category,status,reason,recorded_at) VALUES (?,?,?,?,?,?)',
        )
        .run(
          'release-presence',
          2026,
          'home',
          'deferred',
          '配布検査の合成記録',
          '2026-09-08T00:00:00Z',
        )
    } finally {
      seed.close()
    }
    const manifest = cli('data-backup', 'create', source, bundle)
    assert.equal(cli('data-backup', 'verify', bundle).schemaHash, manifest.schemaHash)
    assert.equal(cli('data-backup', 'restore', bundle, restored).requiresSourceReconnect, true)
    assert.deepEqual(
      readFileSync(join(source, 'identifier-salt')),
      readFileSync(join(restored, 'identifier-salt')),
    )
    const original = new DatabaseSync(join(source, 'devtax-radar.db'), { readOnly: true })
    const copy = new DatabaseSync(join(restored, 'devtax-radar.db'), { readOnly: true })
    try {
      for (const row of original
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()) {
        const table = '"' + String(row.name).replaceAll('"', '""') + '"'
        assert.deepEqual(
          copy.prepare('SELECT * FROM ' + table).all(),
          original.prepare('SELECT * FROM ' + table).all(),
        )
      }
    } finally {
      original.close()
      copy.close()
    }
    // Only the dedicated synthetic source is removed. The reader must need neither
    // the old application DB nor original history folders to read the saved bundle.
    rmSync(source, { recursive: true, force: true })
    const index = cli('read-review', 'list', bundle) as { reviews: { id: string }[] }
    assert.ok(index.reviews.some((review) => review.id === savedReviewId))
    for (const format of ['json', 'markdown']) {
      const output = join(temporary, '保存資料-' + format + '.txt')
      const result = cli('read-review', 'export', bundle, savedReviewId, format, output)
      assert.equal(result.reviewId, savedReviewId)
      assert.equal(readFileSync(output, 'utf8'), savedExports[format])
    }
    assert.deepEqual(cli('data-backup', 'verify', bundle).files, manifest.files)
    await withServer(restored, async (url) => {
      assert.equal((await get(url + '/api/runtime')).restoreRequiresReconnect, true)
      await verifySavedInvoice(url)
      await get(url + '/api/workspace')
      await get(url + '/api/restore/sources')
    })
    const planPath = join(temporary, 'reconnect plan.json')
    const preview = cli('restore-sources', 'preview', restored, planPath)
    for (const item of preview.plan.sources) item.enabled = false
    writeFileSync(planPath, JSON.stringify(preview.plan))
    assert.deepEqual(cli('restore-sources', 'apply', restored, planPath), {
      reconnected: true,
      scanStarted: false,
      sources: preview.plan.sources,
    })
    await withServer(restored, async (url) => {
      assert.equal((await get(url + '/api/runtime')).restoreRequiresReconnect, false)
      await verifySavedInvoice(url)
      await get(url + '/api/workspace')
    })
    console.log(
      'Release lifecycle passed: startup, invoice save and projection, backup, verification, full-table restore, standalone adopted review read, reconnect, restart.',
    )
  } finally {
    // mkdtempSync returned this dedicated directory; no user-supplied path is removed.
    rmSync(temporary, { recursive: true, force: true })
  }
}
