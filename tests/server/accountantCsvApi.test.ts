import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace.js'
import { accountantCsvZip } from '../../src/core/accountantCsv.js'
import { registerBalanceRoutes } from '../../src/server/balanceRoutes.js'
import { reviewContentHash } from '../../src/server/storedReview.js'

const savedId = '00000000-0000-4000-8000-000000000001'
const correctedId = '00000000-0000-4000-8000-000000000002'
const missingId = '00000000-0000-4000-8000-000000000003'
const openResources: Array<{ app: ReturnType<typeof Fastify>; db: DatabaseSync }> = []

afterEach(async () => {
  for (const { app, db } of openResources.splice(0)) {
    await app.close()
    db.close()
  }
})

function fixture(withMaterials = true) {
  const review = JSON.parse(
    readFileSync(
      resolve(
        withMaterials
          ? 'fixtures/archive/stored-review-materials-v1.json'
          : 'fixtures/archive/stored-review-v1.json',
      ),
      'utf8',
    ),
  ) as BalanceReview
  review.id = savedId
  const db = new DatabaseSync(':memory:')
  // No source, live workspace, or observation tables: exports must need only the saved record.
  db.exec(`
    CREATE TABLE balance_reviews (id TEXT PRIMARY KEY, year INTEGER, payload TEXT, content_hash TEXT);
    CREATE TABLE balance_review_heads (year INTEGER PRIMARY KEY, review_id TEXT);
  `)
  const insert = (record: BalanceReview) =>
    db
      .prepare('INSERT INTO balance_reviews VALUES (?, ?, ?, ?)')
      .run(record.id, record.year, JSON.stringify(record), reviewContentHash(record))
  insert(review)
  db.prepare('INSERT INTO balance_review_heads VALUES (?, ?)').run(review.year, review.id)
  const app = Fastify()
  registerBalanceRoutes(app, () => db)
  openResources.push({ app, db })
  return { app, db, review, insert, url: `/api/balances/reviews/${review.id}/export` }
}

describe('saved accountant CSV archive API', () => {
  it.each([true, false])(
    'exports exact immutable archive bytes with attachment and no-store headers; materials=%s',
    async (withMaterials) => {
      const { app, db, review, insert, url } = fixture(withMaterials)
      const before = db.prepare('SELECT total_changes() AS n').get()
      const response = await app.inject({ url: url + '?format=accountant-csv' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/zip')
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="devtax-${review.year}-${savedId}-accountant-csv.zip"`,
      )
      expect(response.rawPayload).toEqual(Buffer.from(accountantCsvZip(review)))
      expect(response.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 3, 4]))
      expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before)

      insert({ ...review, id: correctedId, correctsReviewId: savedId, reason: '訂正後の理由' })
      db.prepare('UPDATE balance_review_heads SET review_id=?').run(correctedId)
      const reexport = await app.inject({ url: url + '?format=accountant-csv' })
      expect(reexport.rawPayload).toEqual(response.rawPayload)
    },
  )

  it('keeps existing formats and strict query validation', async () => {
    const { app, url } = fixture()
    expect((await app.inject({ url })).headers['content-type']).toContain('text/markdown')
    expect((await app.inject({ url: url + '?format=json' })).headers['content-type']).toContain(
      'application/json',
    )
    for (const suffix of ['?format=csv', '?format=accountant-csv&extra=1'])
      expect((await app.inject({ url: url + suffix })).statusCode).toBe(400)
    expect(
      (await app.inject({ url: '/api/balances/reviews/not-a-uuid/export?format=accountant-csv' }))
        .statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ url: `/api/balances/reviews/${missingId}/export?format=accountant-csv` }))
        .statusCode,
    ).toBe(404)
  })

  it('does not emit an archive for an invalid saved-record hash', async () => {
    const { app, db, url } = fixture()
    db.prepare('UPDATE balance_reviews SET content_hash=?').run('0'.repeat(64))
    const response = await app.inject({ url: url + '?format=accountant-csv' })
    expect(response.statusCode).toBe(500)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.headers['content-disposition']).toBeUndefined()
  })
})
