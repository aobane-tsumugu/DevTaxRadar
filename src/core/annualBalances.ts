import { validateSoftwareMethodHistory } from './softwareMethod.js'
import type {
  AmountState,
  AnnualBalanceProjection,
  AnnualBalanceRow,
  BalanceAccount,
  BalanceMovement,
  BalanceSnapshot,
} from '../accounting/types.js'
import { consultationResolutionMatches } from './consultationResolution.js'

export class BalanceValidationError extends Error {
  readonly code:
    | 'invalid-input'
    | 'duplicate-id'
    | 'missing-reference'
    | 'invalid-date'
    | 'before-opening'
    | 'negative-balance'
    | 'amount-overflow'

  constructor(code: BalanceValidationError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'BalanceValidationError'
  }
}

function fail(code: BalanceValidationError['code'], message: string): never {
  throw new BalanceValidationError(code, message)
}

// Stable across OS locale settings, including user-entered non-ASCII IDs.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function text(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) fail('invalid-input', `${label}が必要です。`)
}

function year(value: number): void {
  if (!Number.isInteger(value) || value < 1900 || value > 9999) {
    fail('invalid-date', '対象年は1900年から9999年までの整数で指定してください。')
  }
}

function yen(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('invalid-input', '金額は0以上の安全な整数円で指定してください。')
  }
}

function add(a: number, b: number): number {
  const result = a + b
  if (!Number.isSafeInteger(result)) fail('amount-overflow', '集計額が扱える整数円を超えました。')
  return result
}

function dateYear(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('invalid-date', '出来事の日付を確認してください。')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail('invalid-date', '存在する日付を指定してください。')
  }
  const result = Number(value.slice(0, 4))
  year(result)
  return result
}

function amountState(value: AmountState): void {
  if (value.status === 'known') yen(value.amountJpy)
  else if (value.status === 'unknown' && value.amountJpy === null) {
    if (!Array.isArray(value.reasons) || !value.reasons.length) {
      fail('invalid-input', '未算定の理由が必要です。')
    }
    value.reasons.forEach((reason) => text(reason, '未算定の理由'))
  } else fail('invalid-input', '算定済みと未算定の金額を区別してください。')
}

function unique(records: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>()
  for (const record of records) {
    text(record.id, `${label}ID`)
    if (ids.has(record.id)) fail('duplicate-id', `${label}IDが重複しています。`)
    ids.add(record.id)
  }
}

function references(ids: string[], label: string): void {
  if (!Array.isArray(ids) || !ids.length) fail('missing-reference', `${label}が必要です。`)
  ids.forEach((id) => text(id, label))
  if (new Set(ids).size !== ids.length) fail('duplicate-id', `${label}が重複しています。`)
}

function movementAccounts(movement: BalanceMovement): string[] {
  return movement.kind === 'transfer'
    ? [movement.fromAccountId, movement.toAccountId]
    : [movement.accountId]
}

function signedAmount(movement: BalanceMovement, accountId: string): number {
  if (movement.kind === 'transfer') {
    return movement.toAccountId === accountId ? movement.amountJpy : -movement.amountJpy
  }
  return movement.kind === 'addition' ? movement.amountJpy : -movement.amountJpy
}

