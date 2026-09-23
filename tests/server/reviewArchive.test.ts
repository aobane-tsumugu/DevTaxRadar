import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace.js'
import {
  canonicalReviewValue,
  readStoredReview,
  reviewContentHash,
} from '../../src/server/storedReview.js'
import { listArchiveReviews, readArchiveReview } from '../../src/server/reviewArchive.js'
import { runReviewArchiveCli } from '../../src/server/reviewArchiveCli.js'
import { reviewExportJson, reviewExportMarkdown } from '../../src/core/reviewExport.js'

const payload = readFileSync(resolve('fixtures/archive/stored-review-v1.json'), 'utf8').trimEnd()
const golden = JSON.parse(payload) as BalanceReview
// Hash the checked-in, canonically encoded legacy fixture, not a newly normalized object.
const storedHash = createHash('sha256').update(payload).digest('hex')
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

type Fixture = { root: string; directory: string; file: string }
function fixture(action: (f: Fixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'devtax-archive-'))
  const directory = join(root, '原本なし backup')
  mkdirSync(directory)
  const file = join(directory, 'devtax-radar.db')
  const db = new DatabaseSync(file)
  try {
    db.exec(`
      CREATE TABLE balance_reviews (
        id TEXT PRIMARY KEY,
        year INTEGER NOT NULL,
        payload TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL
      ) STRICT;
      CREATE TABLE balance_review_heads (
        year INTEGER PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES balance_reviews(id)
      ) STRICT;
      CREATE TABLE unrelated_extension (id TEXT PRIMARY KEY, value TEXT) STRICT;
      INSERT INTO unrelated_extension VALUES ('retained', 'not an application schema to migrate');
      PRAGMA user_version=987;
    `)
    db.prepare('INSERT INTO balance_reviews VALUES (?, ?, ?, ?, ?, ?)').run(
      golden.id,
      golden.year,
      payload,
      storedHash,
      'fixture-request',
      'fixture-hash',
    )
    db.prepare('INSERT INTO balance_review_heads VALUES (?, ?)').run(golden.year, golden.id)
  } finally {
    db.close()
  }
  try {
    action({ root, directory, file })
  } finally {
    chmodSync(file, 0o600)
    rmSync(root, { recursive: true, force: true })
  }
}
function edit(f: Fixture, action: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(f.file)
  try {
    action(db)
  } finally {
    db.close()
  }
}
function insert(db: DatabaseSync, review: BalanceReview): void {
  db.prepare('INSERT INTO balance_reviews VALUES (?, ?, ?, ?, ?, ?)').run(
    review.id,
    review.year,
    JSON.stringify(review),
    reviewContentHash(review),
    review.id,
    'fixture',
  )
}

