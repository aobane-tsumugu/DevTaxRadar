import type { FastifyInstance, FastifyReply } from 'fastify'
import { datasetIdentity } from './datasetIdentity.js'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { balanceDraftSaveSchema, balanceYearSchema } from '../accounting/balanceSchema.js'
import { BalanceValidationError } from '../core/annualBalances.js'
import { checkBalanceReferences } from '../core/balanceReferences.js'
import { readWorkspace } from './workspaceRepository.js'
import { buildReviewMaterials, readReviewMaterials } from './reviewMaterials.js'
import { readDashboardObservation, projectWorkspaceYears } from './dashboard.js'
import { reviewExportJson, reviewExportMarkdown } from '../core/reviewExport.js'
import { accountantCsvZip } from '../core/accountantCsv.js'
import { compareReview } from '../core/reviewComparison.js'
import { describeCostLots } from '../core/costLotLabel.js'
import {
  BalanceConflictError,
  getBalanceDraft,
  saveBalanceDraft,
  previewBalanceReview,
  listBalanceReviews,
  getBalanceReview,
  adoptBalanceReview,
} from './balanceRepository.js'

const scope = {
  kind: 'recorded-balances' as const,
  costAndDecisionReferencesVerified: false as const,
  adoptionAvailable: true as const,
  taxTreatmentVerified: false as const,
  limitations: [
    '記録した期首と増減から計算した残高です。全費用の税務上の扱いを自動算定した結果ではありません。',
    '現在の制作物・資料の存在と判断の確認状態・対象年・制作物を照合します。年度資料への採用は記録の固定であり、金額の由来・税務適用条件の検証完了ではありません。',
  ],
}
const yearQuery = z
  .object({
    year: z
      .string()
      .regex(/^\d{4}$/)
      .transform(Number)
      .pipe(balanceYearSchema),
  })
  .strict()
function sendError(error: unknown, reply: FastifyReply) {
  if (error instanceof BalanceConflictError)
    return reply.code(409).send({ error: 'balance_conflict', message: error.message })
  if (error instanceof BalanceValidationError)
    return reply.code(400).send({ error: error.code, message: error.message })
  throw error
}
function readSnapshot<T>(db: DatabaseSync, action: () => T): T {
  db.exec('SAVEPOINT balance_api_read')
  try {
    const value = action()
    db.exec('RELEASE balance_api_read')
    return value
  } catch (error) {
    db.exec('ROLLBACK TO balance_api_read; RELEASE balance_api_read')
    throw error
  }
}