/** Validate the entire history, including years outside the requested view. */
export function validateBalanceSnapshot(snapshot: BalanceSnapshot): void {
  if (snapshot.version !== 1) fail('invalid-input', '対応していない残高データ形式です。')
  unique(snapshot.accounts, '残高')
  unique(snapshot.movements, '移動')
  unique(snapshot.pendingDecisions, '未判断')
  const accounts = new Map(snapshot.accounts.map((account) => [account.id, account]))
  for (const account of snapshot.accounts) {
    text(account.taxUnitId, '制作物の単位ID')
    text(account.name, '残高の名前')
    if (!['construction', 'asset', 'prepaid'].includes(account.kind)) {
      fail('invalid-input', '残高の種類を確認してください。')
    }
    year(account.openingYear)
    amountState(account.opening)
    if (account.openingRevisionId !== undefined) text(account.openingRevisionId, '前期の採用版ID')
  }
  const daily = new Map<string, Map<string, number>>()
  const costYears = new Set<number>()
  for (const movement of snapshot.movements) {
    const occurredYear = dateYear(movement.occurredOn)
    yen(movement.amountJpy)
    if (movement.balanceAllocations !== undefined) {
      if (
        movement.kind === 'addition' ||
        !Array.isArray(movement.balanceAllocations) ||
        movement.balanceAllocations.length > 100
      )
        fail('invalid-input', '残高の対応元は費用化・減少・振替に100件まで指定できます。')
      const keys = new Set<string>()
      let total = 0
      for (const link of movement.balanceAllocations) {
        if (!['opening', 'movement'].includes(link.sourceKind))
          fail('invalid-input', '残高対応元の種類を確認してください。')
        text(link.sourceId, '残高対応元ID')
        yen(link.amountJpy)
        if (link.costAllocations !== undefined) {
          if (!Array.isArray(link.costAllocations) || link.costAllocations.length > 100)
            fail('invalid-input', '使用する原価内訳は100件までです。')
          const lotKeys = new Set<string>()
          let lotTotal = 0
          for (const lot of link.costAllocations) {
            year(lot.costYear)
            text(lot.contributionId, '使用原価の費用配分ID')
            yen(lot.amountJpy)
            const lotKey = JSON.stringify([lot.costYear, lot.contributionId])
            if (lotKeys.has(lotKey))
              fail('duplicate-id', '同じ使用原価を対応元内で重複指定できません。')
            lotKeys.add(lotKey)
            lotTotal = add(lotTotal, lot.amountJpy)
          }
          if (lotTotal > link.amountJpy)
            fail('invalid-input', '原価内訳の合計が対応元の使用額を超えています。')
        }
        const key = JSON.stringify([link.sourceKind, link.sourceId])
        if (keys.has(key)) fail('duplicate-id', '同じ残高対応元を重複指定できません。')
        keys.add(key)
        total = add(total, link.amountJpy)
      }
      if (total > movement.amountJpy)
        fail('invalid-input', '残高との対応額が移動額を超えています。')
    }
    if (movement.kind === 'addition' && movement.costAllocations !== undefined) {
      if (!Array.isArray(movement.costAllocations) || movement.costAllocations.length > 100)
        fail('invalid-input', '費用との金額対応は100件までです。')
      const keys = new Set<string>()
      let allocated = 0
      for (const allocation of movement.costAllocations) {
        year(allocation.costYear)
        costYears.add(allocation.costYear)
        if (costYears.size > 200) fail('invalid-input', '費用との金額対応は200年度までです。')
        text(allocation.contributionId, '費用配分ID')
        yen(allocation.amountJpy)
        const key = JSON.stringify([allocation.costYear, allocation.contributionId])
        if (keys.has(key)) fail('duplicate-id', '同じ費用配分を増加内で重複指定できません。')
        keys.add(key)
        allocated = add(allocated, allocation.amountJpy)
      }
      if (allocated > movement.amountJpy)
        fail('invalid-input', '費用との対応額が増加額を超えています。')
    }
    if (!['addition', 'expense', 'reduction', 'transfer'].includes(movement.kind)) {
      fail('invalid-input', '残高移動の種類を確認してください。')
    }
    references(movement.sourceIds, '移動元の根拠ID')
    text(movement.decisionId, '採用した判断ID')
    text(movement.reason, '残高移動の理由')
    const ids = movementAccounts(movement)
    if (ids.length !== new Set(ids).size) fail('invalid-input', '同じ残高への振替はできません。')
    for (const id of ids) {
      const account = accounts.get(id)
      if (!account) fail('missing-reference', '残高移動の対象が見つかりません。')
      if (occurredYear < account.openingYear)
        fail('before-opening', '期首より前の移動は登録できません。')
      const changes = daily.get(id) ?? new Map<string, number>()
      changes.set(
        movement.occurredOn,
        add(changes.get(movement.occurredOn) ?? 0, signedAmount(movement, id)),
      )
      daily.set(id, changes)
    }
  }
  // Events only have calendar-day precision: same-day postings are simultaneous.
  for (const account of snapshot.accounts) {
    if (account.opening.status === 'unknown') continue
    let balance = account.opening.amountJpy
    const changes = [...(daily.get(account.id) ?? [])].sort(([a], [b]) => compare(a, b))
    for (const [, delta] of changes) {
      balance = add(balance, delta)
      if (balance < 0)
        fail('negative-balance', '費用化・振替・減少が、その日までの残高を超えています。')
    }
  }
  for (const pending of snapshot.pendingDecisions) {
    text(pending.taxUnitId, '未判断の制作物ID')
    year(pending.taxYear)
    for (const answers of [pending.answers, pending.resolution?.answerBasis]) {
      if (answers === undefined) continue
      if (!Array.isArray(answers) || answers.length > 100)
        fail('invalid-input', '一つの確認事項への回答は100件までです。')
      unique(answers, '相談回答')
      for (const answer of answers) {
        year(answer.taxYear)
        if (answer.taxYear < pending.taxYear)
          fail('invalid-input', '回答の対象年は未判断の発生年以降にしてください。')
        dateYear(answer.receivedOn)
        if (!['fact', 'method'].includes(answer.kind))
          fail('invalid-input', '事実の回答と方法の回答を区別してください。')
        text(answer.answer, '回答内容')
        text(answer.source, '回答の確認先・根拠')
      }
    }
    if (pending.resolution) {
      const basis = pending.resolution.questionBasis
      if (basis) {
        text(basis.pendingId, '解消時の確認事項ID')
        text(basis.taxUnitId, '解消時の制作物ID')
        year(basis.taxYear)
        amountState(basis.amount)
        if (!Array.isArray(basis.accountIds))
          fail('invalid-input', '解消時の残高IDを確認してください。')
        if (basis.accountIds.length) references(basis.accountIds, '解消時の残高ID')
        references(basis.reasons, '解消時の問い')
        references(basis.sourceIds, '解消時の根拠ID')
        year(basis.resolutionYear)
        text(basis.decisionId, '解消時の判断ID')
        text(basis.resolutionReason, '解消時の判断理由')
      }
      year(pending.resolution.taxYear)
      text(pending.resolution.decisionId, '解消の判断ID')
      text(pending.resolution.reason, '解消の理由')
      if (pending.resolution.taxYear < pending.taxYear)
        fail('before-opening', '未判断の発生年より前に解消することはできません。')
    }
    amountState(pending.amount)
    references(pending.sourceIds, '未判断の根拠ID')
    references(pending.reasons, '未判断の理由')
    if (new Set(pending.accountIds).size !== pending.accountIds.length) {
      fail('duplicate-id', '未判断の対象残高が重複しています。')
    }
    for (const id of pending.accountIds) {
      const account = accounts.get(id)
      if (!account) fail('missing-reference', '未判断の対象残高が見つかりません。')
      if (pending.taxYear < account.openingYear)
        fail('before-opening', '未判断の対象年が期首より前です。')
    }
  }
  try { validateSoftwareMethodHistory(snapshot) } catch (error) {
    throw new BalanceValidationError('invalid-input', error instanceof Error ? error.message : 'ソフトウェアの方法記録を確認してください。')
  }
}