describe('stored review integrity shared by API and archive reader', () => {
  it('retains the original adoption encoding and digest', () => {
    assert.equal(canonicalReviewValue(golden), payload)
    assert.equal(reviewContentHash(golden), storedHash)
  })
  it('sorts object keys but preserves array order, null, zero and Unicode', () => {
    assert.equal(
      canonicalReviewValue({ z: undefined, y: [null, 0, '日本語'], b: { z: 1, a: false } }),
      '{"b":{"a":false,"z":1},"y":[null,0,"日本語"]}',
    )
    assert.notEqual(reviewContentHash([1, 2]), reviewContentHash([2, 1]))
  })
  it('accepts legacy payloads with different key order and whitespace', () => {
    fixture((f) => {
      edit(f, (db) =>
        db
          .prepare('UPDATE balance_reviews SET payload=?')
          .run(JSON.stringify(Object.fromEntries(Object.entries(golden).reverse()), null, 2)),
      )
      assert.deepEqual(readArchiveReview(f.directory, golden.id), golden)
    })
  })
  it('returns null for a missing ID in the shared reader', () => {
    fixture((f) => edit(f, (db) => assert.equal(readStoredReview(db, 'absent'), null)))
  })
  for (const [name, change] of [
    [
      'content without matching hash',
      (db: DatabaseSync) =>
        db
          .prepare('UPDATE balance_reviews SET payload=?')
          .run(JSON.stringify({ ...golden, reason: 'changed' })),
    ],
    [
      'hash',
      (db: DatabaseSync) =>
        db.prepare('UPDATE balance_reviews SET content_hash=?').run('0'.repeat(64)),
    ],
    [
      'invalid JSON',
      (db: DatabaseSync) => db.prepare('UPDATE balance_reviews SET payload=?').run('{'),
    ],
    [
      'null JSON',
      (db: DatabaseSync) => db.prepare('UPDATE balance_reviews SET payload=?').run('null'),
    ],
    [
      'array JSON',
      (db: DatabaseSync) => db.prepare('UPDATE balance_reviews SET payload=?').run('[]'),
    ],
    [
      'indexed year',
      (db: DatabaseSync) => db.prepare('UPDATE balance_reviews SET year=2027').run(),
    ],
    [
      'unsupported record schema',
      (db: DatabaseSync) => {
        const value = { ...golden, schemaVersion: 2 }
        db.prepare('UPDATE balance_reviews SET payload=?, content_hash=?').run(
          JSON.stringify(value),
          reviewContentHash(value),
        )
      },
    ],
    [
      'mismatched payload ID',
      (db: DatabaseSync) => {
        const value = { ...golden, id: 'other-review' }
        db.prepare('UPDATE balance_reviews SET payload=?, content_hash=?').run(
          JSON.stringify(value),
          reviewContentHash(value),
        )
      },
    ],
  ] as const) {
    it(`rejects ${name} without changing the source`, () => {
      fixture((f) => {
        edit(f, change)
        const before = digest(f.file)
        assert.throws(() => readArchiveReview(f.directory, golden.id), /検証/)
        assert.throws(() => listArchiveReviews(f.directory), /検証/)
        assert.equal(digest(f.file), before)
      })
    })
  }
  it('rejects duplicate IDs rather than selecting whichever row appears first', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(
        'CREATE TABLE balance_reviews(id TEXT, year INTEGER, payload TEXT, content_hash TEXT)',
      )
      const write = db.prepare('INSERT INTO balance_reviews VALUES (?, ?, ?, ?)')
      write.run(golden.id, golden.year, payload, storedHash)
      write.run(golden.id, golden.year, payload, storedHash)
      assert.throws(() => readStoredReview(db, golden.id), /重複/)
    } finally {
      db.close()
    }
  })
})

