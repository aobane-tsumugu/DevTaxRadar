import type {
  BalanceAccount,
  BalanceSnapshot,
  PendingBalanceDecision,
} from '../accounting/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import { decisionIsConfirmed } from './decisionConfirmation.js'
import {
  consultationAnswersForYear,
  consultationQuestionBasis,
  consultationResolutionMatches,
} from './consultationResolution.js'

/** Reserved namespace for factual opening questions in the existing review model. */
const prefix = 'external-opening:'
const meanings: Record<BalanceAccount['kind'], string> = {
  construction: '制作中の未費用化原価',
  asset: '税務上の未償却残高',
  prepaid: '未提供期間に対応する前払残額',
}

export function isExternalOpening(row: Pick<PendingBalanceDecision, 'id'>): boolean {
  return row.id.startsWith(prefix)
}

export function externalOpeningMeaning(kind: BalanceAccount['kind']): string {
  return meanings[kind]
}

export function externalOpeningRecord(snapshot: BalanceSnapshot, accountId: string) {
  const rows = snapshot.pendingDecisions.filter(
    (row) => isExternalOpening(row) && row.accountIds.includes(accountId),
  )
  if (rows.length > 1)
    throw new Error('同じ期首に複数の外部資料確認があります。重複を確認してください。')
  return rows[0]
}

function text(value: string, label: string, maximum = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new Error(`${label}を入力してください（${maximum}文字以内）。`)
  return value.trim()
}

function validAmount(value: BalanceAccount['opening']): boolean {
  return value.status === 'known'
    ? Number.isSafeInteger(value.amountJpy) && value.amountJpy >= 0
    : value.status === 'unknown' &&
        value.amountJpy === null &&
        value.reasons.length > 0 &&
        value.reasons.every((reason) => Boolean(reason.trim()))
}

/**
 * Records a source-bound opening question without another table or write API.
 * The account's amount is not changed or counted a second time. A known opening
 * resolves the factual question using an existing confirmed decision; an unknown
 * opening stays unresolved. Save/adoption still use the ordinary balance boundary.
 */
export function recordExternalOpening(
  snapshot: BalanceSnapshot,
  planning: PlanningSnapshot,
  input: {
    accountId: string
    requestId: string
    reference: string
    evidenceIds: string[]
    decisionId?: string
    recordedAt: string
  },
): BalanceSnapshot {
  const account = snapshot.accounts.find((row) => row.id === input.accountId)
  if (!account) throw new Error('期首を記録する残高がありません。')
  if (account.openingRevisionId)
    throw new Error('DevTaxの採用版から引き継いだ期首を外部資料で置き換えられません。')
  if (!planning.taxUnits.some((row) => row.id === account.taxUnitId))
    throw new Error('期首の制作物を登録してください。')
  if (
    !Number.isInteger(account.openingYear) ||
    account.openingYear < 1900 ||
    account.openingYear > 9999
  )
    throw new Error('期首の対象年を確認してください。')
  if (!validAmount(account.opening)) throw new Error('期首額または不明な理由を確認してください。')
  if (!meanings[account.kind]) throw new Error('期首残高の種類を確認してください。')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId))
    throw new Error('確認記録のIDが不正です。')
  const instant = Date.parse(input.recordedAt)
  if (
    !Number.isFinite(instant) ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(input.recordedAt) ||
    new Date(input.recordedAt.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !==
      input.recordedAt.slice(0, 10)
  )
    throw new Error('確認日時を指定してください。')
  const reference = text(input.reference, '外部資料の名称と対象範囲')
  if (
    !input.evidenceIds.length ||
    input.evidenceIds.length > 100 ||
    new Set(input.evidenceIds).size !== input.evidenceIds.length
  )
    throw new Error('重複しない外部資料の証拠を選択してください。')
  const evidence = input.evidenceIds.map((id) => planning.evidence.find((row) => row.id === id))
  if (evidence.some((row) => !row)) throw new Error('選択した証拠が現在の計画にありません。')
  if (!evidence.some((row) => row?.strength === 'external'))
    throw new Error('外部資料として登録した証拠を少なくとも一つ選んでください。')
  if (
    evidence.some(
      (row) =>
        !Number.isFinite(Date.parse(row!.recordedAt)) || Date.parse(row!.recordedAt) > instant,
    )
  )
    throw new Error('証拠の記録日時以後の確認日時を指定してください。')
  const decision = planning.decisions.find((row) => row.id === input.decisionId)
  if (
    account.opening.status === 'known' &&
    (!decision ||
      !decisionIsConfirmed(decision) ||
      decision.taxUnitId !== account.taxUnitId ||
      decision.taxYear !== account.openingYear ||
      Date.parse(decision.confirmedAt!) > instant)
  )
    throw new Error('期首と同じ制作物・対象年の確認済み判断を選択してください。')

  const previous = externalOpeningRecord(snapshot, account.id)
  const id = previous?.id ?? prefix + input.requestId
  if (!previous && snapshot.pendingDecisions.some((row) => row.id === id))
    throw new Error('確認記録のIDが既に使われています。別のIDで作成してください。')
  const row: PendingBalanceDecision = {
    id,
    taxUnitId: account.taxUnitId,
    taxYear: account.openingYear,
    amount: structuredClone(account.opening),
    accountIds: [account.id],
    reasons: [`外部期首：${meanings[account.kind]}`, reference],
    sourceIds: [...input.evidenceIds],
    answers: [
      {
        id: input.requestId + ':fact',
        taxYear: account.openingYear,
        receivedOn: new Date(instant).toISOString().slice(0, 10),
        kind: 'fact',
        answer: reference,
        source: `本人確認日時 ${new Date(instant).toISOString()}`,
      },
    ],
  }
  if (account.opening.status === 'known') {
    row.resolution = {
      taxYear: account.openingYear,
      decisionId: decision!.id,
      reason: `購入額ではなく、${account.openingYear}年期首の${meanings[account.kind]}として確認。`,
    }
    row.resolution.answerBasis = consultationAnswersForYear(row, account.openingYear)
    row.resolution.questionBasis = consultationQuestionBasis(row)
  }
  const next = structuredClone(snapshot)
  const index = next.pendingDecisions.findIndex((value) => value.id === id)
  if (index < 0) next.pendingDecisions.push(row)
  else next.pendingDecisions[index] = row
  return next
}

