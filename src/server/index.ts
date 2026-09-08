import { existsSync } from 'node:fs'
import { datasetIdentity } from './datasetIdentity.js'
import { previewRestoreSources, RestoreSourceConflict } from './restoreSources.js'
import { registerBalanceRoutes } from './balanceRoutes.js'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerStaticFiles } from './staticFiles.js'
import { configurationSchema } from './configurationSchema.js'
import Fastify, { type FastifyReply } from 'fastify'
import { z } from 'zod'
import { localDateFromTimestamp } from '../adapters/localTime.js'
import {
  getConfiguration,
  getDatabase,
  getHistorySources,
  HistorySourceError,
  saveConfiguration,
} from './database.js'
import { buildDashboard } from './dashboard.js'
import { diagnosePlanning } from '../core/diagnosis.js'
import {
  readWorkspace,
  saveWorkspace,
  workspaceSaveSchema,
  WorkspaceConflict,
  WorkspaceRequestReuse,
} from './workspaceRepository.js'
import type { WorkspaceDraft } from '../planning/workspace.js'
import {
  previewWorkspace,
  workspacePreviewSchema,
  verifyWorkspacePreview,
  WorkspacePreviewChanged,
  WorkspacePreviewRangeError,
} from './workspaceImpact.js'
import {
  getClaudeSettingsPath,
  getAppDataDirectory,
  getDefaultHistoryPaths,
  normalizeHistoryRoot,
  restoreRequiresReconnect,
} from './paths.js'
import {
  forecastNextLoss,
  readCleanupPeriod,
  readHistoryAgeCached,
  writeCleanupPeriod,
} from './retention.js'
import { readScanProgress } from './scanProgress.js'
import { createLoopbackHostGuard, csrfToken, protectMutation } from './security.js'
import {
  automaticSourceScanEnabled,
  reconnectRestoredSources,
  createConfiguredHistorySource,
  listHistorySourceViews,
  removeConfiguredHistorySource,
  scanHistorySources,
  testHistorySource,
  updateConfiguredHistorySource,
} from './historySources.js'

const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 4317)
let startupScanPending = automaticSourceScanEnabled()
const app = Fastify({
  logger: true,
  bodyLimit: 64 * 1024,
})

app.addHook('preHandler', createLoopbackHostGuard(port))
app.addHook('preHandler', protectMutation)
registerBalanceRoutes(app, getDatabase)

app.get('/api/health', async () => ({
  ok: true,
  service: 'devtax-radar',
}))

app.get('/api/runtime', async () => {
  const historyPaths = getDefaultHistoryPaths()
  const historySources = getHistorySources()
  const today = localDateFromTimestamp(new Date().toISOString()) ?? ''

  const claudeAge = readHistoryAgeCached(historyPaths.claude)
  const claudePeriod = readCleanupPeriod(getClaudeSettingsPath())
  const claudeForecast = forecastNextLoss(claudeAge, claudePeriod, today)

  // Codex has no retention setting today (see the note in paths.ts). Report
  // the age anyway so the screen keeps showing it if one ever lands.
  const codexAge = readHistoryAgeCached(historyPaths.codex)

  return {
    csrfToken,
    datasetId: datasetIdentity(getDatabase()),
    restoreRequiresReconnect: restoreRequiresReconnect(),
    providers: {
      claude: {
        detected: historySources.some(
          (source) =>
            source.enabled &&
            source.provider === 'claude' &&
            (source.kind === 'configured' || existsSync(source.root)),
        ),
      },
      codex: {
        detected: historySources.some(
          (source) =>
            source.enabled &&
            source.provider === 'codex' &&
            (source.kind === 'configured' || existsSync(source.root)),
        ),
      },
    },
    retention: {
      claude: {
        detected: existsSync(historyPaths.claude),
        fileCount: claudeAge.fileCount,
        oldestModifiedOn: claudeAge.oldestModifiedOn,
        autoDelete:
          claudePeriod.status === 'unreadable'
            ? { kind: 'unreadable' as const, reason: claudePeriod.reason }
            : { kind: 'configured' as const, days: claudePeriod.days, source: claudePeriod.status },
        nextLossOn: claudeForecast.nextLossOn,
        daysUntilNextLoss: claudeForecast.daysUntilNextLoss,
        alreadyLosing: claudeForecast.alreadyLosing,
      },
      codex: {
        detected: existsSync(historyPaths.codex),
        fileCount: codexAge.fileCount,
        oldestModifiedOn: codexAge.oldestModifiedOn,
        autoDelete: { kind: 'none' as const },
        alreadyLosing: false,
      },
    },
    privacy: {
      localOnly: true,
      promptBodiesPersisted: false,
      localPromptPreviewOnDemand: true,
      configuredPromptPreview: false,
      telemetry: false,
    },
  }
})