describe('originals-independent read-only archive', () => {
  it('reads committed WAL data but never an uncommitted writer transaction', () => {
    fixture((f) => {
      edit(f, (db) => {
        db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE')
        const correction = { ...golden, id: 'wal-correction', correctsReviewId: golden.id }
        insert(db, correction)
        assert.throws(() => readArchiveReview(f.directory, correction.id), /見つかりません/)
        assert.deepEqual(readArchiveReview(f.directory, golden.id), golden)
        db.exec('COMMIT')
        assert.deepEqual(readArchiveReview(f.directory, correction.id), correction)
      })
    })
  })
  it('reads known and unknown amounts without originals, salt, or app initialization', () => {
    fixture((f) => {
      const before = digest(f.file)
      assert.deepEqual(readArchiveReview(f.directory, golden.id), golden)
      assert.equal(
        readArchiveReview(f.directory, golden.id).projection.accounts[1]?.closing.amountJpy,
        null,
      )
      assert.equal(digest(f.file), before)
      assert.deepEqual(readdirSync(f.directory), ['devtax-radar.db'])
    })
  })
  it('keeps a restore hold and an unfamiliar application schema untouched', () => {
    fixture((f) => {
      const marker = join(f.directory, 'restore-reconnect-required.json')
      writeFileSync(marker, 'held-for-source-reconnection')
      const before = digest(f.file)
      readArchiveReview(f.directory, golden.id)
      assert.equal(digest(f.file), before)
      assert.equal(readFileSync(marker, 'utf8'), 'held-for-source-reconnection')
      edit(f, (db) => {
        assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 987)
        assert.equal(
          db.prepare('SELECT value FROM unrelated_extension').get()?.value,
          'not an application schema to migrate',
        )
      })
    })
  })
  it('reads a non-writable DB without changing it', () => {
    fixture((f) => {
      chmodSync(f.file, 0o400)
      const before = digest(f.file)
      assert.equal(readArchiveReview(f.directory, golden.id).id, golden.id)
      assert.equal(digest(f.file), before)
    })
  })
  it('lists original and corrected versions without substituting the current head', () => {
    fixture((f) => {
      const correction = {
        ...golden,
        id: 'review-correction',
        reason: 'later reason',
        correctsReviewId: golden.id,
      }
      edit(f, (db) => {
        insert(db, correction)
        db.prepare('UPDATE balance_review_heads SET review_id=?').run(correction.id)
      })
      const index = listArchiveReviews(f.directory)
      assert.equal(index.reviews.length, 2)
      assert.equal(index.reviews.find((r) => r.id === correction.id)?.correctsReviewId, golden.id)
      assert.deepEqual(readArchiveReview(f.directory, golden.id), golden)
      assert.deepEqual(readArchiveReview(f.directory, correction.id), correction)
    })
  })
  it('preserves unknown fields and stored calculation results without recalculation', () => {
    fixture((f) => {
      const historical = {
        ...golden,
        id: 'historical',
        futureField: { retained: true },
        projection: {
          ...golden.projection,
          totals: { ...golden.projection.totals, knownClosingJpy: 1234 },
        },
      }
      edit(f, (db) => insert(db, historical))
      assert.deepEqual(readArchiveReview(f.directory, historical.id), historical)
    })
  })
  it('does not create a missing database or directory', () => {
    fixture((f) => {
      const absent = join(f.root, 'absent')
      assert.throws(() => listArchiveReviews(absent))
      assert.equal(existsSync(absent), false)
    })
  })
  it('rejects a missing review and invalid IDs', () => {
    fixture((f) => {
      assert.throws(() => readArchiveReview(f.directory, 'not-found'), /見つかりません/)
      for (const id of ['', ' padded ', 'x'.repeat(501)])
        assert.throws(() => readArchiveReview(f.directory, id), /ID/)
    })
  })
  it('rejects a database without stored review tables without migrating it', () => {
    fixture((f) => {
      edit(f, (db) => db.exec('DROP TABLE balance_review_heads; DROP TABLE balance_reviews'))
      const before = digest(f.file)
      assert.throws(() => listArchiveReviews(f.directory), /移行・新規作成はしません/)
      assert.equal(digest(f.file), before)
    })
  })
  it('rejects a view posing as the stored review table', () => {
    fixture((f) => {
      edit(f, (db) =>
        db.exec(
          'DROP TABLE balance_review_heads; DROP TABLE balance_reviews; ' +
            'CREATE VIEW balance_reviews AS SELECT 1 AS id',
        ),
      )
      assert.throws(() => listArchiveReviews(f.directory), /移行・新規作成はしません/)
    })
  })
  it('rejects a directory in place of the DB', () => {
    fixture((f) => {
      const source = join(f.root, 'directory-source')
      mkdirSync(join(source, 'devtax-radar.db'), { recursive: true })
      assert.throws(() => listArchiveReviews(source), /通常のDB/)
    })
  })
  it('rejects a corrupt SQLite file without repairing it', () => {
    fixture((f) => {
      writeFileSync(f.file, 'not a SQLite database')
      const before = digest(f.file)
      assert.throws(() => listArchiveReviews(f.directory))
      assert.equal(digest(f.file), before)
    })
  })
  it('returns an empty index without declaring that all records were confirmed', () => {
    fixture((f) => {
      edit(f, (db) => db.exec('DELETE FROM balance_review_heads; DELETE FROM balance_reviews'))
      assert.deepEqual(listArchiveReviews(f.directory), {
        kind: 'stored-review-index',
        version: 1,
        reviews: [],
      })
    })
  })
})