function amountKey(value: BalanceAccount['opening']): string {
  return JSON.stringify(
    value.status === 'known' ? ['known', value.amountJpy] : ['unknown', ...value.reasons],
  )
}

/** Additional factual correspondence; generic checks still validate sources and decisions. */
export function externalOpeningIssues(
  snapshot: BalanceSnapshot,
  planning: PlanningSnapshot,
): Array<{ recordId: string; accountId: string; message: string }> {
  const issues: Array<{ recordId: string; accountId: string; message: string }> = []
  const seen = new Set<string>()
  for (const row of snapshot.pendingDecisions.filter(isExternalOpening)) {
    const accountId = row.accountIds[0] ?? ''
    const account = snapshot.accounts.find((item) => item.id === accountId)
    const problem = (message: string) => issues.push({ recordId: row.id, accountId, message })
    if (row.accountIds.length !== 1 || !account) {
      problem('外部期首の確認には、存在する残高を一つ対応付けてください。')
      continue
    }
    if (seen.has(accountId)) problem('同じ期首の外部資料確認が重複しています。')
    seen.add(accountId)
    if (
      account.openingRevisionId ||
      row.taxUnitId !== account.taxUnitId ||
      row.taxYear !== account.openingYear ||
      row.reasons[0] !== `外部期首：${meanings[account.kind]}` ||
      amountKey(row.amount) !== amountKey(account.opening)
    ) {
      problem(
        '期首の金額・不明理由・年・種類・制作物が確認時点と異なります。外部資料との対応を再確認してください。',
      )
    }
    if (
      !row.sourceIds.some((id) =>
        planning.evidence.some((item) => item.id === id && item.strength === 'external'),
      )
    )
      problem('外部期首に対応する外部資料の証拠がありません。')
    if (!row.reasons[1]?.trim()) problem('外部資料の名称と対象範囲を記録してください。')
    if (
      row.amount.status === 'known' &&
      (!row.resolution ||
        row.resolution.taxYear !== account.openingYear ||
        !consultationResolutionMatches(row, true))
    )
      problem('既知の外部期首について、証拠と判断に対応する本人確認が完了していません。')
  }
  return issues
}
