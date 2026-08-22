import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('configured filesystem history sources', () => {
  let root: string
  let dataDirectory: string
  let firstFixture: string
  let secondFixture: string
  let localFixture: string
  let database: typeof import('../../src/server/database.ts')
  let scanner: typeof import('../../src/server/historySources.ts')
  const originalHome = process.env.HOME
  const originalProfile = process.env.USERPROFILE

  function copyCleanClaudeFixture(destination: string): void {
    cpSync(resolve('fixtures/claude'), destination, { recursive: true })
    const historyPath = join(destination, 'synthetic-history.jsonl')
    const cleanLines = readFileSync(historyPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line !== 'not valid json')
      .join('\n')
    writeFileSync(historyPath, cleanLines, 'utf8')
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'devtax-history-sources-'))
    dataDirectory = join(root, 'data')
    firstFixture = join(root, 'pc1-claude')
    secondFixture = join(root, 'dgx-claude')
    localFixture = join(root, 'isolated-home', '.claude', 'projects')
    copyCleanClaudeFixture(firstFixture)
    copyCleanClaudeFixture(secondFixture)
    copyCleanClaudeFixture(localFixture)
    process.env.DEVTAX_RADAR_DATA_DIR = dataDirectory
    process.env.HOME = join(root, 'isolated-home')
    process.env.USERPROFILE = join(root, 'isolated-home')
    vi.resetModules()
    database = await import('../../src/server/database.ts')
    scanner = await import('../../src/server/historySources.ts')
  })

  afterEach(() => {
    database.getDatabase().close()
    delete process.env.DEVTAX_RADAR_DATA_DIR
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalProfile
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('同じ元IDを持つPC1とDGXを別の出所として集約し、走査結果へpathを出さない', async () => {
    const pc1 = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })
    const dgx = database.createHistorySource({
      provider: 'claude',
      name: 'DGX',
      root: secondFixture,
    })

    const result = await scanner.scanHistorySources(['claude'])
    const sessions = database.getUsageSessions()

    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: pc1.id, sourceName: 'PC1', status: 'complete' }),
        expect.objectContaining({ sourceId: dgx.id, sourceName: 'DGX', status: 'complete' }),
        expect.objectContaining({ sourceId: 'local-claude', status: 'complete' }),
      ]),
    )
    expect(sessions).toHaveLength(3)
    expect(new Set(sessions.map((session) => session.sourceId))).toEqual(
      new Set(['local-claude', pc1.id, dgx.id]),
    )
    expect(new Set(sessions.map((session) => session.sessionKey)).size).toBe(3)
    expect(new Set(sessions.map((session) => session.projectKey)).size).toBe(3)
    expect(JSON.stringify(result)).not.toContain(firstFixture)
    expect(JSON.stringify(result)).not.toContain(secondFixture)
    const remoteSession = sessions.find((session) => session.sourceId === pc1.id)!
    expect(
      database.getSessionReference('claude', remoteSession.sessionKey, remoteSession.sourceId),
    ).toBeUndefined()

    await scanner.scanHistorySources(['claude'])
    expect(database.getUsageSessions()).toHaveLength(3)

    database.saveConfiguration({
      charges: { claude: 30_000, codex: 0 },
      monthlyCharges: [],
      contracts: { claude: {}, codex: {} },
      unobservedRatio: 0,
    })
    const { buildDashboard } = await import('../../src/server/dashboard.ts')
    const dashboard = buildDashboard()
    expect(dashboard.meta.sessionCount).toBe(3)
    expect(dashboard.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(
      30_000,
    )
  })

  it('共有フォルダが利用不能になっても前回の取り込みを保持する', async () => {
    const source = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })
    await scanner.scanHistorySources(['claude'], [source.id])
    const before = database.getUsageSessions()
    expect(before).toHaveLength(1)

    rmSync(firstFixture, { recursive: true, force: true })
    const result = await scanner.scanHistorySources(['claude'], [source.id])

    expect(result.sources).toEqual([
      expect.objectContaining({ sourceId: source.id, status: 'unavailable', events: 0 }),
    ])
    expect(database.getUsageSessions()).toEqual(before)
    expect(database.getHistorySourceScanStatuses()).toContainEqual(
      expect.objectContaining({
        sourceId: source.id,
        status: 'unavailable',
        errorCode: 'not_found',
      }),
    )
  })

  it('正常に読める空フォルダは、その走査元だけを0件へ更新する', async () => {
    const source = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })
    await scanner.scanHistorySources(['claude'], [source.id])
    expect(database.getUsageSessions()).toHaveLength(1)

    rmSync(firstFixture, { recursive: true, force: true })
    mkdirSync(firstFixture, { recursive: true })
    const result = await scanner.scanHistorySources(['claude'], [source.id])

    expect(result.sources).toEqual([
      expect.objectContaining({ sourceId: source.id, status: 'complete', events: 0 }),
    ])
    expect(database.getUsageSessions()).toHaveLength(0)
  })

  it('不正JSONしかない未認識ファイルは失敗とし、前回の取り込みを保持する', async () => {
    const source = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })
    await scanner.scanHistorySources(['claude'], [source.id])
    const before = database.getUsageSessions()
    expect(before).toHaveLength(1)

    writeFileSync(join(firstFixture, 'synthetic-history.jsonl'), 'not valid json\n', 'utf8')
    const result = await scanner.scanHistorySources(['claude'], [source.id])

    expect(result.sources).toEqual([
      expect.objectContaining({ sourceId: source.id, status: 'failed', events: 0 }),
    ])
    expect(database.getUsageSessions()).toEqual(before)
  })

  it('既知形式のCodex履歴に壊れた行が混じっても、正常イベントを安全に取り込む', async () => {
    const codexFixture = join(root, 'pc1-codex')
    const codexHistory = join(codexFixture, '2026', '04')
    mkdirSync(codexHistory, { recursive: true })
    cpSync(
      resolve('fixtures/codex/2026/04/synthetic-session.jsonl'),
      join(codexHistory, 'synthetic-session.jsonl'),
    )
    const source = database.createHistorySource({
      provider: 'codex',
      name: 'PC1 Codex',
      root: codexFixture,
    })

    const result = await scanner.scanHistorySources(['codex'], [source.id])

    expect(result.sources).toEqual([
      expect.objectContaining({ sourceId: source.id, status: 'complete', events: 1 }),
    ])
    expect(result.sources[0]?.diagnostics).toMatchObject({
      malformedJsonLines: 1,
      incompatibleFiles: 0,
      invalidRecords: 0,
    })
    expect(database.getUsageSessions()).toHaveLength(1)
  })

  it('非空だが未対応レコードしかないスナップショットは前回の取り込みを保持する', async () => {
    const source = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })
    await scanner.scanHistorySources(['claude'], [source.id])
    const before = database.getUsageSessions()

    writeFileSync(
      join(firstFixture, 'synthetic-history.jsonl'),
      `${JSON.stringify({ type: 'future-provider-record', payload: { opaque: true } })}\n`,
      'utf8',
    )
    const result = await scanner.scanHistorySources(['claude'], [source.id])

    expect(result.sources[0]).toEqual(
      expect.objectContaining({ sourceId: source.id, status: 'failed', events: 0 }),
    )
    expect(database.getUsageSessions()).toEqual(before)
  })

  it('複数ファイルの一部だけが未対応形式に変わっても前回の完全な取り込みを保持する', async () => {
    const source = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })
    const firstHistory = join(firstFixture, 'synthetic-history.jsonl')
    const secondHistory = join(firstFixture, 'second-history.jsonl')
    writeFileSync(
      secondHistory,
      readFileSync(firstHistory, 'utf8')
        .replaceAll('synthetic-claude-session-1', 'synthetic-claude-session-2')
        .replaceAll('synthetic-message-1', 'synthetic-message-2')
        .replaceAll('Product-A', 'Product-B'),
      'utf8',
    )
    await scanner.scanHistorySources(['claude'], [source.id])
    const before = database.getUsageSessions()
    expect(before).toHaveLength(2)

    writeFileSync(
      secondHistory,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-13T01:02:03.000Z',
        cwd: '/home/alice/NewSchema',
        sessionId: 'future-session',
        message: {
          id: 'future-message',
          model: 'future-model',
          usage: { input_units: 100, output_units: 25 },
        },
      })}\n`,
      'utf8',
    )
    const result = await scanner.scanHistorySources(['claude'], [source.id])

    expect(result.sources[0]).toEqual(
      expect.objectContaining({ sourceId: source.id, status: 'failed', events: 0 }),
    )
    expect(database.getUsageSessions()).toEqual(before)
  })

  it('起動時走査と手動走査が重なっても、後の要求を直列に実行する', async () => {
    const pc1 = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })
    const dgx = database.createHistorySource({
      provider: 'claude',
      name: 'DGX',
      root: secondFixture,
    })

    const first = scanner.scanHistorySources(['claude'], [pc1.id])
    const second = scanner.scanHistorySources(['claude'], [dgx.id])
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult.sources.map((source) => source.sourceId)).toEqual([pc1.id])
    expect(secondResult.sources.map((source) => source.sourceId)).toEqual([dgx.id])
    expect(new Set(database.getUsageSessions().map((session) => session.sourceId))).toEqual(
      new Set([pc1.id, dgx.id]),
    )
  })

  it('走査中の削除要求を後ろに直列化し、削除後に古い走査が書き戻さない', async () => {
    const source = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })

    const scan = scanner.scanHistorySources(['claude'], [source.id])
    const removal = scanner.removeConfiguredHistorySource(source.id)
    await Promise.all([scan, removal])

    expect(database.getHistorySource(source.id)).toBeUndefined()
    expect(database.getUsageSessions()).toHaveLength(0)
  })

  it('走査中のroot変更と停止を後ろに直列化し、変更後に旧rootを書き戻さない', async () => {
    const source = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })

    const scan = scanner.scanHistorySources(['claude'], [source.id])
    const update = scanner.updateConfiguredHistorySource(source.id, {
      provider: 'claude',
      name: 'PC1 moved',
      root: secondFixture,
      enabled: false,
    })
    const [, updated] = await Promise.all([scan, update])

    expect(updated).toMatchObject({ root: secondFixture, enabled: false })
    expect(database.getUsageSessions()).toHaveLength(1)
    expect((await scanner.scanHistorySources(['claude'], [source.id])).sources).toEqual([])
    expect(database.getUsageSessions()).toHaveLength(1)
  })

  it('設定した読み取り元だけを削除し、元フォルダには書き込まない', async () => {
    const pc1 = database.createHistorySource({
      provider: 'claude',
      name: 'PC1',
      root: firstFixture,
    })
    const dgx = database.createHistorySource({
      provider: 'claude',
      name: 'DGX',
      root: secondFixture,
    })
    await scanner.scanHistorySources(['claude'], [pc1.id, dgx.id])

    database.removeHistorySource(dgx.id)

    expect(database.getUsageSessions()).toHaveLength(1)
    expect(database.getUsageSessions()[0]?.sourceId).toBe(pc1.id)
    expect(database.getHistorySource(dgx.id)).toBeUndefined()
    expect(
      await scanner.testHistorySource({
        provider: 'claude',
        name: 'DGX',
        root: secondFixture,
      }),
    ).toEqual(expect.objectContaining({ availability: 'available', filesDiscovered: 1 }))
  })
})