/** Uses the app's loopback/origin/CSRF hooks; adoption always binds server-read materials. */
export function registerBalanceRoutes(app: FastifyInstance, getDatabase: () => DatabaseSync): void {
  app.get('/api/balances/draft', async () => {
    const db = getDatabase()
    return readWorkspace((workspace) => {
      const draft = getBalanceDraft(db)
      const linkedYears = [
        ...new Set(
          draft.snapshot.movements.flatMap((row) =>
            row.kind === 'addition' ? (row.costAllocations ?? []).map((link) => link.costYear) : [],
          ),
        ),
      ].sort((a, b) => a - b)
      const calculatedCosts = linkedYears.length
        ? projectWorkspaceYears(workspace, readDashboardObservation(db), linkedYears).projections
        : []
      return {
        ...draft,
        costDescriptions: {
          workspaceRevision: workspace.revision,
          items: describeCostLots(calculatedCosts),
        },
        datasetId: datasetIdentity(db),
        scope,
        referenceCheck: {
          ...checkBalanceReferences(
            draft.snapshot,
            workspace.planning,
            workspace.configuration.chargePeriods ?? [],
            calculatedCosts.flatMap((row) => row.sources),
          ),
          workspaceRevision: workspace.revision,
        },
      }
    }, db)
  })
  app.put('/api/balances/draft', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const parsed = balanceDraftSaveSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    try {
      return {
        ...saveBalanceDraft(
          getDatabase(),
          parsed.data.snapshot,
          parsed.data.expectedRevision,
          parsed.data.requestId,
        ),
        datasetId: datasetIdentity(getDatabase()),
        scope,
      }
    } catch (error) {
      return sendError(error, reply)
    }
  })
  app.get('/api/balances/preview', async (request, reply) => {
    const parsed = yearQuery.safeParse(request.query)
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    try {
      const db = getDatabase()
      return readSnapshot(db, () => {
        const preview = previewBalanceReview(db, parsed.data.year, readReviewMaterials)
        return {
          ...preview,
          scope,
          referenceCheck: {
            ...preview.materials!.referenceCheck,
            workspaceRevision: preview.materials!.workspaceRevision,
          },
        }
      })
    } catch (error) {
      return sendError(error, reply)
    }
  })
  app.get('/api/balances/reviews', async () => {
    const db = getDatabase()
    return readSnapshot(db, () => ({ reviews: listBalanceReviews(db), scope }))
  })
  app.get('/api/balances/impact', async (request, reply) => {
    if (!z.object({}).strict().safeParse(request.query).success)
      return reply.code(400).send({ error: 'invalid_request' })
    const db = getDatabase()
    reply.header('Cache-Control', 'no-store')
    try {
      return readWorkspace((workspace) => {
        const draft = getBalanceDraft(db)
        const observation = readDashboardObservation(db)
        const years = listBalanceReviews(db)
          .filter((row) => row.active)
          .map((row) => {
            const review = getBalanceReview(db, row.id)!
            const preview = previewBalanceReview(db, row.year, (_db, snapshot, year) =>
              buildReviewMaterials(workspace, snapshot, year, observation),
            )
            return {
              ...compareReview(review, preview, draft.snapshot),
              priorChainChanged: row.previousYearChanged,
            }
          })
        return { kind: 'current-input-vs-saved-years', years }
      }, db)
    } catch (error) {
      return sendError(error, reply)
    }
  })
  app.post('/api/balances/reviews', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const parsed = z
      .object({
        year: balanceYearSchema,
        expectedDraftRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        projectionHash: z.string().regex(/^[a-f0-9]{64}$/),
        idempotencyKey: z.string().uuid(),
        expectedDatasetId: z.string().uuid().optional(),
        reason: z.string().trim().min(1).max(2000),
      })
      .strict()
      .safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    try {
      const db = getDatabase()
      const { expectedDatasetId, ...input } = parsed.data
      if (expectedDatasetId && expectedDatasetId !== datasetIdentity(db))
        throw new BalanceConflictError('接続先のデータが変わっています。再読込してください。')
      const review = adoptBalanceReview(db, input, readReviewMaterials)
      return { review, scope }
    } catch (error) {
      return sendError(error, reply)
    }
  })
  app.get('/api/balances/reviews/:id', async (request, reply) => {
    const parsed = z.object({ id: z.string().uuid() }).strict().safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    const review = getBalanceReview(getDatabase(), parsed.data.id)
    if (!review)
      return reply
        .code(404)
        .send({ error: 'not_found', message: '指定した残高資料が見つかりません。' })
    return { review, scope }
  })
  app.get('/api/balances/reviews/:id/compare', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).strict().safeParse(request.params)
    const query = z.object({}).strict().safeParse(request.query)
    if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_request' })
    const db = getDatabase()
    try {
      const comparison = readSnapshot(db, () => {
        const review = getBalanceReview(db, params.data.id)
        if (!review) return null
        const current = previewBalanceReview(db, review.year, readReviewMaterials)
        return compareReview(review, current, getBalanceDraft(db).snapshot)
      })
      if (!comparison)
        return reply
          .code(404)
          .send({ error: 'not_found', message: '指定した年度資料が見つかりません。' })
      return reply.header('Cache-Control', 'no-store').send(comparison)
    } catch (error) {
      return sendError(error, reply)
    }
  })
  app.get('/api/balances/reviews/:id/export', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).strict().safeParse(request.params)
    const query = z
      .object({ format: z.enum(['markdown', 'json', 'accountant-csv']).default('markdown') })
      .strict()
      .safeParse(request.query)
    if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_request' })
    const review = getBalanceReview(getDatabase(), params.data.id)
    if (!review)
      return reply
        .code(404)
        .send({ error: 'not_found', message: '指定した年度資料が見つかりません。' })
    const json = query.data.format === 'json'
    const csv = query.data.format === 'accountant-csv'
    return reply
      .header('Cache-Control', 'no-store')
      .header(
        'Content-Disposition',
        'attachment; filename="devtax-' +
          review.year +
          '-' +
          params.data.id +
          (csv ? '-accountant-csv.zip' : json ? '.json' : '.md') +
          '"',
      )
      .type(
        csv
          ? 'application/zip'
          : json
            ? 'application/json; charset=utf-8'
            : 'text/markdown; charset=utf-8',
      )
      .send(
        csv
          ? Buffer.from(accountantCsvZip(review))
          : json
            ? reviewExportJson(review)
            : reviewExportMarkdown(review),
      )
  })
}
