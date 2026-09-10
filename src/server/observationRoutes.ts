import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { listObservationRecords, readObservationRecord } from './observationRecords.js'

/** These routes only read automatically retained records. No adoption or source mutation. */
export function registerObservationRoutes(app: FastifyInstance, database: () => DatabaseSync): void {
  app.get<{ Querystring: { offset?: string } }>('/api/observations/records', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const raw = request.query.offset
    const offset = raw === undefined ? 0 : Number(raw)
    if ((raw !== undefined && (typeof raw !== 'string' || !/^\d+$/.test(raw))) ||
        !Number.isSafeInteger(offset) || offset < 0)
      return reply.code(400).send({ error: 'invalid_request', message: '数値記録の取得範囲を確認してください。' })
    return listObservationRecords(database(), offset)
  })
  app.get<{ Params: { id: string } }>('/api/observations/records/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!/^[a-f0-9]{64}$/.test(request.params.id))
      return reply.code(400).send({ error: 'invalid_request', message: '数値記録の識別子を確認してください。' })
    try {
      const record = readObservationRecord(database(), request.params.id)
      if (!record)
        return reply.code(404).send({ error: 'not_found', message: '数値記録が見つかりません。' })
      return { record }
    } catch {
      return reply.code(409).send({ error: 'invalid_record', message: '数値記録を検証できません。記録は削除していません。' })
    }
  })
}
