import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { z } from 'zod'
import { readClaudeHistory, readCodexHistory } from '../adapters/index.ts'
import { getConfiguration, replaceProviderSessions, saveConfiguration } from './database.js'
import { buildDashboard } from './dashboard.js'
import { getDefaultHistoryPaths, getIdentifierSalt } from './paths.js'
import { csrfToken, protectMutation } from './security.js'
import { aggregateSessions, type AggregationDiagnostics } from './sessionAggregation.js'

const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 4317)
const app = Fastify({
  logger: true,
  bodyLimit: 64 * 1024,
})

app.addHook('preHandler', protectMutation)

app.get('/api/health', async () => ({
  ok: true,
  service: 'devtax-radar',
}))

app.get('/api/runtime', async () => {
  const historyPaths = getDefaultHistoryPaths()
  return {
    csrfToken,
    providers: {
      claude: { detected: existsSync(historyPaths.claude) },
      codex: { detected: existsSync(historyPaths.codex) },
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

const scanRequestSchema = z.object({
  providers: z
    .array(z.enum(['claude', 'codex']))
    .min(1)
    .default(['claude', 'codex']),
})

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

  for (const provider of parsed.data.providers) {
    const result =
      provider === 'claude'
        ? await readClaudeHistory(paths.claude, {
            identifierSalt,
            includeLocalProjectLabel: true,
            includeLocalReferences: true,
          })
        : await readCodexHistory(paths.codex, {
            identifierSalt,
            includeLocalProjectLabel: true,
            includeLocalReferences: true,
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