describe('archive CLI and existing export functions', () => {
  for (const format of ['json', 'markdown']) {
    it(`preserves frozen costs, evidence and observations in ${format}`, () => {
      fixture((f) => {
        const materialPayload = readFileSync(
          resolve('fixtures/archive/stored-review-materials-v1.json'),
          'utf8',
        ).trimEnd()
        const materialReview = JSON.parse(materialPayload) as BalanceReview
        edit(f, (db) => {
          db.prepare('INSERT INTO balance_reviews VALUES (?, ?, ?, ?, ?, ?)').run(
            materialReview.id,
            materialReview.year,
            materialPayload,
            createHash('sha256').update(materialPayload).digest('hex'),
            'material-request',
            'fixture',
          )
        })
        const before = digest(f.file)
        const output = join(f.root, 'with-materials-' + format + '.txt')
        runReviewArchiveCli(['export', f.directory, materialReview.id, format, output])
        const actual = readFileSync(output, 'utf8')
        assert.equal(
          actual,
          format === 'json'
            ? reviewExportJson(materialReview)
            : reviewExportMarkdown(materialReview),
        )
        assert.ok(actual.includes('保存時の根拠メモ'))
        assert.ok(actual.includes('請求確認待ち'))
        assert.ok(actual.includes('observation-a'))
        assert.deepEqual(readArchiveReview(f.directory, materialReview.id), materialReview)
        assert.equal(digest(f.file), before)
      })
    })
  }

  it('runs the command entry without application initialization and reports failures', () => {
    fixture((f) => {
      const before = digest(f.file)
      const compiled = import.meta.url.endsWith('.js')
      const args = compiled
        ? [resolve('scripts/read-review.js')]
        : ['--import', 'tsx', resolve('scripts/read-review.ts')]
      const env = { ...process.env, DEVTAX_RADAR_DATA_DIR: join(f.root, 'not-the-source') }
      const listed = JSON.parse(
        execFileSync(process.execPath, [...args, 'list', f.directory], {
          env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000,
        }),
      )
      assert.equal(listed.reviews[0].id, golden.id)
      const bad = spawnSync(process.execPath, [...args, 'export'], {
        env,
        encoding: 'utf8',
        timeout: 10000,
      })
      assert.equal(bad.status, 1)
      assert.match(bad.stderr, /Usage:/)
      assert.equal(existsSync(env.DEVTAX_RADAR_DATA_DIR), false)
      assert.equal(digest(f.file), before)
    })
  })
  it('rejects an export inside the source tree, keeping backup contents unchanged', () => {
    fixture((f) => {
      const nested = join(f.directory, 'nested')
      mkdirSync(nested)
      const before = digest(f.file)
      for (const output of [join(f.directory, 'export.json'), join(nested, 'export.json')]) {
        assert.throws(
          () => runReviewArchiveCli(['export', f.directory, golden.id, 'json', output]),
          /フォルダの外/,
        )
        assert.equal(existsSync(output), false)
      }
      assert.equal(digest(f.file), before)
    })
  })

  it('lists records as JSON without creating any output or changing the DB', () => {
    fixture((f) => {
      const before = digest(f.file)
      const result = JSON.parse(runReviewArchiveCli(['list', f.directory]))
      assert.equal(result.reviews[0].id, golden.id)
      assert.equal(digest(f.file), before)
      assert.deepEqual(readdirSync(f.directory), ['devtax-radar.db'])
    })
  })
  for (const format of ['json', 'markdown']) {
    it(`exports ${format} with exactly the existing API renderer bytes`, () => {
      fixture((f) => {
        const output = join(f.root, '日本語 export.' + (format === 'json' ? 'json' : 'md'))
        const before = digest(f.file)
        const result = JSON.parse(
          runReviewArchiveCli(['export', f.directory, golden.id, format, output]),
        )
        assert.equal(result.exported, true)
        assert.equal(
          readFileSync(output, 'utf8'),
          format === 'json' ? reviewExportJson(golden) : reviewExportMarkdown(golden),
        )
        assert.ok(readFileSync(output, 'utf8').includes('外部資料待ち'))
        assert.equal(digest(f.file), before)
      })
    })
  }
  it('rejects existing outputs, including the source DB, without overwriting', () => {
    fixture((f) => {
      const existing = join(f.root, 'existing.json')
      writeFileSync(existing, 'keep me')
      const before = digest(f.file)
      for (const file of [existing, f.file])
        assert.throws(() => runReviewArchiveCli(['export', f.directory, golden.id, 'json', file]))
      assert.equal(readFileSync(existing, 'utf8'), 'keep me')
      assert.equal(digest(f.file), before)
    })
  })
  it('does not publish a file when validation or rendering fails', () => {
    fixture((f) => {
      const output = join(f.root, 'rejected.json')
      edit(f, (db) => db.prepare('UPDATE balance_reviews SET content_hash=?').run('0'.repeat(64)))
      assert.throws(() => runReviewArchiveCli(['export', f.directory, golden.id, 'json', output]))
      assert.equal(existsSync(output), false)
    })
  })
  it('validates arguments before reading a source or creating output', () => {
    fixture((f) => {
      const absent = join(f.root, 'absent')
      for (const args of [
        [],
        ['list'],
        ['list', absent, 'extra'],
        ['export', absent],
        ['export', absent, golden.id, 'csv', 'output'],
        ['export', absent, golden.id, 'json', 'output', 'extra'],
      ])
        assert.throws(() => runReviewArchiveCli(args), /Usage:/)
      assert.equal(existsSync(absent), false)
    })
  })
})