app.get('/api/dashboard', async () => {
  return buildDashboard()
})

app.get('/api/projections', async (request, reply) => {
  const query = z
    .object({ year: z.coerce.number().int().min(1900).max(9999).optional() })
    .strict()
    .safeParse(request.query)
  if (!query.success)
    return reply.code(400).send({ error: 'invalid_request', message: '対象年を確認してください。' })
  return buildDashboard(query.data.year).costProjection
})

app.get('/api/folders', async () => {
  const { buildFolderSummaries } = await import('./folders.js')
  return { folders: buildFolderSummaries() }
})

app.get('/api/sessions', async (request, reply) => {
  const parsed = z.object({ projectKey: z.string().min(1).max(120) }).safeParse(request.query)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }
  const { getSessionsForProject } = await import('./database.js')
  const sessions = getSessionsForProject(parsed.data.projectKey).map((session) => ({
    sourceId: session.sourceId,
    sourceName: session.sourceName,
    provider: session.provider,
    sessionKey: session.sessionKey,
    month: session.month,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messageCount: session.messageCount,
    model: session.model,
    weightedTokens:
      session.inputTokens +
      session.outputTokens +
      session.cacheReadTokens +
      session.cacheWriteTokens,
    localDetailAvailable: session.sourceId === `local-${session.provider}`,
  }))
  return { sessions }
})

app.get('/api/sessions/detail', async (request, reply) => {
  const parsed = z
    .object({
      provider: z.enum(['claude', 'codex']),
      sessionKey: z.string().min(1).max(120),
      sourceId: z.string().min(1).max(120).optional(),
    })
    .safeParse(request.query)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }

  const [{ getSessionReference }, { buildResumeCommand, readSessionPreview }] = await Promise.all([
    import('./database.js'),
    import('./sessionPreview.js'),
  ])
  const localSourceId = `local-${parsed.data.provider}`
  const requestedSourceId = parsed.data.sourceId ?? localSourceId
  if (requestedSourceId !== localSourceId) {
    return { available: false }
  }
  const reference = getSessionReference(parsed.data.provider, parsed.data.sessionKey, localSourceId)
  if (!reference) {
    return { available: false }
  }

  const transcriptExists = existsSync(reference.sourcePath)
  return {
    available: true,
    transcriptExists,
    preview: transcriptExists
      ? await readSessionPreview(reference.sourcePath, parsed.data.provider)
      : undefined,
    resume: buildResumeCommand(
      parsed.data.provider,
      reference.nativeSessionId,
      reference.workingDirectory,
      existsSync(reference.workingDirectory),
    ),
  }
})

app.get('/api/config', async () => getConfiguration())

const historySourceInputSchema = z
  .object({
    provider: z.enum(['claude', 'codex']),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (name) =>
          !/[\\/]/.test(name) &&
          [...name].every((character) => {
            const code = character.charCodeAt(0)
            return code >= 32 && code !== 127
          }),
        {
          message: '表示名にはパス区切りや制御文字を含められません。',
        },
      ),
    root: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .refine(
        (root) => {
          try {
            normalizeHistoryRoot(root)
            return true
          } catch {
            return false
          }
        },
        { message: '履歴フォルダには絶対パスを指定してください。' },
      ),
    enabled: z.boolean().optional(),
  })
  .strict()

const historySourceParamsSchema = z
  .object({ id: z.union([z.string().uuid(), z.enum(['local-claude', 'local-codex'])]) })
  .strict()

async function sendHistorySourceError(error: unknown, reply: FastifyReply): Promise<void> {
  if (error instanceof HistorySourceError) {
    await reply.code(error.code === 'not_found' ? 404 : 409).send({
      error: error.code,
      message: error.message,
    })
    return
  }
  throw error
}

app.get('/api/sources', async () => ({ sources: await listHistorySourceViews() }))

app.post('/api/sources/test', async (request, reply) => {
  const parsed = historySourceInputSchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }
  return await testHistorySource(parsed.data)
})

