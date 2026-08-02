import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { z } from 'zod'
import { readClaudeHistory, readCodexHistory } from '../adapters/index.ts'
import { localDateFromTimestamp } from '../adapters/localTime.js'
import { getConfiguration, replaceProviderSessions, saveConfiguration } from './database.js'
import { buildDashboard } from './dashboard.js'
import { getClaudeSettingsPath, getDefaultHistoryPaths, getIdentifierSalt } from './paths.js'
import {
  forecastNextLoss,
  readCleanupPeriod,
  readHistoryAgeCached,
  writeCleanupPeriod,
} from './retention.js'
import { beginScan, finishScan, readScanProgress, reportScannedFile } from './scanProgress.js'
import { createLoopbackHostGuard, csrfToken, protectMutation } from './security.js'
import { aggregateSessions, type AggregationDiagnostics } from './sessionAggregation.js'

const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 4317)
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
      claude: { detected: existsSync(historyPaths.claude) },
      codex: { detected: existsSync(historyPaths.codex) },
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
      promptBodiesExtracted: false,
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
  }))
  return { sessions }
})

app.get('/api/sessions/detail', async (request, reply) => {
  const parsed = z
    .object({
      provider: z.enum(['claude', 'codex']),
      sessionKey: z.string().min(1).max(120),
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
  const reference = getSessionReference(parsed.data.provider, parsed.data.sessionKey)
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

  const suffix = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
  const result = writeCleanupPeriod(getClaudeSettingsPath(), parsed.data.days, suffix)

  if (!result.ok) {
    await reply.code(409).send({ error: 'retention_write_failed', message: result.reason })
    return
  }
  return { saved: true, days: result.days, previousDays: result.previousDays }
})

const scanRequestSchema = z.object({
  providers: z
    .array(z.enum(['claude', 'codex']))
    .min(1)
    .default(['claude', 'codex']),
})

app.get('/api/scan/progress', async () => readScanProgress())

app.post('/api/scan', async (request, reply) => {
  const parsed = scanRequestSchema.safeParse(request.body ?? {})
  if (!parsed.success) {
    await reply.code(400).send({
      error: 'invalid_request',
      details: parsed.error.flatten(),
    })
    return
  }

  const paths = getDefaultHistoryPaths()
  const identifierSalt = getIdentifierSalt()
  const results: Record<string, unknown> = {}

  try {
    for (const provider of parsed.data.providers) {
      beginScan(provider)
      const result =
        provider === 'claude'
          ? await readClaudeHistory(paths.claude, {
              identifierSalt,
              includeLocalProjectLabel: true,
              includeLocalReferences: true,
              onFileScanned: reportScannedFile,
            })
          : await readCodexHistory(paths.codex, {
              identifierSalt,
              includeLocalProjectLabel: true,
              includeLocalReferences: true,
              onFileScanned: reportScannedFile,
            })

      const aggregationDiagnostics: AggregationDiagnostics = { nonUtcTimestamps: 0 }
      const sessions = aggregateSessions(result.events, aggregationDiagnostics)

      replaceProviderSessions(provider, sessions, {
        filesSeen: result.diagnostics.filesDiscovered,
        malformedLines: result.diagnostics.malformedJsonLines,
      })
      results[provider] = {
        events: sessions.length,
        diagnostics: {
          ...result.diagnostics,
          nonUtcTimestamps: aggregationDiagnostics.nonUtcTimestamps,
        },
      }
    }
  } finally {
    finishScan()
  }

  return {
    completedAt: new Date().toISOString(),
    providers: results,
  }
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
  await app.listen({ host, port })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