function stateAfter(opening: AmountState, delta: number): AmountState {
  return opening.status === 'known'
    ? { status: 'known', amountJpy: add(opening.amountJpy, delta) }
    : { status: 'unknown', amountJpy: null, reasons: [...opening.reasons] }
}

function annualAccount(
  account: BalanceAccount,
  snapshot: BalanceSnapshot,
  targetYear: number,
): AnnualBalanceRow {
  const related = snapshot.movements.filter((movement) =>
    movementAccounts(movement).includes(account.id),
  )
  let priorDelta = 0
  const current: BalanceMovement[] = []
  for (const movement of related) {
    const occurredYear = Number(movement.occurredOn.slice(0, 4))
    if (occurredYear < targetYear) priorDelta = add(priorDelta, signedAmount(movement, account.id))
    else if (occurredYear === targetYear) current.push(movement)
  }
  const opening = stateAfter(account.opening, priorDelta)
  const row: AnnualBalanceRow = {
    accountId: account.id,
    taxUnitId: account.taxUnitId,
    name: account.name,
    kind: account.kind,
    openingRevisionId: account.openingRevisionId,
    opening,
    additionsJpy: 0,
    transfersInJpy: 0,
    transfersOutJpy: 0,
    expensesJpy: 0,
    reductionsJpy: 0,
    closing: opening,
    movementIds: current
      .sort((a, b) => compare(a.occurredOn, b.occurredOn) || compare(a.id, b.id))
      .map((movement) => movement.id),
    pendingDecisionIds: snapshot.pendingDecisions
      .filter(
        (pending) =>
          pending.taxYear <= targetYear &&
          (!pending.resolution ||
            pending.resolution.taxYear > targetYear ||
            !consultationResolutionMatches(pending, true)) &&
          pending.accountIds.includes(account.id),
      )
      .map((pending) => pending.id)
      .sort(),
  }
  let delta = 0
  for (const movement of current) {
    delta = add(delta, signedAmount(movement, account.id))
    const field =
      movement.kind === 'addition'
        ? 'additionsJpy'
        : movement.kind === 'expense'
          ? 'expensesJpy'
          : movement.kind === 'reduction'
            ? 'reductionsJpy'
            : movement.toAccountId === account.id
              ? 'transfersInJpy'
              : 'transfersOutJpy'
    row[field] = add(row[field], movement.amountJpy)
  }
  row.closing = stateAfter(opening, delta)
  return row
}

