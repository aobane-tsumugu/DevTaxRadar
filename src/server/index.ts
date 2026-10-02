import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyReply } from 'fastify'
import { z } from 'zod'
import { registerObservationRoutes } from './observationRoutes.js'
import { datasetIdentity } from './datasetIdentity.js'
import {
  createDataBundle,
  databaseSchemaHash,
  restoreDataBundle,
  verifyDataBundle,
} from './dataBundle.js'
import { previewRestoreSources, RestoreSourceConflict } from './restoreSources.js'
import { registerBalanceRoutes } from './balanceRoutes.js'
import { registerStaticFiles } from './staticFiles.js'
import { workspaceRequestOptions } from './workspaceHttp.js'
import { localDateFromTimestamp } from '../adapters/localTime.js'
import { getConfiguration, getDatabase, getHistorySources, HistorySourceError } from './database.js'
import { buildDashboard, readDashboardObservation, projectWorkspaceYears } from './dashboard.js'
import { diagnosePlanning } from '../core/diagnosis.js'
import { planningMarkdown } from '../core/planningExport.js'
import { costProjectionMarkdown } from '../core/costExport.js'
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
  getIdentifierSalt,
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
const app = Fastify({ logger: true, bodyLimit: 64 * 1024 })
app.addHook('preHandler', createLoopbackHostGuard(port))
app.addHook('preHandler', protectMutation)
registerBalanceRoutes(app, getDatabase)
registerObservationRoutes(app, getDatabase)