app.post('/api/sources', async (request, reply) => {
  const parsed = historySourceInputSchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }
  try {
    const created = await createConfiguredHistorySource(parsed.data)
    return { saved: true as const, sourceId: created.id }
  } catch (error) {
    await sendHistorySourceError(error, reply)
  }
})

app.patch('/api/sources/:id', async (request, reply) => {
  const parameters = historySourceParamsSchema.safeParse(request.params)
  const input = historySourceInputSchema.safeParse(request.body)
  if (!parameters.success || !input.success) {
    await reply.code(400).send({ error: 'invalid_request' })
    return
  }
  try {
    const updated = await updateConfiguredHistorySource(parameters.data.id, input.data)
    return { saved: true as const, sourceId: updated.id }
  } catch (error) {
    await sendHistorySourceError(error, reply)
  }
})

app.delete('/api/sources/:id', async (request, reply) => {
  const parsed = historySourceParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request' })
    return
  }
  try {
    await removeConfiguredHistorySource(parsed.data.id)
    return { removed: true as const }
  } catch (error) {
    await sendHistorySourceError(error, reply)
  }
})

function workspaceView(draft: WorkspaceDraft) {
  return { ...draft, dashboard: buildDashboard(), diagnosis: diagnosePlanning(draft.planning) }
}

app.get('/api/workspace', async () => readWorkspace(workspaceView))

app.post('/api/workspace/preview', async (request, reply) => {
  const parsed = workspacePreviewSchema.safeParse(request.body)
  if (!parsed.success)
    return reply.code(400).send({
      error: 'invalid_request',
      message: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' / '),
    })
  try {
    return previewWorkspace(parsed.data)
  } catch (error) {
    if (error instanceof WorkspaceConflict)
      return reply.code(409).send({
        error: 'workspace_conflict',
        message: error.message,
        currentRevision: error.currentRevision,
      })
    if (error instanceof WorkspacePreviewRangeError)
      return reply.code(400).send({ error: 'preview_range', message: error.message })
    throw error
  }
})

app.put('/api/workspace', async (request, reply) => {
  const parsed = workspaceSaveSchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(400).send({
      error: 'invalid_request',
      message: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' / '),
    })
  }
  try {
    return saveWorkspace(parsed.data, workspaceView, getDatabase(), verifyWorkspacePreview)
  } catch (error) {
    if (error instanceof WorkspacePreviewChanged)
      return reply.code(409).send({ error: 'preview_changed', message: error.message })
    if (error instanceof WorkspacePreviewRangeError)
      return reply.code(400).send({ error: 'preview_range', message: error.message })
    if (error instanceof WorkspaceConflict)
      return reply.code(409).send({
        error: 'workspace_conflict',
        message: error.message,
        currentRevision: error.currentRevision,
      })
    if (error instanceof WorkspaceRequestReuse)
      return reply.code(400).send({ error: 'request_reuse', message: error.message })
    throw error
  }
})

app.get('/api/planning', async () => {
  const { getPlanningSnapshot } = await import('./planningRepository.js')
  return getPlanningSnapshot()
})

app.put('/api/planning', async (request, reply) => {
  const { planningSaveSchema, savePlanningSnapshot } = await import('./planningRepository.js')
  const parsed = planningSaveSchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.code(400).send({
      error: 'invalid_request',
      details: parsed.error.flatten(),
    })
    return
  }
  savePlanningSnapshot(parsed.data)
  return { saved: true }
})

app.put('/api/planning/rules', async (request, reply) => {
  const { projectRulesSchema, replaceProjectRules, PlanningValidationError } =
    await import('./planningRepository.js')
  const parsed = projectRulesSchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }
  try {
    replaceProjectRules(parsed.data.rules)
  } catch (error) {
    const message =
      error instanceof PlanningValidationError ? error.message : 'ルールを保存できませんでした。'
    await reply.code(400).send({
      error: 'invalid_request',
      message,
    })
    return
  }
  return { saved: true }
})

app.get('/api/diagnosis', async () => {
  const [{ diagnosePlanning }, { getPlanningSnapshot }] = await Promise.all([
    import('../core/index.js'),
    import('./planningRepository.js'),
  ])
  return diagnosePlanning(getPlanningSnapshot())
})

app.get('/api/ledger', async () => {
  return buildDashboard().costProjection
})