/** Projects posted decisions. This function neither invents nor approves tax treatments. */
export function buildAnnualBalances(
  snapshot: BalanceSnapshot,
  targetYear: number,
): AnnualBalanceProjection {
  year(targetYear)
  validateBalanceSnapshot(snapshot)
  const accounts = snapshot.accounts
    .filter((account) => account.openingYear <= targetYear)
    .map((account) => annualAccount(account, snapshot, targetYear))
    .sort((a, b) => compare(a.accountId, b.accountId))
  const totals: AnnualBalanceProjection['totals'] = {
    knownOpeningJpy: 0,
    knownClosingJpy: 0,
    additionsJpy: 0,
    transfersInJpy: 0,
    transfersOutJpy: 0,
    expensesJpy: 0,
    reductionsJpy: 0,
    unknownAccountIds: [],
  }
  for (const account of accounts) {
    if (account.opening.status === 'known')
      totals.knownOpeningJpy = add(totals.knownOpeningJpy, account.opening.amountJpy)
    if (account.closing.status === 'known')
      totals.knownClosingJpy = add(totals.knownClosingJpy, account.closing.amountJpy)
    else totals.unknownAccountIds.push(account.accountId)
    for (const field of [
      'additionsJpy',
      'transfersInJpy',
      'transfersOutJpy',
      'expensesJpy',
      'reductionsJpy',
    ] as const) {
      totals[field] = add(totals[field], account[field])
    }
  }
  return {
    version: 1,
    year: targetYear,
    accounts,
    totals,
    pendingDecisions: structuredClone(
      snapshot.pendingDecisions
        .filter(
          (pending) =>
            pending.taxYear <= targetYear &&
            (!pending.resolution ||
              pending.resolution.taxYear > targetYear ||
              !consultationResolutionMatches(pending, true)),
        )
        .map((pending) => {
          const { resolution: _future, ...active } = pending
          return {
            ...active,
            ...(active.answers
              ? { answers: active.answers.filter((answer) => answer.taxYear <= targetYear) }
              : {}),
          }
        }),
    ).sort((a, b) => compare(a.id, b.id)),
  }
}
