import { softwareMethodAdoptionIssues, softwareMethodHistoryValue } from '../core/softwareMethod.js'
import { randomUUID } from 'node:crypto'
import {
  canonicalReviewValue as canonical,
  reviewContentHash as hash,
  readStoredReview,
} from './storedReview.js'
import type { DatabaseSync } from 'node:sqlite'
import type { AnnualBalanceProjection, BalanceSnapshot } from '../accounting/types.js'
import type { ReviewMaterials } from '../accounting/reviewMaterials.js'
import { historicalReviewMaterials } from '../core/reviewHistory.js'
import { checkEquipmentCarry } from '../core/equipmentCarryCheck.js'
import { checkOpeningLotCarry } from '../core/openingLotCarry.js'
import { buildAnnualBalances, validateBalanceSnapshot } from '../core/annualBalances.js'
import { BalanceValidationError } from '../core/annualBalances.js'

import type { BalanceDraft, BalancePreview, BalanceReview } from '../accounting/balanceWorkspace.js'
export type { BalanceDraft, BalancePreview, BalanceReview } from '../accounting/balanceWorkspace.js'

export class BalanceConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BalanceConflictError'
  }
}

function integerRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('保存版の番号が不正です。')
}

/** Excludes accidental extra fields, including original transcript references. */
function copySnapshot(snapshot: BalanceSnapshot): BalanceSnapshot {
  validateBalanceSnapshot(snapshot)
  const amount = (value: BalanceSnapshot['accounts'][number]['opening']) =>
    value.status === 'known'
      ? { status: 'known' as const, amountJpy: value.amountJpy }
      : { status: 'unknown' as const, amountJpy: null, reasons: [...value.reasons] }
  return {
    version: 1,
    accounts: snapshot.accounts.map((a) => ({
      id: a.id,
      taxUnitId: a.taxUnitId,
      name: a.name,
      kind: a.kind,
      openingYear: a.openingYear,
      opening: amount(a.opening),
      openingRevisionId: a.openingRevisionId,
      ...(a.softwareMethod === undefined
        ? {}
        : { softwareMethod: structuredClone(a.softwareMethod) }),
    })),
    movements: snapshot.movements.map((m) => ({
      id: m.id,
      occurredOn: m.occurredOn,
      amountJpy: m.amountJpy,
      sourceIds: [...m.sourceIds],
      decisionId: m.decisionId,
      reason: m.reason,
      ...(m.softwareExpense === undefined
        ? {}
        : { softwareExpense: structuredClone(m.softwareExpense) }),
      ...(m.balanceAllocations === undefined
        ? {}
        : {
            balanceAllocations: m.balanceAllocations.map(
              ({ sourceKind, sourceId, amountJpy, costAllocations }) => ({
                sourceKind,
                sourceId,
                amountJpy,
                ...(costAllocations === undefined
                  ? {}
                  : {
                      costAllocations: costAllocations.map(
                        ({ costYear, contributionId, amountJpy }) => ({
                          costYear,
                          contributionId,
                          amountJpy,
                        }),
                      ),
                    }),
              }),
            ),
          }),
      ...(m.kind === 'addition' && m.costAllocations !== undefined
        ? {
            costAllocations: m.costAllocations.map(({ costYear, contributionId, amountJpy }) => ({
              costYear,
              contributionId,
              amountJpy,
            })),
          }
        : {}),
      ...(m.kind === 'transfer'
        ? { kind: m.kind, fromAccountId: m.fromAccountId, toAccountId: m.toAccountId }
        : { kind: m.kind, accountId: m.accountId }),
    })),
    pendingDecisions: snapshot.pendingDecisions.map((p) => ({
      id: p.id,
      taxUnitId: p.taxUnitId,
      taxYear: p.taxYear,
      amount: amount(p.amount),
      accountIds: [...p.accountIds],
      ...(p.answers !== undefined
        ? {
            answers: p.answers.map((a) => ({
              id: a.id,
              taxYear: a.taxYear,
              receivedOn: a.receivedOn,
              kind: a.kind,
              answer: a.answer,
              source: a.source,
            })),
          }
        : {}),
      ...(p.resolution
        ? {
            resolution: {
              taxYear: p.resolution.taxYear,
              decisionId: p.resolution.decisionId,
              reason: p.resolution.reason,
              ...(p.resolution.questionBasis
                ? {
                    questionBasis: {
                      pendingId: p.resolution.questionBasis.pendingId,
                      taxUnitId: p.resolution.questionBasis.taxUnitId,
                      taxYear: p.resolution.questionBasis.taxYear,
                      amount: amount(p.resolution.questionBasis.amount),
                      accountIds: [...p.resolution.questionBasis.accountIds],
                      reasons: [...p.resolution.questionBasis.reasons],
                      sourceIds: [...p.resolution.questionBasis.sourceIds],
                      resolutionYear: p.resolution.questionBasis.resolutionYear,
                      decisionId: p.resolution.questionBasis.decisionId,
                      resolutionReason: p.resolution.questionBasis.resolutionReason,
                    },
                  }
                : {}),
              ...(p.resolution.answerBasis !== undefined
                ? {
                    answerBasis: p.resolution.answerBasis.map((a) => ({
                      id: a.id,
                      taxYear: a.taxYear,
                      receivedOn: a.receivedOn,
                      kind: a.kind,
                      answer: a.answer,
                      source: a.source,
                    })),
                  }
                : {}),
            },
          }
        : {}),
      reasons: [...p.reasons],
      sourceIds: [...p.sourceIds],
    })),
  }
}