app.get('/api/export', async (request, reply) => {
  const parsed = z.object({ format: z.literal('markdown') }).safeParse(request.query)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }
  const [
    { diagnosePlanning },
    { getPlanningSnapshot, planningMarkdown },
    { costProjectionMarkdown },
  ] = await Promise.all([
    import('../core/index.js'),
    import('./planningRepository.js'),
    import('../core/costExport.js'),
  ])
  const db = getDatabase()
  db.exec('SAVEPOINT devtax_export_read')
  let markdown: string
  try {
    const snapshot = getPlanningSnapshot()
    markdown =
      planningMarkdown(snapshot, diagnosePlanning(snapshot)) +
      '\n' +
      costProjectionMarkdown(buildDashboard().costProjection!)
    db.exec('RELEASE devtax_export_read')
  } catch (error) {
    db.exec('ROLLBACK TO devtax_export_read')
    db.exec('RELEASE devtax_export_read')
    throw error
  }
  await reply.type('text/markdown; charset=utf-8').send(markdown)
})

app.post('/api/config', async (request, reply) => {
  const parsed = configurationSchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.code(400).send({
      error: 'invalid_request',
      details: parsed.error.flatten(),
    })
    return
  }
  saveConfiguration(parsed.data)
  return { saved: true }
})

const retentionRequestSchema = z
  .object({
    // No upper bound suggestion is offered by the product: the right length
    // depends on the user's bookkeeping, not on anything we can infer.
    days: z.number().int().min(1).max(36500),
  })
  .strict()

app.post('/api/retention', async (request, reply) => {
  const parsed = retentionRequestSchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }

  // Milliseconds included and the trailing Z kept, so two writes a moment
  // apart get distinct backups and the timestamp reads unambiguously as UTC.
  const suffix = new Date().toISOString().replace(/[-:.]/g, '')
  const result = writeCleanupPeriod(getClaudeSettingsPath(), parsed.data.days, suffix)

  if (!result.ok) {
    await reply.code(409).send({ error: 'retention_write_failed', message: result.reason })
    return
  }
  // backupFileName is a file name, never a path. The screen tells the user the
  // backup sits beside their settings file; it must not print where that is.
  return {
    saved: true,
    days: result.days,
    previousDays: result.previousDays,
    backupFileName: result.backupFileName,
  }
})

app.get('/api/restore/sources', async (_request, reply) => {
  try {
    return previewRestoreSources(getDatabase(), getAppDataDirectory())
  } catch (error) {
    if (error instanceof RestoreSourceConflict)
      return reply.code(409).send({ error: 'restore_conflict', message: error.message })
    throw error
  }
})
app.post('/api/restore/sources', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
  try {
    return await reconnectRestoredSources(request.body)
  } catch (error) {
    return reply.code(error instanceof RestoreSourceConflict ? 409 : 400).send({
      error: error instanceof RestoreSourceConflict ? 'restore_conflict' : 'invalid_reconnect',
      message:
        error instanceof z.ZodError
          ? '再接続の入力形式を確認してください。'
          : error instanceof Error
            ? error.message
            : '再接続できませんでした。',
    })
  }
})

const scanRequestSchema = z.object({
  providers: z
    .array(z.enum(['claude', 'codex']))
    .min(1)
    .default(['claude', 'codex']),
  mode: z.enum(['incremental', 'full']).default('incremental'),
})

app.get('/api/scan/progress', async () => ({
  ...readScanProgress(),
  startupPending: startupScanPending,
}))

app.post('/api/scan', async (request, reply) => {
  if (restoreRequiresReconnect())
    return reply.code(409).send({
      error: 'restore_requires_reconnect',
      message:
        '復元した資料の読み取り元を再接続するまで走査できません。保存済み資料は確認できます。',
    })
  const parsed = scanRequestSchema.safeParse(request.body ?? {})
  if (!parsed.success) {
    await reply.code(400).send({
      error: 'invalid_request',
      details: parsed.error.flatten(),
    })
    return
  }

  return await scanHistorySources(parsed.data.providers, undefined, parsed.data.mode)
})

const moduleDirectory = fileURLToPath(new URL('.', import.meta.url))
const distDirectory = join(moduleDirectory, '..', '..', 'dist')

if (existsSync(distDirectory)) {
  await registerStaticFiles(app, distDirectory)
}

try {
  getDatabase()
  await app.listen({ host, port })
  if (startupScanPending) {
    void scanHistorySources()
      .catch(() => {
        app.log.error('Configured history sources could not be scanned at startup.')
      })
      .finally(() => {
        startupScanPending = false
      })
  }
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