app.get('/api/health', async () => ({ ok: true, service: 'devtax-radar' }))
app.get('/api/runtime', async () => {
  const paths = getDefaultHistoryPaths(),
    sources = getHistorySources()
  const today = localDateFromTimestamp(new Date().toISOString()) ?? ''
  const claudeAge = readHistoryAgeCached(paths.claude)
  const claudePeriod = readCleanupPeriod(getClaudeSettingsPath())
  const forecast = forecastNextLoss(claudeAge, claudePeriod, today)
  const codexAge = readHistoryAgeCached(paths.codex)
  const detected = (provider: 'claude' | 'codex') =>
    sources.some(
      (source) =>
        source.enabled &&
        source.provider === provider &&
        (source.kind === 'configured' || existsSync(source.root)),
    )
  return {
    csrfToken,
    datasetId: datasetIdentity(getDatabase()),
    restoreRequiresReconnect: restoreRequiresReconnect(),
    providers: { claude: { detected: detected('claude') }, codex: { detected: detected('codex') } },
    retention: {
      claude: {
        detected: existsSync(paths.claude),
        fileCount: claudeAge.fileCount,
        oldestModifiedOn: claudeAge.oldestModifiedOn,
        autoDelete:
          claudePeriod.status === 'unreadable'
            ? { kind: 'unreadable' as const, reason: claudePeriod.reason }
            : { kind: 'configured' as const, days: claudePeriod.days, source: claudePeriod.status },
        nextLossOn: forecast.nextLossOn,
        daysUntilNextLoss: forecast.daysUntilNextLoss,
        alreadyLosing: forecast.alreadyLosing,
      },
      codex: {
        detected: existsSync(paths.codex),
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

const projectionQuery = z
  .object({ year: z.coerce.number().int().min(1900).max(9999).optional() })
  .strict()
app.get('/api/dashboard', async (request, reply) => {
  const query = projectionQuery.safeParse(request.query)
  if (!query.success)
    return reply.code(400).send({ error: 'invalid_request', message: '対象年を確認してください。' })
  return buildDashboard(query.data.year)
})
app.get('/api/projections', async (request, reply) => {
  const query = projectionQuery.safeParse(request.query)
  if (!query.success)
    return reply.code(400).send({ error: 'invalid_request', message: '対象年を確認してください。' })
  return buildDashboard(query.data.year).costProjection
})
// Read-only migration alias. No second calculation or independent writer.
app.get('/api/ledger', async (request, reply) => {
  const query = projectionQuery.safeParse(request.query)
  if (!query.success) return reply.code(400).send({ error: 'invalid_request' })
  return reply.redirect(
    '/api/projections' + (query.data.year === undefined ? '' : '?year=' + query.data.year),
    308,
  )
})
app.get('/api/folders', async () => {
  const { buildFolderSummaries } = await import('./folders.js')
  return { folders: buildFolderSummaries() }
})
app.get('/api/sessions', async (request, reply) => {
  const parsed = z.object({ projectKey: z.string().min(1).max(120) }).safeParse(request.query)
  if (!parsed.success)
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
  const { getSessionsForProject } = await import('./database.js')
  return {
    sessions: getSessionsForProject(parsed.data.projectKey).map((session) => ({
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
    })),
  }
})
app.get('/api/sessions/detail', async (request, reply) => {
  const parsed = z
    .object({
      provider: z.enum(['claude', 'codex']),
      sessionKey: z.string().min(1).max(120),
      sourceId: z.string().min(1).max(120).optional(),
    })
    .safeParse(request.query)
  if (!parsed.success)
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
  const localSourceId = `local-${parsed.data.provider}`
  if ((parsed.data.sourceId ?? localSourceId) !== localSourceId) return { available: false }
  const [{ getSessionReference }, { buildResumeCommand, readSessionPreview }] = await Promise.all([
    import('./database.js'),
    import('./sessionPreview.js'),
  ])
  const reference = getSessionReference(parsed.data.provider, parsed.data.sessionKey, localSourceId)
  if (!reference) return { available: false }
  const transcriptExists = existsSync(reference.sourcePath)
  return {
    available: true,
    transcriptExists,
    preview: transcriptExists
      ? await readSessionPreview(reference.sourcePath, parsed.data.provider)
      : undefined,
    resume: transcriptExists
      ? buildResumeCommand(
          parsed.data.provider,
          reference.nativeSessionId,
          reference.workingDirectory,
          existsSync(reference.workingDirectory),
        )
      : undefined,
  }
})
app.get('/api/config', async () => getConfiguration())

const transferPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => isAbsolute(value), {
    message: '絶対パスを指定してください。',
  })
const insideOrSame = (root: string, candidate: string) => {
  const result = relative(resolve(root), resolve(candidate))
  return result === '' || (result !== '..' && !result.startsWith('..' + sep) && !isAbsolute(result))
}
function transferError(error: unknown, reply: FastifyReply) {
  return reply.code(409).send({
    error: 'data_transfer_failed',
    message: error instanceof Error ? error.message : 'PC移行用データを処理できませんでした。',
  })
}
app.post('/api/data-transfer/backup', async (request, reply) => {
  const parsed = z.object({ destination: transferPathSchema }).strict().safeParse(request.body)
  if (!parsed.success)
    return reply
      .code(400)
      .send({ error: 'invalid_request', message: 'バックアップ先の絶対パスを確認してください。' })
  const dataDirectory = getAppDataDirectory()
  if (insideOrSame(dataDirectory, parsed.data.destination))
    return reply.code(400).send({
      error: 'invalid_destination',
      message: '現在のDevTaxデータフォルダの外に、新しいバックアップ先を指定してください。',
    })
  try {
    // The salt is otherwise created by the first history scan; a PC that never scanned can still move.
    getIdentifierSalt()
    const manifest = createDataBundle(dataDirectory, parsed.data.destination)
    return {
      created: true as const,
      destination: resolve(parsed.data.destination),
      manifest: {
        createdAt: manifest.createdAt,
        schemaHash: manifest.schemaHash,
        files: manifest.files,
      },
    }
  } catch (error) {
    return transferError(error, reply)
  }
})
app.post('/api/data-transfer/verify', async (request, reply) => {
  const parsed = z.object({ bundle: transferPathSchema }).strict().safeParse(request.body)
  if (!parsed.success)
    return reply.code(400).send({
      error: 'invalid_request',
      message: 'バックアップフォルダの絶対パスを確認してください。',
    })
  try {
    const manifest = verifyDataBundle(parsed.data.bundle)
    return {
      valid: true as const,
      bundle: resolve(parsed.data.bundle),
      manifest: {
        createdAt: manifest.createdAt,
        schemaHash: manifest.schemaHash,
        files: manifest.files,
      },
    }
  } catch (error) {
    return transferError(error, reply)
  }
})
app.post('/api/data-transfer/restore', async (request, reply) => {
  const parsed = z
    .object({ bundle: transferPathSchema, destination: transferPathSchema })
    .strict()
    .safeParse(request.body)
  if (!parsed.success)
    return reply.code(400).send({
      error: 'invalid_request',
      message: 'バックアップ元と新しい復元先の絶対パスを確認してください。',
    })
  const dataDirectory = getAppDataDirectory()
  if (insideOrSame(dataDirectory, parsed.data.destination))
    return reply.code(400).send({
      error: 'invalid_destination',
      message: '現在のDevTaxデータフォルダとは別の、新しい復元先を指定してください。',
    })
  if (insideOrSame(parsed.data.bundle, parsed.data.destination))
    return reply.code(400).send({
      error: 'invalid_destination',
      message: 'バックアップフォルダの外に、新しい復元先を指定してください。',
    })
  try {
    const manifest = restoreDataBundle(
      parsed.data.bundle,
      parsed.data.destination,
      databaseSchemaHash(getDatabase()),
    )
    return {
      restored: true as const,
      destination: resolve(parsed.data.destination),
      bundleCreatedAt: manifest.createdAt,
      requiresRestart: true as const,
      message:
        '復元先を作成しました。現在のDevTaxはそのままです。DevTaxを終了し、復元先をデータフォルダに指定して起動してください。',
    }
  } catch (error) {
    return transferError(error, reply)
  }
})

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
          [...name].every(
            (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        { message: '表示名にはパス区切りや制御文字を含められません。' },
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
  .object({
    id: z.union([z.string().uuid(), z.enum(['local-claude', 'local-codex'])]),
  })
  .strict()
function sendHistorySourceError(error: unknown, reply: FastifyReply) {
  if (error instanceof HistorySourceError)
    return reply
      .code(error.code === 'not_found' ? 404 : 409)
      .send({ error: error.code, message: error.message })
  throw error
}
app.get('/api/sources', async () => ({ sources: await listHistorySourceViews() }))
app.post('/api/sources/test', async (request, reply) => {
  const parsed = historySourceInputSchema.safeParse(request.body)
  if (!parsed.success)
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
  return testHistorySource(parsed.data)
})
app.post('/api/sources', async (request, reply) => {
  const parsed = historySourceInputSchema.safeParse(request.body)
  if (!parsed.success)
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
  try {
    return { saved: true as const, sourceId: (await createConfiguredHistorySource(parsed.data)).id }
  } catch (error) {
    return sendHistorySourceError(error, reply)
  }
})
app.patch('/api/sources/:id', async (request, reply) => {
  const params = historySourceParamsSchema.safeParse(request.params),
    input = historySourceInputSchema.safeParse(request.body)
  if (!params.success || !input.success) return reply.code(400).send({ error: 'invalid_request' })
  try {
    return {
      saved: true as const,
      sourceId: (await updateConfiguredHistorySource(params.data.id, input.data)).id,
    }
  } catch (error) {
    return sendHistorySourceError(error, reply)
  }
})
app.delete('/api/sources/:id', async (request, reply) => {
  const parsed = historySourceParamsSchema.safeParse(request.params)
  if (!parsed.success)
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
  try {
    await removeConfiguredHistorySource(parsed.data.id)
    return { removed: true as const }
  } catch (error) {
    return sendHistorySourceError(error, reply)
  }
})

function workspaceView(draft: WorkspaceDraft) {
  const observation = readDashboardObservation()
  const dashboard = projectWorkspaceYears(draft, observation, []).dashboard
  return {
    ...draft,
    dashboard,
    diagnosis: diagnosePlanning(draft.planning, {
      hasRelevantAiUsage: observation.sessions.some((row) =>
        row.month.startsWith(`${draft.planning.profile.taxYear}-`),
      ),
    }),
  }
}
function sendWorkspaceError(error: unknown, reply: FastifyReply) {
  if (error instanceof WorkspaceConflict)
    return reply.code(409).send({
      error: 'workspace_conflict',
      message: error.message,
      currentRevision: error.currentRevision,
    })
  if (error instanceof WorkspacePreviewChanged)
    return reply.code(409).send({ error: 'preview_changed', message: error.message })
  if (error instanceof WorkspacePreviewRangeError)
    return reply.code(400).send({ error: 'preview_range', message: error.message })
  if (error instanceof WorkspaceRequestReuse)
    return reply.code(400).send({ error: 'request_reuse', message: error.message })
  throw error
}
app.get('/api/workspace', async () => readWorkspace(workspaceView))
app.post('/api/workspace/preview', workspaceRequestOptions, async (request, reply) => {
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
    return sendWorkspaceError(error, reply)
  }
})
app.put('/api/workspace', workspaceRequestOptions, async (request, reply) => {
  const parsed = workspaceSaveSchema.safeParse(request.body)
  if (!parsed.success)
    return reply.code(400).send({
      error: 'invalid_request',
      message: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' / '),
    })
  try {
    return saveWorkspace(parsed.data, workspaceView, getDatabase(), verifyWorkspacePreview)
  } catch (error) {
    return sendWorkspaceError(error, reply)
  }
})
// Existing read formats stay readable. There is no unversioned planning/config writer.
app.get('/api/planning', async () => {
  const { getPlanningSnapshot } = await import('./planningRepository.js')
  return getPlanningSnapshot()
})
app.get('/api/diagnosis', async () => readWorkspace((draft) => workspaceView(draft).diagnosis))
app.get('/api/export', async (request, reply) => {
  const parsed = z
    .object({ format: z.enum(['markdown', 'json']) })
    .strict()
    .safeParse(request.query)
  if (!parsed.success)
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
  const result = readWorkspace((draft) => {
    const view = workspaceView(draft)
    const planning = {
      ...draft.planning,
      evidence: draft.planning.evidence.map(
        ({ localReference: _localReference, ...record }) => record,
      ),
    }
    return {
      format: 'devtax-workspace-export',
      version: 1,
      kind: 'saved-workspace-not-adopted',
      workspaceRevision: draft.revision,
      year: draft.planning.profile.taxYear,
      configuration: draft.configuration,
      planning,
      costs: view.dashboard.costProjection,
      diagnosis: view.diagnosis,
      markdown:
        `保存済み入力の版: ${draft.revision}\n\n` +
        planningMarkdown(planning, view.diagnosis) +
        '\n' +
        costProjectionMarkdown(view.dashboard.costProjection!),
    }
  })
  reply.header('Cache-Control', 'no-store')
  if (parsed.data.format === 'json') {
    const { markdown: _markdown, ...record } = result
    return reply.type('application/json; charset=utf-8').send(record)
  }
  return reply.type('text/markdown; charset=utf-8').send(result.markdown)
})

const retentionRequestSchema = z.object({ days: z.number().int().min(1).max(36500) }).strict()
app.post('/api/retention', async (request, reply) => {
  const parsed = retentionRequestSchema.safeParse(request.body)
  if (!parsed.success)
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
  const suffix = new Date().toISOString().replace(/[-:.]/g, '')
  const result = writeCleanupPeriod(getClaudeSettingsPath(), parsed.data.days, suffix)
  if (!result.ok)
    return reply.code(409).send({ error: 'retention_write_failed', message: result.reason })
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
  if (!parsed.success)
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
  return scanHistorySources(parsed.data.providers, undefined, parsed.data.mode)
})
const moduleDirectory = fileURLToPath(new URL('.', import.meta.url))
const distDirectory = join(moduleDirectory, '..', '..', 'dist')
if (existsSync(distDirectory)) await registerStaticFiles(app, distDirectory)
try {
  getDatabase()
  await app.listen({ host, port })
  if (startupScanPending)
    void scanHistorySources()
      .catch(() => {
        app.log.error('Configured history sources could not be scanned at startup.')
      })
      .finally(() => {
        startupScanPending = false
      })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
