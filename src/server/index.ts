import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
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
import { getClaudeSettingsPath, getDefaultHistoryPaths, normalizeHistoryRoot } from './paths.js'
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

app.get('/api/planning', async () => {
  const { getPlanningSnapshot } = await import('./planningRepository.js')
  return getPlanningSnapshot()
})

app.put('/api/planning', async (request, reply) => {
  const { planningSnapshotSchema, savePlanningSnapshot } = await import('./planningRepository.js')
  const parsed = planningSnapshotSchema.safeParse(request.body)
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
  const [{ buildPlanningLedger }, { getPlanningSnapshot }] = await Promise.all([
    import('../core/index.js'),
    import('./planningRepository.js'),
  ])
  return buildPlanningLedger(getPlanningSnapshot())
})

app.get('/api/export', async (request, reply) => {
  const parsed = z.object({ format: z.literal('markdown') }).safeParse(request.query)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }
  const [{ buildPlanningLedger, diagnosePlanning }, { getPlanningSnapshot, planningMarkdown }] =
    await Promise.all([import('../core/index.js'), import('./planningRepository.js')])
  const snapshot = getPlanningSnapshot()
  await reply
    .type('text/markdown; charset=utf-8')
    .send(planningMarkdown(snapshot, diagnosePlanning(snapshot), buildPlanningLedger(snapshot)))
})

const contractDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
  message: '日付は YYYY-MM-DD で入力してください。',
})

const providerContractSchema = z
  .object({
    startedOn: contractDateSchema.optional(),
    endedOn: contractDateSchema.optional(),
  })
  .strict()
  .refine(
    (contract) =>
      !contract.startedOn || !contract.endedOn || contract.startedOn <= contract.endedOn,
    { message: '契約終了日は開始日以降にしてください。' },
  )

const configurationSchema = z
  .object({
    charges: z.object({
      claude: z.number().int().nonnegative(),
      codex: z.number().int().nonnegative(),
    }),
    monthlyCharges: z
      .array(
        z.object({
          provider: z.enum(['claude', 'codex']),
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          amountJpy: z.number().int().nonnegative(),
        }),
      )
      .max(240)
      .default([]),
    contracts: z
      .object({
        claude: providerContractSchema,
        codex: providerContractSchema,
      })
      .strict()
      .default({ claude: {}, codex: {} }),
    unobservedRatio: z.number().min(0).max(0.95),
  })
  .strict()
  .superRefine((configuration, context) => {
    const chargeKeys = new Set<string>()
    configuration.monthlyCharges.forEach((charge, index) => {
      const key = `${charge.provider}:${charge.month}`
      if (chargeKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['monthlyCharges', index],
          message: 'Providerと月の組合せが重複しています。',
        })
      }
      chargeKeys.add(key)
    })
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

const scanRequestSchema = z.object({
  providers: z
    .array(z.enum(['claude', 'codex']))
    .min(1)
    .default(['claude', 'codex']),
})

app.get('/api/scan/progress', async () => ({
  ...readScanProgress(),
  startupPending: startupScanPending,
}))

app.post('/api/scan', async (request, reply) => {
  const parsed = scanRequestSchema.safeParse(request.body ?? {})
  if (!parsed.success) {
    await reply.code(400).send({
      error: 'invalid_request',
      details: parsed.error.flatten(),
    })
    return
  }

  return await scanHistorySources(parsed.data.providers)
})

const moduleDirectory = fileURLToPath(new URL('.', import.meta.url))
const distDirectory = join(moduleDirectory, '..', '..', 'dist')

if (existsSync(distDirectory)) {
  await app.register(fastifyStatic, {
    root: distDirectory,
    wildcard: false,
  })
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      await reply.code(404).send({ error: 'not_found' })
      return
    }
    await reply.sendFile('index.html')
  })
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