/** Call from schema initialization; tests pass a temporary or in-memory database. */
export function initializeBalanceSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS balance_draft (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS balance_reviews (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      payload TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS balance_draft_receipts (
      request_id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      revision INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS balance_review_heads (
      year INTEGER PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES balance_reviews(id)
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS balance_reviews_no_update BEFORE UPDATE ON balance_reviews
      BEGIN SELECT RAISE(ABORT, 'Adopted balance reviews are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS balance_reviews_no_delete BEFORE DELETE ON balance_reviews
      BEGIN SELECT RAISE(ABORT, 'Adopted balance reviews are immutable'); END;
  `)
}

export function getBalanceDraft(db: DatabaseSync): BalanceDraft {
  const row = db.prepare('SELECT revision, payload FROM balance_draft WHERE id = 1').get() as
    { revision: number; payload: string } | undefined
  if (!row)
    return {
      revision: 0,
      snapshot: { version: 1, accounts: [], movements: [], pendingDecisions: [] },
    }
  return {
    revision: row.revision,
    snapshot: copySnapshot(JSON.parse(row.payload) as BalanceSnapshot),
  }
}

function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function saveBalanceDraft(
  db: DatabaseSync,
  snapshot: BalanceSnapshot,
  expectedRevision: number,
  requestId?: string,
): BalanceDraft {
  integerRevision(expectedRevision)
  if (
    requestId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
  )
    throw new BalanceValidationError('invalid-input', '保存要求IDが不正です。')
  const sanitized = copySnapshot(snapshot)
  const requestHash = hash({ expectedRevision, snapshot: sanitized })
  return transaction(db, () => {
    const current = getBalanceDraft(db)
    if (requestId) {
      const receipt = db
        .prepare('SELECT request_hash, revision FROM balance_draft_receipts WHERE request_id = ?')
        .get(requestId) as { request_hash: string; revision: number } | undefined
      if (receipt) {
        if (receipt.request_hash !== requestHash)
          throw new BalanceValidationError(
            'invalid-input',
            '同じ保存要求IDで内容を変更することはできません。',
          )
        if (receipt.revision !== current.revision)
          throw new BalanceConflictError(
            'この保存要求は成功済みですが、その後に別の更新があります。入力を保持して最新の内容を確認してください。',
          )
        return current
      }
    }
    if (current.revision !== expectedRevision)
      throw new BalanceConflictError('別の画面で更新されています。最新の内容を読み直してください。')
    // Older writers must not silently erase method provenance from retained records.
    for (const account of current.snapshot.accounts)
      if (account.softwareMethod) {
        const next = sanitized.accounts.find((row) => row.id === account.id)
        if (
          next &&
          (next.softwareMethod === undefined ||
            (next.softwareMethod === null &&
              current.snapshot.movements.some(
                (row) => row.softwareExpense?.accountId === account.id,
              )))
        )
          throw new BalanceValidationError(
            'invalid-input',
            '保存済みのソフトウェア方法を含む入力で更新してください。確認元だけを省略できません。',
          )
      }
    for (const movement of current.snapshot.movements)
      if (movement.softwareExpense) {
        const next = sanitized.movements.find((row) => row.id === movement.id)
        if (next && next.softwareExpense === undefined)
          throw new BalanceValidationError(
            'invalid-input',
            '年額の確認元だけを削除できません。訂正では該当する費用化記録を明示的に見直してください。',
          )
      }
    const revision = current.revision + 1
    integerRevision(revision)
    db.prepare(
      'INSERT INTO balance_draft(id, revision, payload) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload',
    ).run(revision, canonical(sanitized))
    if (requestId)
      db.prepare(
        'INSERT INTO balance_draft_receipts(request_id, request_hash, revision) VALUES (?, ?, ?)',
      ).run(requestId, requestHash, revision)
    return { revision, snapshot: sanitized }
  })
}

function head(db: DatabaseSync, year: number): string | null {
  const row = db.prepare('SELECT review_id FROM balance_review_heads WHERE year = ?').get(year) as
    { review_id: string } | undefined
  return row?.review_id ?? null
}

export function getBalanceReview(db: DatabaseSync, id: string): BalanceReview | null {
  return readStoredReview(db, id)
}

export type ReviewMaterialsReader = (
  db: DatabaseSync,
  snapshot: BalanceSnapshot,
  year: number,
) => ReviewMaterials

export function previewBalanceReview(
  db: DatabaseSync,
  year: number,
  readMaterials?: ReviewMaterialsReader,
): BalancePreview & { snapshot: BalanceSnapshot } {
  const draft = getBalanceDraft(db)
  const projection = buildAnnualBalances(draft.snapshot, year)
  const previousReviewId = head(db, year - 1)
  const previousReviewChanges = previousReviewId
    ? reviewChainChanges(db, getBalanceReview(db, previousReviewId)!)
    : []
  const materials = readMaterials?.(db, draft.snapshot, year)
  const softwareIssues = softwareMethodAdoptionIssues(draft.snapshot, year, materials?.planning)
  const checkedMaterials = materials
    ? {
        ...materials,
        referenceCheck: {
          ...materials.referenceCheck,
          status: softwareIssues.length
            ? ('needs-review' as const)
            : materials.referenceCheck.status,
          issues: [
            ...materials.referenceCheck.issues,
            ...softwareIssues.map((issue) => ({
              recordType: 'account' as const,
              recordId: issue.accountId,
              referenceId: issue.accountId,
              code: 'unconfirmed-decision' as const,
              message: issue.message,
            })),
          ],
        },
        openingLotCarry: checkOpeningLotCarry(
          previousReviewId ? getBalanceReview(db, previousReviewId) : null,
          projection,
        ),
        equipmentCarryCheck: checkEquipmentCarry(
          materials,
          previousReviewId ? getBalanceReview(db, previousReviewId) : null,
        ),
      }
    : undefined
  const content = {
    snapshot: draft.snapshot,
    ...(checkedMaterials ? { materials: checkedMaterials } : {}),
    draftRevision: draft.revision,
    currentReviewId: head(db, year),
    previousReviewId,
    previousReviewChainChanged: previousReviewChanges.length > 0,
    previousReviewChanges,
    projection,
  }
  return { ...content, projectionHash: hash(content) }
}

function assertPreviousClosing(previous: BalanceReview, current: AnnualBalanceProjection): void {
  const now = new Map(current.accounts.map((account) => [account.accountId, account]))
  for (const old of previous.projection.accounts) {
    const row = now.get(old.accountId)
    if (
      !row ||
      row.taxUnitId !== old.taxUnitId ||
      row.kind !== old.kind ||
      canonical(row.opening) !== canonical(old.closing)
    ) {
      throw new BalanceConflictError(
        '前年度の採用済み期末と一致しません。変更した事実と前年度の訂正を確認してください。',
      )
    }
  }
}

function historicalPostings(snapshot: BalanceSnapshot, year: number): unknown {
  return {
    accounts: snapshot.accounts
      .filter((account) => account.openingYear <= year)
      .map((account) => ({
        id: account.id,
        taxUnitId: account.taxUnitId,
        kind: account.kind,
        openingYear: account.openingYear,
        opening: account.opening,
        openingRevisionId: account.openingRevisionId,
        ...(account.softwareMethod &&
        Number(
          snapshot.movements
            .find((row) => row.id === account.softwareMethod!.acquisitionMovementId)
            ?.occurredOn.slice(0, 4),
        ) <= year
          ? { softwareMethod: softwareMethodHistoryValue(account.softwareMethod, year) }
          : {}),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    movements: snapshot.movements
      .filter((movement) => Number(movement.occurredOn.slice(0, 4)) <= year)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}

function priorChainChanged(db: DatabaseSync, review: BalanceReview): boolean {
  return reviewChainChanges(db, review).length > 0
}

function reviewChainChanges(
  db: DatabaseSync,
  review: BalanceReview,
): NonNullable<BalancePreview['previousReviewChanges']> {
  const changes: NonNullable<BalancePreview['previousReviewChanges']> = []
  let current = review
  while (true) {
    const currentReviewId = head(db, current.year - 1)
    if (current.previousReviewId !== currentReviewId)
      changes.push({
        year: current.year - 1,
        referencingYear: current.year,
        storedReviewId: current.previousReviewId,
        currentReviewId,
      })
    if (current.previousReviewId === null) return changes
    const previous = getBalanceReview(db, current.previousReviewId)
    if (!previous || previous.year !== current.year - 1)
      throw new Error('年度の採用版の接続を検証できませんでした。')
    current = previous
  }
}

export function adoptBalanceReview(
  db: DatabaseSync,
  input: {
    year: number
    expectedDraftRevision: number
    projectionHash: string
    idempotencyKey: string
    reason: string
  },
  readMaterials?: ReviewMaterialsReader,
): BalanceReview {
  integerRevision(input.expectedDraftRevision)
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200)
    throw new Error('再送を識別するキーが必要です。')
  if (!input.reason.trim()) throw new Error('この内容を採用・訂正する理由が必要です。')
  const requestHash = hash(
    readMaterials ? { ...input, materialBinding: 'review-materials/1' } : input,
  )
  return transaction(db, () => {
    const repeated = db
      .prepare('SELECT id, request_hash FROM balance_reviews WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as { id: string; request_hash: string } | undefined
    if (repeated) {
      if (repeated.request_hash !== requestHash)
        throw new BalanceConflictError('同じ再送キーで異なる内容は採用できません。')
      return getBalanceReview(db, repeated.id)!
    }
    const preview = previewBalanceReview(db, input.year, readMaterials)
    if (
      preview.draftRevision !== input.expectedDraftRevision ||
      preview.projectionHash !== input.projectionHash
    )
      throw new BalanceConflictError(
        '確認後に入力または採用版が変わりました。差分を確認してください。',
      )
    const softwareIssues = softwareMethodAdoptionIssues(
      preview.snapshot,
      input.year,
      preview.materials?.planning,
    )
    if (softwareIssues.length)
      throw new BalanceValidationError(
        'invalid-input',
        softwareIssues.map((issue) => issue.message).join(' / '),
      )
    if (preview.materials?.equipmentCarryCheck?.rows.some((row) => row.status === 'mismatch'))
      throw new BalanceValidationError(
        'invalid-input',
        '設備の前年残高と前年資料に不一致があります。入力または前年資料を確認してください。',
      )
    if (preview.materials?.costPresenceCheck?.items.some((row) => row.status === 'conflict'))
      throw new BalanceValidationError(
        'invalid-input',
        '該当なしの確認と登録費用に不一致があります。年度別の確認内容を見直してください。',
      )
    if (preview.materials?.balanceFlowCheck?.status === 'invalid')
      throw new BalanceValidationError(
        'invalid-input',
        '残高移動の対応元に不整合があります。残額・日付・循環を確認してください。',
      )
    if (preview.materials?.costLinks?.check.status === 'invalid')
      throw new BalanceValidationError(
        'invalid-input',
        '費用と残高増加の金額対応に不整合があります。対応先・配分額の上限を確認してください。',
      )
    if (preview.materials?.balanceLotTrace?.status === 'invalid')
      throw new BalanceValidationError(
        'invalid-input',
        '使用原価の内訳に不整合があります。対応元と原価の重複使用を確認してください。',
      )
    if (preview.materials?.openingLotCarry?.status === 'invalid')
      throw new BalanceValidationError(
        'invalid-input',
        '前年からの原価繰越しに不整合があります。前年の採用資料と当年期首を確認してください。',
      )
    if (
      preview.materials &&
      (preview.materials.year !== input.year ||
        preview.materials.referenceCheck.status !== 'consistent')
    )
      throw new BalanceConflictError(
        '費用・判断との対応を確認できません。参照の問題を解消してください。',
      )
    for (const id of [preview.currentReviewId, preview.previousReviewId]) {
      if (id && getBalanceReview(db, id)?.materials && !preview.materials)
        throw new BalanceConflictError(
          '費用・判断を含む資料を、残高だけの資料で置き換えることはできません。',
        )
    }
    if (preview.previousReviewId) {
      const previous = getBalanceReview(db, preview.previousReviewId)!
      if (priorChainChanged(db, previous))
        throw new BalanceConflictError(
          '前年度の資料に過年度訂正の未反映があります。前年度の差分を確認してください。',
        )
      if (readMaterials) {
        let historical: BalanceReview | null = previous
        while (historical) {
          if (historical.materials) {
            const current = readMaterials(db, getBalanceDraft(db).snapshot, historical.year)
            if (
              canonical(historicalReviewMaterials(historical.materials, historical.snapshot)) !==
              canonical(historicalReviewMaterials(current, getBalanceDraft(db).snapshot))
            )
              throw new BalanceConflictError(
                historical.year +
                  '年の保存済み費用・判断・根拠・利用量と現在の記録が一致しません。残高が同額でも、その年度の内容と訂正を確認してください。',
              )
          }
          historical = historical.previousReviewId
            ? getBalanceReview(db, historical.previousReviewId)
            : null
        }
      }
      assertPreviousClosing(previous, preview.projection)
      const previousAccounts = new Set(
        previous.projection.accounts.map((account) => account.accountId),
      )
      for (const account of preview.projection.accounts) {
        const original = getBalanceDraft(db).snapshot.accounts.find(
          (item) => item.id === account.accountId,
        )!
        if (
          !previousAccounts.has(account.accountId) &&
          original.openingYear < input.year &&
          (account.opening.status === 'unknown' || account.opening.amountJpy !== 0)
        )
          throw new BalanceConflictError(
            '前年度にない繰越残高があります。追加した対象と前年度の資料を確認してください。',
          )
      }
      if (
        canonical(historicalPostings(previous.snapshot, previous.year)) !==
        canonical(historicalPostings(getBalanceDraft(db).snapshot, previous.year))
      ) {
        throw new BalanceConflictError(
          '前年度の採用済み移動と根拠が変わっています。残高が同額でも前年度の訂正を確認してください。',
        )
      }
    } else {
      const earlier = db
        .prepare('SELECT year FROM balance_review_heads WHERE year < ? LIMIT 1')
        .get(input.year)
      if (earlier)
        throw new BalanceConflictError(
          '年度の記録が途切れています。直前年度の内容を確認して採用してください。',
        )
    }
    const review: BalanceReview = {
      ...(preview.materials ? { materials: preview.materials } : {}),
      schemaVersion: 1,
      engineVersion: 'annual-balances/1',
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      year: input.year,
      draftRevision: preview.draftRevision,
      correctsReviewId: preview.currentReviewId,
      previousReviewId: preview.previousReviewId,
      reason: input.reason,
      snapshot: getBalanceDraft(db).snapshot,
      projection: preview.projection,
    }
    db.prepare(
      'INSERT INTO balance_reviews(id, year, payload, content_hash, idempotency_key, request_hash) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      review.id,
      review.year,
      canonical(review),
      hash(review),
      input.idempotencyKey,
      requestHash,
    )
    db.prepare(
      'INSERT INTO balance_review_heads(year, review_id) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET review_id = excluded.review_id',
    ).run(review.year, review.id)
    // Return the stored form, as a replay does, so every export of this
    // version (now or after reading it back) has the same bytes.
    const stored = getBalanceReview(db, review.id)
    if (!stored) throw new Error('採用した資料を保存内容から読み戻せませんでした。')
    return stored
  })
}

export function listBalanceReviews(
  db: DatabaseSync,
): Array<{ id: string; year: number; active: boolean; previousYearChanged: boolean }> {
  const rows = db
    .prepare('SELECT id, year FROM balance_reviews ORDER BY year, rowid')
    .all() as Array<{ id: string; year: number }>
  return rows.map((row) => {
    const review = getBalanceReview(db, row.id)!
    return {
      ...row,
      active: head(db, row.year) === row.id,
      previousYearChanged: priorChainChanged(db, review),
    }
  })
}
